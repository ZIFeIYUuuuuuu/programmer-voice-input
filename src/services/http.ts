import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const requestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  }

  if (isTauriRuntime()) {
    return tauriFetch(url, requestInit)
  }

  return fetch(url, requestInit)
}
