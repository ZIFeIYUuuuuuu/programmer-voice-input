import type { VoiceStatus } from '../types/transcription'

interface StatusBadgeProps {
  status: VoiceStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status}</span>
}
