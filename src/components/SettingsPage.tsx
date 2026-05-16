import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { maskApiKey, sanitizeApiKey } from '../services/settings'
import type {
  AppSettings,
  Domain,
  OutputStyle,
  PasteBehavior,
  ShortcutTriggerMode,
} from '../types/settings'
import type { LocalDataPaths, TranscriptHistoryItem, VoiceStatusPayload } from '../types/transcription'
import { StatusBadge } from './StatusBadge'

interface SettingsPageProps {
  settings: AppSettings
  status: VoiceStatusPayload
  lastResult: string
  shortcutError: string
  onSettingsChange: (settings: AppSettings) => void
  onSave: () => void
  onStart: () => void
  onStop: () => void
  onCancel: () => void
  onShortcutCaptureChange: (isCapturing: boolean) => void
  history: TranscriptHistoryItem[]
  dataPaths: LocalDataPaths
  diagnosticMessage: string
  onTestApiKey: () => void
  onTestMicrophone: () => void
  onClearLocalData: () => void
  onCopyHistory: (item: TranscriptHistoryItem) => void
  onPasteHistory: (item: TranscriptHistoryItem) => void
  onClearHistory: () => void
}

const domains: Array<{ value: Domain; label: string }> = [
  { value: 'programmer', label: '程序员' },
  { value: 'product', label: '产品经理' },
  { value: 'legal', label: '法律' },
  { value: 'medical', label: '医疗' },
  { value: 'finance', label: '金融' },
  { value: 'custom', label: '自定义' },
]

const outputStyles: Array<{ value: OutputStyle; label: string }> = [
  { value: 'raw', label: '原文' },
  { value: 'clear_spoken', label: '清晰口语' },
  { value: 'programmer_prompt', label: '程序员 Prompt' },
  { value: 'github_issue', label: 'GitHub Issue' },
  { value: 'pr_review_comment', label: 'PR Review Comment' },
]

const pasteBehaviors: Array<{ value: PasteBehavior; label: string }> = [
  { value: 'auto_paste', label: '自动粘贴' },
  { value: 'clipboard_only', label: '只复制到剪贴板' },
  { value: 'show_only', label: '只显示结果' },
]

const holdKeyOptions = [
  'Alt',
  'Control',
  'Shift',
  'CapsLock',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]

function Field({
  label,
  children,
  note,
}: {
  label: string
  children: React.ReactNode
  note?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {note && <small>{note}</small>}
    </label>
  )
}

function formatHistoryTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const shortcutCommitDelayMs = 220

function normalizeShortcutKey(key: string, code?: string): string {
  if (key === ' ' || key === 'Spacebar' || key === 'Space' || code === 'Space') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key.length === 1) return key.toUpperCase()

  const aliases: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Enter: 'Enter',
    Escape: 'Escape',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Tab: 'Tab',
  }

  return aliases[key] ?? key
}

interface ShortcutModifiers {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

function formatModifierPreview(modifiers: ShortcutModifiers): string {
  const parts: string[] = []

  if (modifiers.ctrl || modifiers.meta) parts.push('CommandOrControl')
  if (modifiers.alt) parts.push('Alt')
  if (modifiers.shift) parts.push('Shift')

  return parts.join('+')
}

function buildShortcut(key: string, code: string | undefined, modifiers: ShortcutModifiers): string {
  const shortcutKey = normalizeShortcutKey(key, code)

  if (!shortcutKey || modifierKeys.has(key)) return ''

  const parts: string[] = []

  if (modifiers.ctrl || modifiers.meta) parts.push('CommandOrControl')
  if (modifiers.alt) parts.push('Alt')
  if (modifiers.shift) parts.push('Shift')

  if (parts.length === 0) return ''

  parts.push(shortcutKey)

  return Array.from(new Set(parts)).join('+')
}

function unsupportedChordMessage(keys: Set<string>): string {
  return `不支持 ${Array.from(keys).join('+')}。请使用 Ctrl、Alt、Shift 或 Win + 一个主键。`
}

function shortcutSummary(settings: AppSettings): string {
  return settings.shortcutTriggerMode === 'hold_key'
    ? `长按 ${settings.holdKey || 'Alt'}`
    : settings.globalShortcut || 'Alt+Space'
}

function ShortcutRecorder({
  value,
  onChange,
  onCaptureChange,
}: {
  value: string
  onChange: (value: string) => void
  onCaptureChange: (isCapturing: boolean) => void
}) {
  const [recording, setRecording] = useState(false)
  const [preview, setPreview] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const recordingRef = useRef(false)
  const pendingCommitRef = useRef<number | null>(null)
  const heldPrimaryKeysRef = useRef<Set<string>>(new Set())
  const modifiersRef = useRef<ShortcutModifiers>({
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  })

  useEffect(() => {
    recordingRef.current = recording
    onCaptureChange(recording)

    return () => {
      onCaptureChange(false)
    }
  }, [onCaptureChange, recording])

  useEffect(() => {
    if (!recording) return

    const clearPendingCommit = () => {
      if (pendingCommitRef.current !== null) {
        window.clearTimeout(pendingCommitRef.current)
        pendingCommitRef.current = null
      }
    }

    const resetCaptureState = () => {
      clearPendingCommit()
      heldPrimaryKeysRef.current.clear()
    }

    const updateModifiers = (event: KeyboardEvent) => {
      modifiersRef.current = {
        ctrl: event.ctrlKey || event.key === 'Control',
        alt: event.altKey || event.key === 'Alt',
        shift: event.shiftKey || event.key === 'Shift',
        meta: event.metaKey || event.key === 'Meta',
      }
    }

    const stopEvent = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    const scheduleShortcutCommit = (shortcut: string) => {
      clearPendingCommit()
      pendingCommitRef.current = window.setTimeout(() => {
        pendingCommitRef.current = null
        if (!recordingRef.current || heldPrimaryKeysRef.current.size !== 1) return

        onChange(shortcut)
        resetCaptureState()
        setPreview('')
        setRecording(false)
      }, shortcutCommitDelayMs)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      stopEvent(event)
      updateModifiers(event)

      if (event.repeat) return

      if (event.key === 'Escape') {
        resetCaptureState()
        setRecording(false)
        setPreview('')
        return
      }

      if (modifierKeys.has(event.key)) {
        const modifierPreview = formatModifierPreview(modifiersRef.current)
        setPreview(
          modifierPreview
            ? `${modifierPreview}+...`
            : '继续按一个字母、数字、空格或功能键',
        )
        return
      }

      const primaryKey = normalizeShortcutKey(event.key, event.code)
      if (!primaryKey) {
        setPreview('请按 Ctrl、Alt、Shift 或 Win + 一个字母、数字、空格或功能键')
        return
      }

      heldPrimaryKeysRef.current.add(primaryKey)

      if (heldPrimaryKeysRef.current.size > 1) {
        clearPendingCommit()
        setPreview(unsupportedChordMessage(heldPrimaryKeysRef.current))
        return
      }

      const shortcut = buildShortcut(event.key, event.code, modifiersRef.current)
      if (!shortcut) {
        setPreview(
          '请按 Ctrl、Alt、Shift 或 Win + 一个字母、数字、空格或功能键',
        )
        return
      }

      setPreview(shortcut)
      scheduleShortcutCommit(shortcut)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      stopEvent(event)
      updateModifiers(event)

      if (!modifierKeys.has(event.key) && pendingCommitRef.current === null) {
        heldPrimaryKeysRef.current.delete(normalizeShortcutKey(event.key, event.code))
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      resetCaptureState()
      setRecording(false)
      setPreview('')
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      resetCaptureState()
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [onChange, recording])

  return (
    <div className="shortcut-recorder" ref={rootRef}>
      <div
        role="button"
        tabIndex={0}
        className={recording ? 'shortcut-capture is-recording' : 'shortcut-capture'}
        onClick={() => {
          modifiersRef.current = {
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          }
          heldPrimaryKeysRef.current.clear()
          setRecording(true)
          setPreview('')
        }}
      >
        <span>{recording ? '按下新的快捷键...' : value || '点击后按快捷键'}</span>
        <kbd>{recording ? 'Esc 取消' : 'Record'}</kbd>
      </div>
      {preview && <small>{preview}</small>}
    </div>
  )
}

function ShortcutPicker({
  settings,
  onPatch,
  onCaptureChange,
}: {
  settings: AppSettings
  onPatch: (partial: Partial<AppSettings>) => void
  onCaptureChange: (isCapturing: boolean) => void
}) {
  const [open, setOpen] = useState(false)

  const setMode = (shortcutTriggerMode: ShortcutTriggerMode) => {
    onPatch({ shortcutTriggerMode })
  }

  return (
    <div className="shortcut-picker">
      <button type="button" className="shortcut-open" onClick={() => setOpen(true)}>
        <span>{shortcutSummary(settings)}</span>
        <kbd>Change</kbd>
      </button>

      {open && (
        <div className="shortcut-modal-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="shortcut-modal" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>选择触发方式</strong>
                <span>长按单键适合快速语音输入；组合键更接近传统快捷键。</span>
              </div>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>
                Done
              </button>
            </header>

            <div className="shortcut-mode-toggle">
              <button
                type="button"
                className={settings.shortcutTriggerMode === 'hold_key' ? 'is-selected' : ''}
                onClick={() => setMode('hold_key')}
              >
                长按单键
              </button>
              <button
                type="button"
                className={settings.shortcutTriggerMode === 'combo' ? 'is-selected' : ''}
                onClick={() => setMode('combo')}
              >
                组合快捷键
              </button>
            </div>

            {settings.shortcutTriggerMode === 'hold_key' ? (
              <section className="keyboard-panel">
                <p>按住选中的单键约 0.3 秒开始录音，松开停止。Alt 可能和系统菜单冲突，误触时建议改为 F8 或 CapsLock。</p>
                <div className="keyboard-grid">
                  {holdKeyOptions.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={settings.holdKey === key ? 'keycap is-selected' : 'keycap'}
                      onClick={() => onPatch({ holdKey: key, shortcutTriggerMode: 'hold_key' })}
                    >
                      {key}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="keyboard-panel">
                <p>请选择修饰键 + 一个主键。两个普通键同时按不属于标准全局快捷键。</p>
                <div className="shortcut-presets">
                  {['Alt+Space', 'CommandOrControl+Space', 'CommandOrControl+Shift+Space', 'Alt+F1'].map(
                    (shortcut) => (
                      <button
                        type="button"
                        key={shortcut}
                        className={settings.globalShortcut === shortcut ? 'is-selected' : ''}
                        onClick={() =>
                          onPatch({ globalShortcut: shortcut, shortcutTriggerMode: 'combo' })
                        }
                      >
                        {shortcut}
                      </button>
                    ),
                  )}
                </div>
                <ShortcutRecorder
                  value={settings.globalShortcut}
                  onChange={(globalShortcut) =>
                    onPatch({ globalShortcut, shortcutTriggerMode: 'combo' })
                  }
                  onCaptureChange={onCaptureChange}
                />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPage({
  settings,
  status,
  lastResult,
  shortcutError,
  onSettingsChange,
  onSave,
  onStart,
  onStop,
  onCancel,
  onShortcutCaptureChange,
  history,
  dataPaths,
  diagnosticMessage,
  onTestApiKey,
  onTestMicrophone,
  onClearLocalData,
  onCopyHistory,
  onPasteHistory,
  onClearHistory,
}: SettingsPageProps) {
  const patch = (partial: Partial<AppSettings>) => onSettingsChange({ ...settings, ...partial })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSave()
  }

  const isListening = status.status === 'Listening'
  const isBusy = status.status === 'Transcribing' || status.status === 'Polishing'

  return (
    <main className="settings-shell">
      <form className="settings-window" onSubmit={handleSubmit}>
        <aside className="settings-sidebar">
          <div className="traffic-lights" aria-hidden="true">
            <span className="traffic-red" />
            <span className="traffic-yellow" />
            <span className="traffic-green" />
          </div>

          <div className="settings-brand">
            <div className="brand-glyph">VI</div>
            <div>
              <strong>Voice Input</strong>
              <span>Programmer dictation</span>
            </div>
          </div>

          <nav className="settings-nav" aria-label="Settings sections">
            <a href="#engine" className="active">
              Engine
            </a>
            <a href="#output">Output</a>
            <a href="#terms">Terms</a>
            <a href="#history">History</a>
            <a href="#privacy">Privacy</a>
          </nav>

          <div className="sidebar-status">
            <StatusBadge status={status.status} />
            <span>{shortcutSummary(settings)}</span>
          </div>
        </aside>

        <section className="settings-content">
          <header className="settings-titlebar">
            <div>
              <p className="eyebrow">Settings</p>
              <h1>语音输入</h1>
            </div>
            <div className="actions">
              {!isListening ? (
                <button type="button" onClick={onStart} disabled={isBusy}>
                  Start
                </button>
              ) : (
                <button type="button" onClick={onStop}>
                  Stop
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={onCancel}
                disabled={!isListening && !isBusy}
              >
                Cancel
              </button>
              <button type="submit">Save</button>
            </div>
          </header>

          <section className="control-strip">
            <div>
              <strong>{status.message || 'Ready for dictation'}</strong>
              <span>默认低延迟：录音、转写、复制/粘贴；润色只在开启时调用。</span>
            </div>
          </section>

          {shortcutError && <div className="notice error">{shortcutError}</div>}

          <div className="settings-pane">
            <section id="engine" className="settings-group">
              <div className="group-heading">
                <h2>Engine</h2>
                <span>DashScope transcription and optional polish</span>
              </div>
              <div className="field-grid">
                <Field
                  label="DashScope API Key"
                  note={`Local only. Current: ${maskApiKey(settings.apiKey)}`}
                >
                  <div className="secret-field">
                    <input
                      type="password"
                      value={settings.apiKey}
                      placeholder="Paste your DashScope key"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => patch({ apiKey: sanitizeApiKey(event.target.value) })}
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => patch({ apiKey: '' })}
                      disabled={!settings.apiKey}
                    >
                      Remove
                    </button>
                  </div>
                </Field>
                <Field label="转写模型" note="可输入任意 DashScope realtime ASR 模型名。">
                  <input
                    list="transcription-model-options"
                    value={settings.transcriptionModel}
                    placeholder="qwen3-asr-flash-realtime"
                    onChange={(event) => patch({ transcriptionModel: event.target.value })}
                  />
                  <datalist id="transcription-model-options">
                    <option value="qwen3-asr-flash-realtime" />
                  </datalist>
                </Field>
                <Field label="润色模型">
                  <input
                    value={settings.polishModel}
                    onChange={(event) => patch({ polishModel: event.target.value })}
                  />
                </Field>
                <Field label="VAD 灵敏度" note="默认 0.30。越低越容易被环境音触发。">
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.vadThreshold}
                    onChange={(event) => patch({ vadThreshold: Number(event.target.value) })}
                  />
                </Field>
                <Field label="静音分段时间" note="单位毫秒，默认 600。只用于分段；不停止录音。">
                  <input
                    type="number"
                    min="100"
                    max="10000"
                    step="50"
                    value={settings.vadSilenceDurationMs}
                    onChange={(event) => patch({ vadSilenceDurationMs: Number(event.target.value) })}
                  />
                </Field>
                <label className="check-row switch-row">
                  <input
                    type="checkbox"
                    checked={settings.polishEnabled}
                    onChange={(event) => patch({ polishEnabled: event.target.checked })}
                  />
                  默认启用润色
                </label>
              </div>
            </section>

            <section id="output" className="settings-group">
              <div className="group-heading">
                <h2>Output</h2>
                <span>Context and delivery behavior</span>
              </div>
              <div className="field-grid">
                <Field label="行业语境">
                  <select
                    value={settings.domain}
                    onChange={(event) => patch({ domain: event.target.value as Domain })}
                  >
                    {domains.map((domain) => (
                      <option key={domain.value} value={domain.value}>
                        {domain.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {settings.domain === 'custom' && (
                  <Field label="自定义行业">
                    <input
                      value={settings.customDomain}
                      onChange={(event) => patch({ customDomain: event.target.value })}
                    />
                  </Field>
                )}
                <Field label="输出模式">
                  <select
                    value={settings.outputStyle}
                    onChange={(event) => patch({ outputStyle: event.target.value as OutputStyle })}
                  >
                    {outputStyles.map((style) => (
                      <option key={style.value} value={style.value}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="粘贴行为">
                  <select
                    value={settings.pasteBehavior}
                    onChange={(event) => patch({ pasteBehavior: event.target.value as PasteBehavior })}
                  >
                    {pasteBehaviors.map((behavior) => (
                      <option key={behavior.value} value={behavior.value}>
                        {behavior.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section id="terms" className="settings-group">
              <div className="group-heading">
                <h2>Terms</h2>
                <span>Bias ASR toward your technical vocabulary</span>
              </div>
              <Field label="自定义术语表">
                <textarea
                  rows={7}
                  value={settings.customTerms}
                  placeholder="每行一个术语或短语，例如：Tauri、Codex、React Server Components"
                  onChange={(event) => patch({ customTerms: event.target.value })}
                />
              </Field>
              <Field label="语音触发键" note="点击 Change 打开小键盘，选择长按单键或组合快捷键。">
                <ShortcutPicker
                  settings={settings}
                  onPatch={patch}
                  onCaptureChange={onShortcutCaptureChange}
                />
              </Field>
            </section>

            <section id="history" className="settings-group">
              <div className="group-heading">
                <h2>History</h2>
                <span>
                  最近 20 条语音剪切板。最新语音仍会按粘贴行为自动处理。
                </span>
              </div>
              <div className="history-toolbar">
                <span>
                  {settings.neverSaveHistory
                    ? '当前仅保留本次运行，退出后清空。'
                    : '当前会保存到本机应用数据目录。'}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={onClearHistory}
                  disabled={history.length === 0}
                >
                  Clear
                </button>
              </div>
              {history.length > 0 ? (
                <div className="history-list">
                  {history.map((item, index) => (
                    <article className="history-row" key={item.id}>
                      <div className="history-meta">
                        <strong>#{index + 1}</strong>
                        <span>{formatHistoryTime(item.createdAt)}</span>
                      </div>
                      <p>{item.text}</p>
                      <div className="history-actions">
                        <button type="button" className="secondary" onClick={() => onCopyHistory(item)}>
                          Copy
                        </button>
                        <button type="button" onClick={() => onPasteHistory(item)}>
                          Paste
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-history">还没有语音记录。</div>
              )}
            </section>

            <section id="privacy" className="settings-group">
              <div className="group-heading">
                <h2>Privacy</h2>
                <span>Local defaults for temporary dictation</span>
              </div>
              <div className="privacy-grid">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.neverSaveAudio}
                    onChange={(event) => patch({ neverSaveAudio: event.target.checked })}
                  />
                  不保存音频
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.neverSaveHistory}
                    onChange={(event) => patch({ neverSaveHistory: event.target.checked })}
                  />
                  不保存历史
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={settings.saveClipboardLog}
                    onChange={(event) => patch({ saveClipboardLog: event.target.checked })}
                  />
                  保存剪贴板日志（默认关闭）
                </label>
              </div>
              <div className="data-paths">
                <div>
                  <strong>设置文件</strong>
                  <span>{dataPaths.settingsPath || '应用启动后自动确定'}</span>
                </div>
                <div>
                  <strong>历史文件</strong>
                  <span>{dataPaths.historyPath || '应用启动后自动确定'}</span>
                </div>
                <div>
                  <strong>日志文件</strong>
                  <span>{dataPaths.logPath || '应用启动后自动确定'}</span>
                </div>
              </div>
              <div className="privacy-actions">
                <button type="button" className="secondary" onClick={onTestApiKey}>
                  测试 API Key
                </button>
                <button type="button" className="secondary" onClick={onTestMicrophone}>
                  测试麦克风
                </button>
                <button type="button" className="danger-button" onClick={onClearLocalData}>
                  清除本地数据
                </button>
              </div>
              {diagnosticMessage && <div className="diagnostic-notice">{diagnosticMessage}</div>}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void invoke('open_microphone_settings')
                }}
              >
                打开 Windows 麦克风权限设置
              </button>
              <pre className="result-box">{lastResult || 'No result in this session.'}</pre>
            </section>
          </div>
        </section>
      </form>
    </main>
  )
}
