import { invoke } from '@tauri-apps/api/core'
import type { AppSettings } from '../types/settings'
import type { LocalDataPaths } from '../types/transcription'
import { postJson } from './http'

const DASHSCOPE_CHAT_COMPLETIONS_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function testDashScopeApiKey(settings: AppSettings): Promise<string> {
  const apiKey = settings.apiKey.trim()

  if (!apiKey) {
    throw new Error('DashScope API Key is missing.')
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 15_000)

  try {
    const response = await postJson(
      DASHSCOPE_CHAT_COMPLETIONS_URL,
      {
        Authorization: `Bearer ${apiKey}`,
      },
      {
        model: settings.polishModel || 'qwen-flash',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 4,
        temperature: 0,
      },
      controller.signal,
    )

    if (!response.ok) {
      let message = `DashScope request failed with ${response.status}.`

      try {
        const body = await response.json()
        message = body?.error?.message || body?.message || body?.code || message
      } catch {
        // Keep the HTTP status message.
      }

      throw new Error(message)
    }

    return 'API Key test passed'
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('API Key test timed out.', { cause: error })
    }

    throw new Error(toErrorMessage(error), { cause: error })
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function testMicrophonePermission(): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API is not available.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((track) => track.stop())

  return 'Microphone test passed'
}

export async function getLocalDataPaths(): Promise<LocalDataPaths> {
  if (!isTauriRuntime()) {
    return { settingsPath: '', historyPath: '', logPath: '' }
  }

  return invoke<LocalDataPaths>('get_local_data_paths')
}

export async function clearAllLocalData(): Promise<void> {
  localStorage.removeItem('programmer-voice-input:settings')
  localStorage.removeItem('programmer-voice-input:transcript-history')

  if (isTauriRuntime()) {
    await invoke('clear_all_local_data')
  }
}
