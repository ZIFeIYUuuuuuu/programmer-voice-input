import { invoke } from '@tauri-apps/api/core'
import type { TranscriptHistoryItem } from '../types/transcription'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getClipboardLogPath(): Promise<string> {
  if (!isTauriRuntime()) return ''

  try {
    return await invoke<string>('get_clipboard_log_path')
  } catch {
    return ''
  }
}

export function appendClipboardLog(item: TranscriptHistoryItem): void {
  if (!isTauriRuntime()) return

  const entryJson = JSON.stringify({
    id: item.id,
    createdAt: item.createdAt,
    text: item.text,
    rawText: item.rawText,
  })

  void invoke('append_clipboard_log', { entryJson })
}
