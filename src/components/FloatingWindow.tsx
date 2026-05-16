import { invoke } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { deliverText } from '../services/paste'
import type { VoiceStatusPayload, VoiceTriggerSource } from '../types/transcription'

const initialStatus: VoiceStatusPayload = {
  status: 'Idle',
  seconds: 0,
}

interface FloatingSettingsSummary {
  shortcut: string
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusLabel(payload: VoiceStatusPayload): string {
  if (payload.status === 'Idle') return '点击说话'
  if (payload.status === 'Listening') return '正在听...'
  if (payload.status === 'Transcribing') return '正在转写...'
  if (payload.status === 'Polishing') return '正在润色...'
  if (payload.status === 'Pasted') return '已插入'
  if (payload.status === 'Copied') return '已复制'
  if (payload.status === 'Ready') return '完成'
  return payload.status
}

function MicrophoneIcon() {
  return (
    <svg aria-hidden="true" className="mic-icon" viewBox="0 0 24 24">
      <path d="M12 14.5a3.2 3.2 0 0 0 3.2-3.2V6.2a3.2 3.2 0 1 0-6.4 0v5.1a3.2 3.2 0 0 0 3.2 3.2Z" />
      <path d="M18 10.7a6 6 0 0 1-12 0" />
      <path d="M12 16.7v3.1" />
      <path d="M8.7 19.8h6.6" />
    </svg>
  )
}

const waveformBars = Array.from({ length: 18 }, (_, index) => index)

function isPushToTalkSource(source: VoiceTriggerSource | undefined): boolean {
  return source === 'hold_key' || source === 'shortcut'
}

export function FloatingWindow() {
  const [payload, setPayload] = useState<VoiceStatusPayload>(initialStatus)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionNotice, setActionNotice] = useState('')
  const [shortcutLabel, setShortcutLabel] = useState('长按 Alt')
  const transcriptPreview = payload.transcriptPreview?.trim()

  useEffect(() => {
    document.documentElement.classList.add('floating-html')
    document.body.classList.add('floating-body')

    return () => {
      document.documentElement.classList.remove('floating-html')
      document.body.classList.remove('floating-body')
    }
  }, [])

  useEffect(() => {
    const unlistenPromise = listen<VoiceStatusPayload>('voice-status', (event) => {
      setPayload(event.payload)
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  useEffect(() => {
    const unlistenPromise = listen<FloatingSettingsSummary>('voice-settings-summary', (event) => {
      setShortcutLabel(event.payload.shortcut || '长按 Alt')
    })

    return () => {
      unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  useEffect(() => {
    const window = getCurrentWindow()
    const hasPanel = payload.status === 'Transcribing' || payload.status === 'Polishing' || payload.status === 'Error'
    const isComplete =
      Boolean(transcriptPreview) &&
      (payload.status === 'Pasted' || payload.status === 'Copied' || payload.status === 'Ready')
    const size = menuOpen
      ? new LogicalSize(430, hasPanel || isComplete || payload.status === 'Listening' ? 350 : 288)
      : payload.status === 'Listening'
        ? new LogicalSize(430, 154)
        : isComplete
          ? new LogicalSize(430, 264)
          : hasPanel
            ? new LogicalSize(430, 220)
            : new LogicalSize(206, 64)
    void window.setSize(size)
  }, [menuOpen, payload.status, transcriptPreview])

  useEffect(() => {
    if (!actionNotice) return

    const timeout = window.setTimeout(() => setActionNotice(''), 1400)
    return () => window.clearTimeout(timeout)
  }, [actionNotice])

  const canCancel =
    payload.status === 'Listening' ||
    payload.status === 'Transcribing' ||
    payload.status === 'Polishing'

  const isListening = payload.status === 'Listening'
  const isBusy = payload.status === 'Transcribing' || payload.status === 'Polishing'
  const isTranscribing = payload.status === 'Transcribing' || payload.status === 'Polishing'
  const isPushToTalk = isPushToTalkSource(payload.triggerSource)
  const isComplete =
    Boolean(transcriptPreview) &&
    (payload.status === 'Pasted' || payload.status === 'Copied' || payload.status === 'Ready')
  const panelText = transcriptPreview || (payload.status === 'Error' ? payload.message : '') || ''

  const tone = useMemo(() => {
    if (payload.status === 'Error') return 'danger'
    if (payload.status === 'Listening') return 'live'
    if (payload.status === 'Transcribing' || payload.status === 'Polishing') return 'busy'
    if (payload.status === 'Pasted' || payload.status === 'Copied' || payload.status === 'Ready') {
      return 'done'
    }
    return 'idle'
  }, [payload.status])

  const hudState = isListening
    ? 'listening'
    : isTranscribing
      ? 'transcribing'
      : isComplete
        ? 'complete'
        : payload.status === 'Error'
          ? 'error'
          : 'idle'

  const openSettings = async () => {
    setMenuOpen(false)
    try {
      await invoke('show_settings')
    } catch (error) {
      setPayload({
        status: 'Error',
        seconds: 0,
        message: `Open settings failed: ${toErrorMessage(error)}`,
      })
    }
  }

  const quit = () => {
    void invoke('quit_app')
  }

  const minimize = async () => {
    setMenuOpen(false)
    const currentWindow = getCurrentWindow()

    try {
      await currentWindow.setSkipTaskbar(false)
      await currentWindow.minimize()
    } catch (error) {
      setPayload((current) => ({
        ...current,
        status: 'Error',
        message: `Minimize failed: ${toErrorMessage(error)}`,
      }))
    }
  }

  const toggleRecording = () => {
    setMenuOpen(false)
    void emit(isListening ? 'voice-stop' : 'voice-start', { source: 'hud' })
  }

  const cancel = () => {
    setMenuOpen(false)
    void emit('voice-cancel')
  }

  const clearCurrentResult = () => {
    setMenuOpen(false)
    setActionNotice('')
    setPayload(initialStatus)
    void emit('voice-cancel')
  }

  const copyResult = async () => {
    if (!transcriptPreview) return

    try {
      await deliverText(transcriptPreview, 'clipboard_only')
      setActionNotice('已复制')
      setPayload((current) => ({
        ...current,
        status: 'Copied',
        message: 'Copied',
        transcriptPreview,
      }))
    } catch (error) {
      setPayload({
        status: 'Error',
        seconds: 0,
        message: `Copy failed: ${toErrorMessage(error)}`,
        transcriptPreview,
      })
    }
  }

  const insertResult = async () => {
    if (!transcriptPreview) return

    const currentWindow = getCurrentWindow()

    try {
      await currentWindow.hide()
      await new Promise((resolve) => window.setTimeout(resolve, 140))
      const delivery = await deliverText(transcriptPreview, 'auto_paste')
      setActionNotice(delivery.pasted ? '已插入' : '已复制')
      setPayload((current) => ({
        ...current,
        status: delivery.pasted ? 'Pasted' : delivery.copied ? 'Copied' : 'Ready',
        message: delivery.message,
        transcriptPreview,
      }))
    } catch (error) {
      setPayload({
        status: 'Error',
        seconds: 0,
        message: `Insert failed: ${toErrorMessage(error)}`,
        transcriptPreview,
      })
    } finally {
      window.setTimeout(() => {
        void currentWindow.show()
      }, 180)
    }
  }

  const openContextMenu = (event: React.MouseEvent | React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setMenuOpen(true)
  }

  const beginNativeDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('[data-no-drag="true"]')) {
      return
    }

    event.preventDefault()
    setMenuOpen(false)

    void getCurrentWindow()
      .startDragging()
      .catch((error) => {
        setPayload((current) => ({
          ...current,
          message: `Drag failed: ${toErrorMessage(error)}`,
        }))
      })
  }

  return (
    <main
      className={`floating-shell menu-${menuOpen ? 'open' : 'closed'} hud-state-${hudState}`}
      onContextMenuCapture={openContextMenu}
      onPointerDownCapture={(event) => {
        if (event.button === 2) {
          openContextMenu(event)
        }
      }}
    >
      <section
        className={`hud-island tone-${tone}`}
        aria-label="Voice input status"
        onPointerDown={beginNativeDrag}
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest('button')) {
            setMenuOpen(false)
          }
        }}
      >
        <div className="hud-pill-row">
          {hudState === 'idle' ? (
            <button className="hud-talk-button" type="button" onClick={toggleRecording} data-no-drag="true">
              <span className="mic-mark">
                <MicrophoneIcon />
              </span>
              <span>点击说话</span>
            </button>
          ) : (
            <div className="hud-status">
              <span className="mic-mark">
                <MicrophoneIcon />
              </span>
              <div className="hud-copy">
                <div className="hud-title-row">
                  <strong>{statusLabel(payload)}</strong>
                  {isListening && <span className="timer">{formatSeconds(payload.seconds)}</span>}
                </div>
                <p>
                  {isListening
                    ? isPushToTalk
                      ? '松开按键停止'
                      : '点击停止按钮结束'
                    : payload.message || (isTranscribing ? '正在处理现有转写结果' : '语音结果已准备好')}
                </p>
              </div>
            </div>
          )}

          {isListening && (
            <div className="waveform" aria-hidden="true">
              {waveformBars.map((bar) => (
                <span key={bar} style={{ '--bar-index': bar } as CSSProperties} />
              ))}
            </div>
          )}

          {hudState !== 'idle' && (
            <div className="hud-window-controls">
              {isListening && !isPushToTalk && (
                <button
                  className="hud-control-button stop-button"
                  type="button"
                  onClick={toggleRecording}
                  aria-label="停止录音"
                  data-no-drag="true"
                >
                  <span />
                </button>
              )}
              <button
                className="hud-control-button"
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-label="更多"
                data-no-drag="true"
              >
                <span />
                <span />
                <span />
              </button>
              <button
                className="hud-control-button minimize-button"
                type="button"
                onClick={minimize}
                aria-label="最小化"
                data-no-drag="true"
              >
                <span />
              </button>
              <button
                className="hud-control-button close-button"
                type="button"
                onClick={quit}
                aria-label="关闭"
                data-no-drag="true"
              >
                <span />
                <span />
              </button>
            </div>
          )}
        </div>

        {isListening && (
          <div className={transcriptPreview ? 'live-transcript' : 'live-transcript is-empty'}>
            {transcriptPreview || '正在实时识别...'}
          </div>
        )}

        {(isTranscribing || isComplete || payload.status === 'Error') && (
          <div className="hud-panel">
            <div className="transcript-area" aria-label="转写文本">
              {panelText}
            </div>

            {isComplete && (
              <div className="hud-actions">
                <button className="primary-action" type="button" onClick={insertResult} data-no-drag="true">
                  插入
                </button>
                <button type="button" onClick={copyResult} data-no-drag="true">
                  复制
                </button>
                <button type="button" onClick={toggleRecording} data-no-drag="true">
                  重录
                </button>
                <button type="button" onClick={clearCurrentResult} data-no-drag="true">
                  清空
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {actionNotice && <div className="hud-toast">{actionNotice}</div>}

      {menuOpen && (
        <section
          className="hud-menu"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" onClick={() => void openSettings()}>
            <span>设置</span>
            <kbd>Menu</kbd>
          </button>
          <button type="button" onClick={toggleRecording} disabled={isBusy}>
            <span>{isListening ? '停止录音' : '开始录音'}</span>
            <kbd>{shortcutLabel}</kbd>
          </button>
          <button type="button" onClick={cancel} disabled={!canCancel}>
            <span>取消当前任务</span>
          </button>
          <div className="hud-menu-separator" />
          <button type="button" onClick={quit}>
            <span>退出 Voice Input</span>
          </button>
        </section>
      )}
    </main>
  )
}
