/**
 * Wire protocol between the in-page recorder and any panel.
 *
 * Design rules (borrowed from Stately's versioned envelope, Devframe's
 * "page is the authority" channel and zustand-devtools-bridge):
 * - Every message carries `v` (protocol version) and `session` (per page),
 *   because the TanStack bus mirrors events to other tabs via BroadcastChannel.
 * - Payloads are JSON-safe (tagged values produced by `serialize`).
 * - Panels never send state back for time travel: they send commands by id.
 *   Only `import` carries state, and it is recorded as a `devtools/import` action.
 */

export const PROTOCOL_VERSION = 1 as const
export const PLUGIN_ID = 'zustand-inspector'

/** JSON-safe value produced by `serialize` (may contain `{ $t: ... }` tags). */
export type Serialized = unknown

export type ChangeKind = 'added' | 'removed' | 'changed'

export interface Change {
  path: Array<string | number>
  kind: ChangeKind
  from?: Serialized
  to?: Serialized
}

export type ActionSource = 'init' | 'app' | 'devtools'

export interface ActionMeta {
  id: number
  name: string
  ts: number
  source: ActionSource
  payload?: Serialized
  /** Structural changes compared with the previous recorded state. */
  changes?: Array<Change>
  /** True when the diff hit its size limit. */
  changesTruncated?: boolean
}

export interface StoreInfo {
  storeId: string
  name: string
  currentId: number
  paused: boolean
  maxHistory: number
  /** How many old actions were evicted from the ring buffer. */
  dropped: number
  actions: Array<ActionMeta>
  state: Serialized
}

export type Command =
  | { type: 'jump'; toId: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'commit' }
  | { type: 'import'; state: Serialized }
  | { type: 'snapshot'; id: number }
  | { type: 'export' }

export interface SessionExport {
  format: 'zustand-inspector-session'
  v: typeof PROTOCOL_VERSION
  name: string
  exportedAt: number
  entries: Array<ActionMeta & { state: Serialized }>
}

export interface Envelope {
  v: typeof PROTOCOL_VERSION
  session: string
}

/** Event map. Keys are suffixes: the TanStack EventClient prefixes the plugin id. */
export type InspectorEvents = {
  /** panel → page: "I just mounted, send me everything" (late-mount sync). */
  hello: Envelope
  /** page → panel: full description of one store (on register, sync, reset, commit). */
  store: Envelope & StoreInfo
  /** page → panel: one recorded action plus the latest state. */
  action: Envelope & {
    storeId: string
    action: ActionMeta
    state: Serialized
    currentId: number
    dropped: number
  }
  /** page → panel: time travel happened. */
  jumped: Envelope & { storeId: string; currentId: number; state: Serialized }
  /** page → panel: recording paused/resumed. */
  status: Envelope & { storeId: string; paused: boolean }
  /** page → panel: reply to a `snapshot` command. */
  snapshot: Envelope & { storeId: string; id: number; state: Serialized }
  /** page → panel: reply to an `export` command. */
  export: Envelope & { storeId: string; data: SessionExport }
  /** page → panel: store was disposed. */
  removed: Envelope & { storeId: string }
  /** panel → page: a command for one store. */
  command: Envelope & { storeId: string; command: Command }
}

export type InspectorEventName = keyof InspectorEvents
