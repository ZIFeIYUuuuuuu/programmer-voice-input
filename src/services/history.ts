import { invoke } from '@tauri-apps/api/core'
import type { TranscriptHistoryItem } from '../types/transcription'

const HISTORY_KEY = 'programmer-voice-input:transcript-history'
const MAX_HISTORY_ITEMS = 20

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isHistoryItem(value: unknown): value is TranscriptHistoryItem {
  if (!value || typeof value !== 'object') return false

  const item = value as Partial<TranscriptHistoryItem>
  return typeof item.id === 'string' && typeof item.text === 'string' && typeof item.createdAt === 'string'
}

export function createHistoryItem(text: string, rawText?: string): TranscriptHistoryItem {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)

  return {
    id: `${Date.now()}-${randomId}`,
    text,
    rawText: rawText && rawText !== text ? rawText : undefined,
    createdAt: new Date().toISOString(),
  }
}

export function limitHistory(items: TranscriptHistoryItem[]): TranscriptHistoryItem[] {
  return items.filter((item) => item.text.trim()).slice(0, MAX_HISTORY_ITEMS)
}

export function addHistoryItem(
  items: TranscriptHistoryItem[],
  item: TranscriptHistoryItem,
): TranscriptHistoryItem[] {
  return limitHistory([item, ...items])
}

export function loadHistory(): TranscriptHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []

    return Array.isArray(parsed) ? limitHistory(parsed.filter(isHistoryItem)) : []
  } catch {
    return []
  }
}

export async function loadPersistedHistory(): Promise<TranscriptHistoryItem[]> {
  if (!isTauriRuntime()) return loadHistory()

  try {
    const raw = await invoke<string | null>('load_local_history')
    if (!raw) return loadHistory()

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? limitHistory(parsed.filter(isHistoryItem)) : []
  } catch {
    return loadHistory()
  }
}

export function saveHistory(items: TranscriptHistoryItem[]): void {
  const historyJson = JSON.stringify(limitHistory(items))
  localStorage.setItem(HISTORY_KEY, historyJson)

  if (isTauriRuntime()) {
    void invoke('save_local_history', { historyJson })
  }
}

export function clearStoredHistory(): void {
  localStorage.removeItem(HISTORY_KEY)

  if (isTauriRuntime()) {
    void invoke('clear_local_history')
  }
}
