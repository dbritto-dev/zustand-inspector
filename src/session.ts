import { PROTOCOL_VERSION, type Envelope } from './protocol'

/**
 * Per-page singletons live on globalThis so that duplicated module copies
 * (HMR, separately bundled panel and app code) still agree on one session.
 */
interface InspectorGlobals {
  session?: string
  [key: string]: unknown
}

const KEY = '__ZUSTAND_INSPECTOR__'

export function globals(): InspectorGlobals {
  const g = globalThis as unknown as Record<string, InspectorGlobals | undefined>
  return (g[KEY] ??= {})
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function getSessionId(): string {
  const g = globals()
  return (g.session ??= randomId())
}

export function envelope(): Envelope {
  return { v: PROTOCOL_VERSION, session: getSessionId() }
}

/** True when a message belongs to this page and speaks our protocol version. */
export function isOwnMessage(msg: Partial<Envelope> | undefined): boolean {
  return (
    !!msg && msg.v === PROTOCOL_VERSION && msg.session === getSessionId()
  )
}
