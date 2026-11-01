import type { SessionExport } from './protocol'

export function isSessionExport(data: unknown): data is SessionExport {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as SessionExport).format === 'zustand-inspector-session' &&
    Array.isArray((data as SessionExport).entries)
  )
}

/** The state to import from a file: the last entry of a session export, or the file itself. */
export function stateFromImport(data: unknown): unknown {
  return isSessionExport(data) ? data.entries.at(-1)?.state : data
}

export function downloadJson(data: SessionExport): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date(data.exportedAt).toISOString().replace(/[:.]/g, '-')
  a.href = url
  a.download = `${data.name}-${stamp}.zustand.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
