import { emit, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { FloatingWindow } from './components/FloatingWindow'
import { SettingsPage } from './components/SettingsPage'
import {
  clearAllLocalData,
  getLocalDataPaths,
  testDashScopeApiKey,
  testMicrophonePermission,
} from './services/diagnostics'
import {
  addHistoryItem,
  clearStoredHistory,
  createHistoryItem,
  loadHistory,
  loadPersistedHistory,
  saveHistory,
} from './services/history'
import { appendClipboardLog } from './services/logs'
import { buildPolishInput, polishText } from './services/polish'
import { deliverText } from './services/paste'
import { startRealtimeRecorder, type RecorderSession } from './services/realtimeRecorder'
import { loadPersistedSettings, loadSettings, sanitizeApiKey, saveSettings } from './services/settings'
import { cleanupTranscript } from './services/transcriptCleanup'
import { DEFAULT_SETTINGS, type AppSettings } from './types/settings'
import type {
  LocalDataPaths,
  TranscriptHistoryItem,
  VoiceStatusPayload,
  VoiceTriggerSource,
} from './types/transcription'

const isFloatingWindow = new URLSearchParams(window.location.search).get('window') === 'floating'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const idleStatus: VoiceStatusPayload = {
  status: 'Idle',
  seconds: 0,
}

interface VoiceControlEvent {
  source?: VoiceTriggerSource
}

function shortcutSummary(settings: AppSettings): string {
  return settings.shortcutTriggerMode === 'hold_key'
    ? `长按 ${settings.holdKey || 'Alt'}`
    : settings.globalShortcut || 'Alt+Space'
}

const sleep = (milliseconds: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds)
  })

function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const settingsRef = useRef(settings)
  const [status, setStatus] = useState<VoiceStatusPayload>(idleStatus)
  const [lastResult, setLastResult] = useState('')
  const [history, setHistory] = useState<TranscriptHistoryItem[]>(() =>
    settings.neverSaveHistory ? [] : loadHistory(),
  )
  const [dataPaths, setDataPaths] = useState<LocalDataPaths>({
    settingsPath: '',
    historyPath: '',
    logPath: '',
  })
  const [diagnosticMessage, setDiagnosticMessage] = useState('')
  const [shortcutError, setShortcutError] = useState('')
  const [shortcutCaptureActive, setShortcutCaptureActive] = useState(false)
  const settingsHydratedRef = useRef(!isTauriRuntime() || isFloatingWindow)
  const suppressNextSettingsSaveRef = useRef(false)
  const recorderRef = useRef<RecorderSession | null>(null)
  const startingRecorderRef = useRef<Promise<RecorderSession> | null>(null)
  const stopDuringStartRef = useRef(false)
  const cancelRequestedRef = useRef(false)
  const processingRef = useRef(false)
  const liveTranscriptRef = useRef('')
  const activeTriggerSourceRef = useRef<VoiceTriggerSource>('manual')

  useEffect(() => {
    settingsRef.current = settings

    if (!isFloatingWindow && isTauriRuntime()) {
      void emit('voice-settings-summary', {
        shortcut: shortcutSummary(settings),
      })
    }

    if (!isFloatingWindow && settingsHydratedRef.current) {
      if (suppressNextSettingsSaveRef.current) {
        suppressNextSettingsSaveRef.current = false
        return
      }

      saveSettings(settings)
    }
  }, [settings])

  useEffect(() => {
    if (isFloatingWindow || !isTauriRuntime()) return

    let disposed = false

    async function hydrateStoredState() {
      try {
        const storedSettings = await loadPersistedSettings()
        if (disposed) return

        settingsRef.current = storedSettings
        setSettings(storedSettings)
        saveSettings(storedSettings)

        const paths = await getLocalDataPaths()
        if (!disposed) {
          setDataPaths(paths)
        }

        if (storedSettings.neverSaveHistory) {
          setHistory([])
          clearStoredHistory()
          return
        }

        const storedHistory = await loadPersistedHistory()
        if (!disposed) {
          setHistory(storedHistory)
        }

      } finally {
        settingsHydratedRef.current = true
      }
    }

    void hydrateStoredState()

    return () => {
      disposed = true
    }
  }, [])

  const publishStatus = useCallback((payload: VoiceStatusPayload) => {
    setStatus(payload)
    if (isTauriRuntime()) {
      void emit('voice-status', payload)
    }
  }, [])

  const persistHistory = useCallback((items: TranscriptHistoryItem[], currentSettings: AppSettings) => {
    if (currentSettings.neverSaveHistory) {
      clearStoredHistory()
      return
    }

    saveHistory(items)
  }, [])

  const pushHistory = useCallback(
    (text: string, rawText: string, currentSettings: AppSettings) => {
      const item = createHistoryItem(text, rawText)

      if (currentSettings.saveClipboardLog) {
        appendClipboardLog(item)
      }

      setHistory((current) => {
        const next = addHistoryItem(current, item)
        persistHistory(next, currentSettings)
        return next
      })
    },
    [persistHistory],
  )

  const stopRecording = useCallback(async () => {
    let recorder = recorderRef.current
    if (processingRef.current) return

    if (!recorder && startingRecorderRef.current) {
      stopDuringStartRef.current = true
      publishStatus({
        status: 'Transcribing',
        seconds: 0,
        message: 'Waiting for recorder',
        transcriptPreview: liveTranscriptRef.current,
        triggerSource: activeTriggerSourceRef.current,
      })
      try {
        recorder = await startingRecorderRef.current
      } catch {
        stopDuringStartRef.current = false
        return
      } finally {
        startingRecorderRef.current = null
      }
    }

    if (!recorder) return

    processingRef.current = true
    recorderRef.current = null

    try {
      publishStatus({
        status: 'Transcribing',
        seconds: 0,
        message: 'Finalizing transcript',
        transcriptPreview: liveTranscriptRef.current,
        triggerSource: activeTriggerSourceRef.current,
      })
      const rawTranscript = await recorder.stop()
      const cleanedTranscript = cleanupTranscript(rawTranscript)

      if (cancelRequestedRef.current) {
        cancelRequestedRef.current = false
        liveTranscriptRef.current = ''
        publishStatus({ status: 'Idle', seconds: 0, message: 'Cancelled' })
        return
      }

      if (!cleanedTranscript) {
        throw new Error('Transcription is empty after removing filler words.')
      }

      const currentSettings = settingsRef.current
      let finalText = cleanedTranscript

      if (currentSettings.polishEnabled) {
        publishStatus({
          status: 'Polishing',
          seconds: 0,
          message: 'Polishing text',
          transcriptPreview: cleanedTranscript,
          triggerSource: activeTriggerSourceRef.current,
        })
        finalText = await polishText(buildPolishInput(cleanedTranscript, currentSettings))
      }

      setLastResult(finalText)
      pushHistory(finalText, rawTranscript, currentSettings)
      const pasteBehavior = document.hasFocus() ? 'clipboard_only' : currentSettings.pasteBehavior
      const delivery = await deliverText(finalText, pasteBehavior)
      liveTranscriptRef.current = finalText
      publishStatus({
        status: delivery.pasted ? 'Pasted' : delivery.copied ? 'Copied' : 'Ready',
        seconds: 0,
        message: document.hasFocus() ? 'App focused, copied only' : delivery.message,
        transcriptPreview: finalText,
      })
    } catch (error) {
      publishStatus({ status: 'Error', seconds: 0, message: toErrorMessage(error) })
    } finally {
      stopDuringStartRef.current = false
      processingRef.current = false
    }
  }, [publishStatus, pushHistory])

  const copyHistoryItem = useCallback(
    async (item: TranscriptHistoryItem) => {
      try {
        const delivery = await deliverText(item.text, 'clipboard_only')
        publishStatus({
          status: delivery.copied ? 'Copied' : 'Ready',
          seconds: 0,
          message: delivery.message,
          transcriptPreview: item.text,
        })
      } catch (error) {
        publishStatus({ status: 'Error', seconds: 0, message: toErrorMessage(error) })
      }
    },
    [publishStatus],
  )

  const pasteHistoryItem = useCallback(
    async (item: TranscriptHistoryItem) => {
      try {
        if (isTauriRuntime()) {
          await getCurrentWindow().hide()
          await sleep(140)
        }

        const delivery = await deliverText(item.text, 'auto_paste')
        publishStatus({
          status: delivery.pasted ? 'Pasted' : delivery.copied ? 'Copied' : 'Ready',
          seconds: 0,
          message: delivery.message,
          transcriptPreview: item.text,
        })
      } catch (error) {
        publishStatus({ status: 'Error', seconds: 0, message: toErrorMessage(error) })
      }
    },
    [publishStatus],
  )

  const clearHistory = useCallback(() => {
    setHistory([])
    clearStoredHistory()
    publishStatus({ status: 'Ready', seconds: 0, message: 'History cleared' })
  }, [publishStatus])

  const runApiKeyTest = useCallback(async () => {
    setDiagnosticMessage('Testing API Key...')

    try {
      const message = await testDashScopeApiKey(settingsRef.current)
      setDiagnosticMessage(message)
      publishStatus({ status: 'Ready', seconds: 0, message })
    } catch (error) {
      const message = toErrorMessage(error)
      setDiagnosticMessage(message)
      publishStatus({ status: 'Error', seconds: 0, message })
    }
  }, [publishStatus])

  const runMicrophoneTest = useCallback(async () => {
    setDiagnosticMessage('Testing microphone...')

    try {
      const message = await testMicrophonePermission()
      setDiagnosticMessage(message)
      publishStatus({ status: 'Ready', seconds: 0, message })
    } catch (error) {
      const message = toErrorMessage(error)
      setDiagnosticMessage(message)
      publishStatus({ status: 'Error', seconds: 0, message })
    }
  }, [publishStatus])

  const clearLocalData = useCallback(async () => {
    try {
      await clearAllLocalData()
      suppressNextSettingsSaveRef.current = true
      setSettings(DEFAULT_SETTINGS)
      settingsRef.current = DEFAULT_SETTINGS
      setHistory([])
      setLastResult('')
      setDiagnosticMessage('Local data cleared')
      publishStatus({ status: 'Ready', seconds: 0, message: 'Local data cleared' })
    } catch (error) {
      const message = toErrorMessage(error)
      setDiagnosticMessage(message)
      publishStatus({ status: 'Error', seconds: 0, message })
    }
  }, [publishStatus])

  const setShortcutCaptureMode = useCallback((isCapturing: boolean) => {
    setShortcutCaptureActive(isCapturing)

    if (isCapturing && isTauriRuntime()) {
      void unregisterAll()
    }
  }, [])

  const startRecording = useCallback(async (source: VoiceTriggerSource = 'manual') => {
    if (recorderRef.current || startingRecorderRef.current || processingRef.current) return

    activeTriggerSourceRef.current = source

    const currentSettings = {
      ...settingsRef.current,
      apiKey: sanitizeApiKey(settingsRef.current.apiKey),
    }

    if (!currentSettings.apiKey) {
      publishStatus({ status: 'Error', seconds: 0, message: 'DashScope API Key is missing.' })
      return
    }

    try {
      cancelRequestedRef.current = false
      stopDuringStartRef.current = false
      liveTranscriptRef.current = ''
      const startPromise = startRealtimeRecorder(currentSettings, {
        onTranscript: (text) => {
          const cleanedText = cleanupTranscript(text)
          liveTranscriptRef.current = cleanedText
          publishStatus({
            status: 'Listening',
            seconds: recorderRef.current
              ? Math.floor((Date.now() - recorderRef.current.startedAt) / 1000)
              : 0,
            message: cleanedText || 'Listening',
            transcriptPreview: cleanedText,
            triggerSource: source,
          })
        },
        onError: (message) => {
          publishStatus({
            status: 'Error',
            seconds: 0,
            message,
            transcriptPreview: liveTranscriptRef.current,
            triggerSource: source,
          })
        },
      })
      startingRecorderRef.current = startPromise
      const recorder = await startPromise
      if (startingRecorderRef.current === startPromise) {
        startingRecorderRef.current = null
      }

      if (cancelRequestedRef.current) {
        await recorder.cancel()
        cancelRequestedRef.current = false
        stopDuringStartRef.current = false
        liveTranscriptRef.current = ''
        publishStatus({ status: 'Idle', seconds: 0, message: 'Cancelled' })
        return
      }

      if (stopDuringStartRef.current) {
        return
      }

      recorderRef.current = recorder
      publishStatus({ status: 'Listening', seconds: 0, message: 'Listening', triggerSource: source })
    } catch (error) {
      startingRecorderRef.current = null
      stopDuringStartRef.current = false
      publishStatus({ status: 'Error', seconds: 0, message: toErrorMessage(error) })
    }
  }, [publishStatus])

  const cancelRecording = useCallback(async () => {
    cancelRequestedRef.current = true
    const recorder = recorderRef.current
    if (recorder) {
      recorderRef.current = null
      await recorder.cancel()
    } else if (startingRecorderRef.current) {
      stopDuringStartRef.current = true
      try {
        const startingRecorder = await startingRecorderRef.current
        await startingRecorder.cancel()
      } catch {
        // The start path will publish its own error if needed.
      } finally {
        startingRecorderRef.current = null
      }
    }
    stopDuringStartRef.current = false
    liveTranscriptRef.current = ''
    activeTriggerSourceRef.current = 'manual'
    publishStatus({ status: 'Idle', seconds: 0, message: 'Cancelled' })
  }, [publishStatus])

  useEffect(() => {
    if (isFloatingWindow) return

    const interval = window.setInterval(() => {
      const recorder = recorderRef.current
      if (!recorder) return
      publishStatus({
        status: 'Listening',
        seconds: Math.floor((Date.now() - recorder.startedAt) / 1000),
        message: liveTranscriptRef.current || 'Listening',
        transcriptPreview: liveTranscriptRef.current,
        triggerSource: activeTriggerSourceRef.current,
      })
    }, 250)

    return () => window.clearInterval(interval)
  }, [publishStatus])

  useEffect(() => {
    if (isFloatingWindow || !isTauriRuntime()) return

    let disposed = false

    async function bindShortcut() {
      try {
        if (shortcutCaptureActive) {
          await unregisterAll()
          await invoke('configure_hold_key', { enabled: false, key: settingsRef.current.holdKey })
          return
        }

        if (settingsRef.current.shortcutTriggerMode === 'hold_key') {
          await unregisterAll()
          await invoke('configure_hold_key', {
            enabled: true,
            key: settingsRef.current.holdKey.trim() || 'Alt',
          })
          if (!disposed) setShortcutError('')
          return
        }

        const shortcut = settingsRef.current.globalShortcut.trim() || 'Alt+Space'

        await unregisterAll()
        await invoke('configure_hold_key', { enabled: false, key: settingsRef.current.holdKey })
        await register(shortcut, (event) => {
          if (event.state === 'Pressed') {
            void startRecording('shortcut')
          }
          if (event.state === 'Released') {
            void stopRecording()
          }
        })
        if (!disposed) setShortcutError('')
      } catch (error) {
        if (!disposed) {
          setShortcutError(`Global shortcut failed: ${toErrorMessage(error)}`)
        }
      }
    }

    void bindShortcut()

    return () => {
      disposed = true
      void unregisterAll()
    }
  }, [
    settings.globalShortcut,
    settings.holdKey,
    settings.shortcutTriggerMode,
    shortcutCaptureActive,
    startRecording,
    stopRecording,
  ])

  useEffect(() => {
    if (isFloatingWindow || !isTauriRuntime()) return

    const unlistenCancel = listen('voice-cancel', () => {
      void cancelRecording()
    })

    const unlistenStart = listen<VoiceControlEvent>('voice-start', (event) => {
      void startRecording(event.payload?.source ?? 'manual')
    })

    const unlistenStop = listen('voice-stop', () => {
      void stopRecording()
    })

    const unlistenToggle = listen('voice-toggle', () => {
      if (recorderRef.current) {
        void stopRecording()
      } else {
        void startRecording()
      }
    })

    const unlistenShowSettings = listen('show-settings', () => {
      const currentWindow = getCurrentWindow()
      void currentWindow
        .show()
        .then(() => currentWindow.unminimize())
        .then(() => currentWindow.setFocus())
        .catch((error) => {
          setShortcutError(`Show settings failed: ${toErrorMessage(error)}`)
        })
    })

    return () => {
      unlistenCancel.then((unlisten) => unlisten())
      unlistenStart.then((unlisten) => unlisten())
      unlistenStop.then((unlisten) => unlisten())
      unlistenToggle.then((unlisten) => unlisten())
      unlistenShowSettings.then((unlisten) => unlisten())
    }
  }, [cancelRecording, startRecording, stopRecording])

  if (isFloatingWindow) {
    return <FloatingWindow />
  }

  return (
    <SettingsPage
      settings={settings}
      status={status}
      lastResult={lastResult}
      shortcutError={shortcutError}
      onSettingsChange={setSettings}
      onSave={() => {
        saveSettings(settings)
        persistHistory(history, settings)
        publishStatus({ status: 'Ready', seconds: 0, message: 'Settings saved' })
      }}
      onStart={() => {
        void startRecording('manual')
      }}
      onStop={stopRecording}
      onCancel={cancelRecording}
      onShortcutCaptureChange={setShortcutCaptureMode}
      history={history}
      dataPaths={dataPaths}
      diagnosticMessage={diagnosticMessage}
      onTestApiKey={runApiKeyTest}
      onTestMicrophone={runMicrophoneTest}
      onClearLocalData={clearLocalData}
      onCopyHistory={copyHistoryItem}
      onPasteHistory={pasteHistoryItem}
      onClearHistory={clearHistory}
    />
  )
}

export default App
