export type TranscriptionModel = string

export type Domain =
  | 'programmer'
  | 'product'
  | 'legal'
  | 'medical'
  | 'finance'
  | 'custom'

export type OutputStyle =
  | 'raw'
  | 'clear_spoken'
  | 'programmer_prompt'
  | 'github_issue'
  | 'pr_review_comment'

export type PasteBehavior = 'auto_paste' | 'clipboard_only' | 'show_only'

export type PolishStrength = 'light' | 'medium' | 'strong'
export type ShortcutTriggerMode = 'hold_key' | 'combo'

export interface AppSettings {
  apiKey: string
  transcriptionModel: TranscriptionModel
  polishEnabled: boolean
  polishModel: string
  domain: Domain
  customDomain: string
  customTerms: string
  outputStyle: OutputStyle
  pasteBehavior: PasteBehavior
  shortcutTriggerMode: ShortcutTriggerMode
  holdKey: string
  globalShortcut: string
  neverSaveAudio: boolean
  neverSaveHistory: boolean
  saveClipboardLog: boolean
  polishStrength: PolishStrength
  vadThreshold: number
  vadSilenceDurationMs: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  transcriptionModel: 'qwen3-asr-flash-realtime',
  polishEnabled: false,
  polishModel: 'qwen-flash',
  domain: 'programmer',
  customDomain: '',
  customTerms: '',
  outputStyle: 'raw',
  pasteBehavior: 'auto_paste',
  shortcutTriggerMode: 'hold_key',
  holdKey: 'Alt',
  globalShortcut: 'Alt+Space',
  neverSaveAudio: true,
  neverSaveHistory: false,
  saveClipboardLog: false,
  polishStrength: 'medium',
  vadThreshold: 0.3,
  vadSilenceDurationMs: 600,
}
