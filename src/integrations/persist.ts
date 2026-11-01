import type { MiddlewareInfo, PersistInfo } from '../protocol'
import type { StoreRecorder } from '../recorder'

/** The parts of `api.persist` (zustand/middleware `persist`) the inspector uses. */
interface PersistApi {
  getOptions(): {
    name?: string
    version?: number
    skipHydration?: boolean
    partialize?: (state: any) => unknown
    storage?: {
      getItem(name: string): { state: unknown; version?: number } | null | Promise<{ state: unknown; version?: number } | null>
    }
  }
  rehydrate(): Promise<void> | void
  hasHydrated(): boolean
  clearStorage(): void
  onHydrate(listener: (state: any) => void): () => void
  onFinishHydration(listener: (state: any) => void): () => void
}

export function persistApiOf(api: unknown): PersistApi | undefined {
  const persist = (api as { persist?: Partial<PersistApi> } | undefined)?.persist
  return persist && typeof persist.getOptions === 'function' && typeof persist.hasHydrated === 'function'
    ? (persist as PersistApi)
    : undefined
}

/** Middlewares other than persist that leave a mark on the store api. */
export function detectMiddlewares(api: unknown): MiddlewareInfo {
  const a = api as Record<string, unknown>
  const info: MiddlewareInfo = {}
  if (typeof a.dispatch === 'function' && 'dispatchFromDevtools' in a) info.redux = true
  if (a.devtools !== undefined) info.devtools = true
  return info
}

function persistedKeys(persist: PersistApi, state: unknown): Array<string> | undefined {
  try {
    const partialize = persist.getOptions().partialize ?? ((s: unknown) => s)
    const value = partialize(state)
    if (typeof value !== 'object' || value === null) return undefined
    // JSON storage drops functions, so they are never really persisted.
    return Object.keys(value).filter((k) => typeof (value as Record<string, unknown>)[k] !== 'function')
  } catch {
    return undefined
  }
}

export interface PersistConnection {
  /** True between persist's onHydrate and onFinishHydration: sets then are the rehydration. */
  readonly hydrating: boolean
  dispose(): void
}

/**
 * Connects a store's `persist` middleware to the panel: hydration status and
 * persisted keys, the stored value on request, and rehydrate / clear commands.
 */
export function connectPersist(
  persist: PersistApi,
  recorder: StoreRecorder<any>,
  api: { getState(): unknown },
): PersistConnection {
  const options = () => persist.getOptions()
  // Async storage may still be loading when the store is created.
  let hydrating = !persist.hasHydrated() && !options().skipHydration

  const info = (): PersistInfo => {
    const o = options()
    const keys = persistedKeys(persist, api.getState())
    return {
      name: o.name ?? '',
      version: o.version ?? 0,
      hydrated: persist.hasHydrated(),
      ...(o.skipHydration ? { skipHydration: true } : {}),
      ...(keys ? { keys } : {}),
    }
  }
  const publish = () => recorder.setMiddlewares({ ...detectMiddlewares(api), persist: info() })

  const read = async () => {
    const o = options()
    const partialize = o.partialize ?? ((s: unknown) => s)
    let current: unknown
    try {
      current = recorder.serializeValue(partialize(api.getState()))
      const raw = o.storage ? await o.storage.getItem(o.name ?? '') : null
      recorder.sendPersisted({
        stored: raw
          ? { state: recorder.serializeValue(raw.state), ...(raw.version !== undefined ? { version: raw.version } : {}) }
          : null,
        current,
      })
    } catch (error) {
      recorder.sendPersisted({ stored: null, current, error: error instanceof Error ? error.message : String(error) })
    }
  }

  const disposers = [
    persist.onHydrate(() => {
      hydrating = true
      publish()
    }),
    persist.onFinishHydration(() => {
      hydrating = false
      publish()
    }),
    recorder.onCommand('persist:rehydrate', () => {
      void Promise.resolve(persist.rehydrate()).then(read, read)
    }),
    recorder.onCommand('persist:clear', () => {
      persist.clearStorage()
      void read()
    }),
    recorder.onCommand('persist:read', () => void read()),
  ]
  publish()

  return {
    get hydrating() {
      return hydrating
    },
    dispose() {
      for (const d of disposers) d()
    },
  }
}
