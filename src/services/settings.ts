import { invoke } from '@tauri-apps/api/core'
import { DEFAULT_SETTINGS, type AppSettings } from '../types/settings'

const SETTINGS_KEY = 'programmer-voice-input:settings'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function sanitizeApiKey(apiKey: string): string {
  return apiKey.trim().match(/^sk-[A-Za-z0-9_-]+/)?.[0] ?? apiKey.trim().replace(/[^\x21-\x7e]/g, '')
}

function normalizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SETTINGS
  }

  const merged = {
    ...DEFAULT_SETTINGS,
    ...(value as Partial<AppSettings>),
  }

  merged.apiKey = sanitizeApiKey(merged.apiKey)

  if (!merged.transcriptionModel?.trim()) {
    merged.transcriptionModel = DEFAULT_SETTINGS.transcriptionModel
  }

  if (merged.shortcutTriggerMode !== 'hold_key' && merged.shortcutTriggerMode !== 'combo') {
    merged.shortcutTriggerMode = DEFAULT_SETTINGS.shortcutTriggerMode
  }

  if (!merged.holdKey?.trim()) {
    merged.holdKey = DEFAULT_SETTINGS.holdKey
  }

  if (merged.transcriptionModel === 'qwen3-asr-flash') {
    merged.transcriptionModel = 'qwen3-asr-flash-realtime'
  }

  if (!merged.polishModel || merged.polishModel.startsWith('gpt-')) {
    merged.polishModel = DEFAULT_SETTINGS.polishModel
  }

  if (!Number.isFinite(merged.vadThreshold)) {
    merged.vadThreshold = DEFAULT_SETTINGS.vadThreshold
  }

  merged.vadThreshold = Math.min(1, Math.max(0, merged.vadThreshold))

  if (!Number.isFinite(merged.vadSilenceDurationMs)) {
    merged.vadSilenceDurationMs = DEFAULT_SETTINGS.vadSilenceDurationMs
  }

  merged.vadSilenceDurationMs = Math.round(
    Math.min(10_000, Math.max(100, merged.vadSilenceDurationMs)),
  )

  return merged
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return normalizeSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function loadPersistedSettings(): Promise<AppSettings> {
  if (!isTauriRuntime()) return loadSettings()

  try {
    const raw = await invoke<string | null>('load_local_settings')
    if (!raw) return loadSettings()

    return normalizeSettings(JSON.parse(raw))
  } catch {
    return loadSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  const settingsJson = JSON.stringify({
    ...settings,
    apiKey: sanitizeApiKey(settings.apiKey),
  })
  localStorage.setItem(SETTINGS_KEY, settingsJson)

  if (isTauriRuntime()) {
    void invoke('save_local_settings', { settingsJson })
  }
}

export function maskApiKey(apiKey: string): string {
  return apiKey.trim() ? 'Saved locally' : 'Not set'
}
