export type VoiceStatus =
  | 'Idle'
  | 'Listening'
  | 'Transcribing'
  | 'Polishing'
  | 'Pasted'
  | 'Copied'
  | 'Ready'
  | 'Error'

export type VoiceTriggerSource = 'hold_key' | 'shortcut' | 'hud' | 'manual'

export interface VoiceStatusPayload {
  status: VoiceStatus
  seconds: number
  message?: string
  transcriptPreview?: string
  triggerSource?: VoiceTriggerSource
}

export interface PasteResult {
  copied: boolean
  pasted: boolean
  displayedOnly: boolean
  message: string
}

export interface TranscriptHistoryItem {
  id: string
  text: string
  rawText?: string
  createdAt: string
}

export interface LocalDataPaths {
  settingsPath: string
  historyPath: string
  logPath: string
}
