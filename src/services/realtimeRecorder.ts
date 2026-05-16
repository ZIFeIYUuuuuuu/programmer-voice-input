import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppSettings } from '../types/settings'
import { sanitizeApiKey } from './settings'

const TARGET_SAMPLE_RATE = 16_000
const PROCESSOR_BUFFER_SIZE = 1024

export interface RecorderSession {
  stop: () => Promise<string>
  cancel: () => Promise<void>
  startedAt: number
}

interface RealtimeRecorderCallbacks {
  onTranscript: (text: string) => void
  onError: (message: string) => void
}

interface RealtimeAsrEvent {
  kind: 'ready' | 'partial' | 'final' | 'error' | 'speech_started' | 'speech_stopped'
  text?: string
  message?: string
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function recorderErrorMessage(error: unknown): string {
  const message = toErrorMessage(error)
  const name = error instanceof DOMException ? error.name : ''

  if (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    name === 'SecurityError' ||
    /permission denied|not allowed|denied/i.test(message)
  ) {
    return '麦克风权限被拒绝。请允许 Voice Input / WebView2 使用麦克风，然后重新录音。'
  }

  if (name === 'NotFoundError' || /requested device not found|not found/i.test(message)) {
    return '没有找到可用麦克风。请确认麦克风已连接并在 Windows 中启用。'
  }

  if (name === 'NotReadableError' || /could not start|in use|not readable/i.test(message)) {
    return '麦克风当前不可用，可能被其他应用占用。请关闭占用麦克风的应用后重试。'
  }

  return message || '麦克风启动失败。'
}

function mergeToMono(inputBuffer: AudioBuffer): Float32Array {
  const output = new Float32Array(inputBuffer.length)

  for (let channelIndex = 0; channelIndex < inputBuffer.numberOfChannels; channelIndex += 1) {
    const channel = inputBuffer.getChannelData(channelIndex)
    for (let index = 0; index < output.length; index += 1) {
      output[index] += channel[index] / inputBuffer.numberOfChannels
    }
  }

  return output
}

function resample(input: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return input

  const ratio = sourceRate / targetRate
  const outputLength = Math.max(1, Math.floor(input.length / ratio))
  const output = new Float32Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(left + 1, input.length - 1)
    const weight = sourceIndex - left
    output[index] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight
  }

  return output
}

function pcmToBase64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }

  const bytes = new Uint8Array(pcm.buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

function disconnectNode(node: AudioNode | null): void {
  try {
    node?.disconnect()
  } catch {
    // Already disconnected.
  }
}

export async function startRealtimeRecorder(
  settings: AppSettings,
  callbacks: RealtimeRecorderCallbacks,
): Promise<RecorderSession> {
  if (!isTauriRuntime()) {
    throw new Error('实时语音识别需要在 Tauri 桌面应用中运行。')
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前 WebView 不支持麦克风录音。')
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
  } catch (error) {
    throw new Error(recorderErrorMessage(error), { cause: error })
  }

  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  if (!AudioContextClass) {
    stream.getTracks().forEach((track) => track.stop())
    throw new Error('当前 WebView 不支持 Web Audio，无法实时采集 PCM。')
  }

  const audioContext = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE })
  await audioContext.resume()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
  const mute = audioContext.createGain()
  mute.gain.value = 0

  let stopped = false
  let sendQueue = Promise.resolve()
  const unlisten = await listen<RealtimeAsrEvent>('realtime-asr', (event) => {
    const payload = event.payload

    if ((payload.kind === 'partial' || payload.kind === 'final') && payload.text) {
      callbacks.onTranscript(payload.text)
    }

    if (payload.kind === 'error' && payload.message) {
      callbacks.onError(payload.message)
    }
  })

  const cleanup = async () => {
    stopped = true
    processor.onaudioprocess = null
    disconnectNode(source)
    disconnectNode(processor)
    disconnectNode(mute)
    stream.getTracks().forEach((track) => track.stop())
    unlisten()
    await audioContext.close().catch(() => undefined)
  }

  try {
    await invoke('realtime_asr_start', {
      config: {
        apiKey: sanitizeApiKey(settings.apiKey),
        language: 'zh',
        model: settings.transcriptionModel,
        vadSilenceDurationMs: settings.vadSilenceDurationMs,
        vadThreshold: settings.vadThreshold,
      },
    })
  } catch (error) {
    await cleanup()
    throw new Error(`实时语音连接失败：${toErrorMessage(error)}`, { cause: error })
  }

  processor.onaudioprocess = (event) => {
    if (stopped) return

    const mono = mergeToMono(event.inputBuffer)
    const resampled = resample(mono, audioContext.sampleRate, TARGET_SAMPLE_RATE)
    const audio = pcmToBase64(resampled)

    sendQueue = sendQueue
      .then(async () => {
        await invoke('realtime_asr_append_audio', { audio })
      })
      .catch((error) => {
        callbacks.onError(`实时语音发送失败：${toErrorMessage(error)}`)
        stopped = true
      })
  }

  source.connect(processor)
  processor.connect(mute)
  mute.connect(audioContext.destination)

  return {
    startedAt: Date.now(),
    stop: async () => {
      stopped = true
      try {
        await sendQueue
        const finalText = await invoke<string>('realtime_asr_finish')
        return finalText.trim()
      } finally {
        await cleanup()
      }
    },
    cancel: async () => {
      stopped = true
      await sendQueue.catch(() => undefined)
      await invoke('realtime_asr_cancel').catch(() => undefined)
      await cleanup()
    },
  }
}
