import { invoke } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import type { PasteBehavior } from '../types/settings'
import type { PasteResult } from '../types/transcription'

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function writeClipboard(text: string): Promise<void> {
  if (isTauriRuntime()) {
    await writeText(text)
    return
  }

  await navigator.clipboard.writeText(text)
}

export async function deliverText(text: string, behavior: PasteBehavior): Promise<PasteResult> {
  if (behavior === 'show_only') {
    return {
      copied: false,
      pasted: false,
      displayedOnly: true,
      message: 'Ready',
    }
  }

  await writeClipboard(text)

  if (behavior === 'clipboard_only') {
    return {
      copied: true,
      pasted: false,
      displayedOnly: false,
      message: 'Copied',
    }
  }

  if (!isTauriRuntime()) {
    return {
      copied: true,
      pasted: false,
      displayedOnly: false,
      message: 'Copied',
    }
  }

  try {
    await invoke('simulate_paste')
    return {
      copied: true,
      pasted: true,
      displayedOnly: false,
      message: 'Pasted',
    }
  } catch {
    return {
      copied: true,
      pasted: false,
      displayedOnly: false,
      message: 'Paste failed, copied',
    }
  }
}
