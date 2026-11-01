import { diff as computeDiff } from './diff'
import type {
  ActionMeta,
  ActionSource,
  Command,
  InspectorEvents,
  SessionExport,
  StoreInfo,
} from './protocol'
import { PROTOCOL_VERSION } from './protocol'
import { reviveInto, serialize, type SerializeOptions } from './serialize'
import { envelope, globals, isOwnMessage } from './session'
import { getDefaultTransport, type Transport } from './transport'

export interface RecorderOptions extends SerializeOptions {
  /** Display name and store id. Keep it unique per page; re-registering a name replaces the old store (HMR). */
  name: string
  /** Ring-buffer size. Older actions are evicted. Default 100. */
  maxHistory?: number
  /** Compute a structural diff per action. Default true. */
  diff?: boolean
  /** Map state before it is serialized (hide or reshape fields), like NgRx's `withMapper`. */
  sanitize?: (state: any) => unknown
  /** Defaults to the shared TanStack Devtools transport. */
  transport?: Transport
}

/** The minimal store surface the recorder needs. `setState` must replace and must not be recorded. */
export interface RecorderTarget<T> {
  getState(): T
  setState(state: T): void
}

interface Entry<T> {
  meta: ActionMeta
  /** The original state object, never serialized: this is what makes time travel lossless. */
  state: T
}

type Registry = Map<string, StoreRecorder<any>>

function registry(): Registry {
  const g = globals()
  return ((g.recorders as Registry | undefined) ??= new Map())
}

/** All live recorders on this page (used by tests and custom panels). */
export function getRecorders(): Array<StoreRecorder<any>> {
  return [...registry().values()]
}

export class StoreRecorder<T> {
  readonly storeId: string
  readonly name: string
  readonly maxHistory: number

  #target: RecorderTarget<T>
  #options: RecorderOptions
  #transport: Transport
  #history: Array<Entry<T>> = []
  #seq = 0
  #currentId = 0
  #dropped = 0
  #paused = false
  #dirtyWhilePaused = false
  #silent = 0
  #initialState: T
  #lastSerialized: unknown
  #disposers: Array<() => void> = []
  #disposed = false

  constructor(target: RecorderTarget<T>, initialState: T, options: RecorderOptions) {
    this.name = options.name
    this.storeId = options.name
    this.maxHistory = Math.max(1, options.maxHistory ?? 100)
    this.#target = target
    this.#options = options
    this.#transport = options.transport ?? getDefaultTransport()
    this.#initialState = initialState

    const existing = registry().get(this.storeId)
    if (existing) existing.dispose({ silent: true })
    registry().set(this.storeId, this)

    this.#disposers.push(
      this.#transport.on('hello', (msg) => {
        if (!isOwnMessage(msg)) return
        // The panel reopened the shared transport before saying hello. Reconnecting
        // here would re-enter TanStack's queue flush (it re-emits `hello` forever).
        this.#announce()
      }),
      this.#transport.on('command', (msg) => {
        if (!isOwnMessage(msg) || msg.storeId !== this.storeId) return
        this.handle(msg.command)
      }),
    )

    this.#push('@@init', undefined, 'init', initialState)
    this.#announce()
  }

  /** True while the recorder itself is writing to the store (jump, reset…). */
  get isSilent(): boolean {
    return this.#silent > 0
  }

  get paused(): boolean {
    return this.#paused
  }

  get currentId(): number {
    return this.#currentId
  }

  /** Action metadata currently in the ring buffer, oldest first. */
  get actions(): Array<ActionMeta> {
    return this.#history.map((e) => e.meta)
  }

  /** The original (non-serialized) state recorded for an action id. */
  stateAt(id: number): T | undefined {
    return this.#history.find((e) => e.meta.id === id)?.state
  }

  /** Record the store's current state as a new action. */
  record(name: string, payload?: unknown, source: ActionSource = 'app'): void {
    if (this.#disposed || this.isSilent) return
    if (this.#paused) {
      this.#dirtyWhilePaused = true
      return
    }
    // A change while time travelling branches the history: the actions after the
    // state being viewed never led here, so they are discarded (undo/redo
    // semantics) and the new action records where it branched from.
    const branch = this.#discardFuture()
    const entry = this.#push(name, payload, source, this.#target.getState())
    if (branch) entry.meta.branch = branch
    this.#send('action', {
      ...envelope(),
      storeId: this.storeId,
      action: entry.meta,
      state: this.#lastSerialized,
      currentId: this.#currentId,
      dropped: this.#dropped,
    })
  }

  /** Drop the entries after the current one; returns what was dropped, if anything. */
  #discardFuture(): { fromId: number; count: number } | undefined {
    const index = this.#history.findIndex((e) => e.meta.id === this.#currentId)
    if (index === -1 || index === this.#history.length - 1) return undefined
    const removed = this.#history.splice(index + 1)
    return { fromId: this.#currentId, count: removed.length }
  }

  handle(command: Command): void {
    if (this.#disposed) return
    switch (command.type) {
      case 'jump':
        return this.jump(command.toId)
      case 'pause':
        return this.pause()
      case 'resume':
        return this.resume()
      case 'reset':
        return this.reset()
      case 'commit':
        return this.commit()
      case 'import':
        return this.import(command.state)
      case 'snapshot': {
        const entry = this.#history.find((e) => e.meta.id === command.id)
        if (!entry) return
        this.#send('snapshot', {
          ...envelope(),
          storeId: this.storeId,
          id: command.id,
          state: this.#serialize(entry.state),
        })
        return
      }
      case 'export':
        this.#send('export', { ...envelope(), storeId: this.storeId, data: this.exportSession() })
        return
    }
  }

  /** Time travel: restore the exact original object recorded for `id`. */
  jump(id: number): void {
    const entry = this.#history.find((e) => e.meta.id === id)
    if (!entry) return
    this.#write(entry.state)
    this.#currentId = id
    this.#lastSerialized = this.#serialize(entry.state)
    this.#send('jumped', {
      ...envelope(),
      storeId: this.storeId,
      currentId: id,
      state: this.#lastSerialized,
    })
  }

  pause(): void {
    if (this.#paused) return
    this.#paused = true
    this.#dirtyWhilePaused = false
    this.#send('status', { ...envelope(), storeId: this.storeId, paused: true })
  }

  resume(): void {
    if (!this.#paused) return
    this.#paused = false
    this.#send('status', { ...envelope(), storeId: this.storeId, paused: false })
    if (this.#dirtyWhilePaused) {
      this.#dirtyWhilePaused = false
      this.record('devtools/resume', undefined, 'devtools')
    }
  }

  /** Back to the initial state, history cleared. */
  reset(): void {
    this.#write(this.#initialState)
    this.#history = []
    this.#dropped = 0
    this.#push('@@init', undefined, 'init', this.#initialState)
    this.#announce()
  }

  /** Keep the current state, forget the history before it. */
  commit(): void {
    const state = this.#target.getState()
    this.#history = []
    this.#dropped = 0
    this.#push('devtools/commit', undefined, 'devtools', state)
    this.#announce()
  }

  /** Apply serialized state (from an export); actions and redacted fields keep their live values. */
  import(encoded: unknown): void {
    const next = reviveInto(this.#target.getState(), encoded)
    this.#write(next)
    const wasPaused = this.#paused
    this.#paused = false
    this.record('devtools/import', undefined, 'devtools')
    this.#paused = wasPaused
  }

  exportSession(): SessionExport {
    return {
      format: 'zustand-inspector-session',
      v: PROTOCOL_VERSION,
      name: this.name,
      exportedAt: Date.now(),
      entries: this.#history.map((e) => ({ ...e.meta, state: this.#serialize(e.state) })),
    }
  }

  describe(): StoreInfo {
    return {
      storeId: this.storeId,
      name: this.name,
      currentId: this.#currentId,
      paused: this.#paused,
      maxHistory: this.maxHistory,
      dropped: this.#dropped,
      actions: this.actions,
      state: this.#serialize(this.#liveState()),
    }
  }

  /** The store's state, or the recorded one while the store is still being created. */
  #liveState(): T {
    const live = this.#target.getState()
    if (live !== undefined) return live
    return this.stateAt(this.#currentId) ?? this.#initialState
  }

  dispose({ silent = false }: { silent?: boolean } = {}): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#disposers.forEach((d) => d())
    this.#disposers = []
    if (registry().get(this.storeId) === this) registry().delete(this.storeId)
    if (!silent) this.#send('removed', { ...envelope(), storeId: this.storeId })
  }

  #push(name: string, payload: unknown, source: ActionSource, state: T): Entry<T> {
    const serialized = this.#serialize(state)
    const meta: ActionMeta = { id: ++this.#seq, name, ts: Date.now(), source }
    if (payload !== undefined) meta.payload = this.#serializeValue(payload)
    if (this.#options.diff !== false && this.#history.length > 0) {
      const { changes, truncated } = computeDiff(this.#lastSerialized, serialized)
      meta.changes = changes
      if (truncated) meta.changesTruncated = true
    }
    const entry: Entry<T> = { meta, state }
    this.#history.push(entry)
    while (this.#history.length > this.maxHistory) {
      this.#history.shift()
      this.#dropped++
    }
    this.#currentId = meta.id
    this.#lastSerialized = serialized
    return entry
  }

  #write(state: T): void {
    this.#silent++
    try {
      this.#target.setState(state)
    } finally {
      this.#silent--
    }
  }

  #announce(): void {
    this.#send('store', { ...envelope(), ...this.describe() })
  }

  #serialize(state: T): unknown {
    const mapped = this.#options.sanitize ? this.#options.sanitize(state) : state
    return this.#serializeValue(mapped)
  }

  #serializeValue(value: unknown): unknown {
    return serialize(value, this.#options)
  }

  #send<K extends keyof InspectorEvents>(type: K, payload: InspectorEvents[K]): void {
    try {
      this.#transport.send(type, payload)
    } catch (error) {
      // Devtools must never break the app.
      if (typeof console !== 'undefined') console.warn('[zustand-inspector]', error)
    }
  }
}
