import type { InspectorIntegration } from './types'

/** The parts of `api.persist` (zustand/middleware `persist`) the integration uses. */
export interface PersistApi {
  getOptions(): {
    name?: string
    version?: number
    skipHydration?: boolean
    partialize?: (state: any) => unknown
    storage?: {
      getItem(
        name: string,
      ): { state: unknown; version?: number } | null | Promise<{ state: unknown; version?: number } | null>
    }
  }
  rehydrate(): Promise<void> | void
  hasHydrated(): boolean
  clearStorage(): void
  onHydrate(listener: (state: any) => void): () => void
  onFinishHydration(listener: (state: any) => void): () => void
}

function persistedKeys(persist: PersistApi, state: unknown): Array<string> | undefined {
  try {
    const value = (persist.getOptions().partialize ?? ((s: unknown) => s))(state)
    if (typeof value !== 'object' || value === null) return undefined
    // JSON storage drops functions, so they are never really persisted.
    return Object.keys(value).filter((k) => typeof (value as Record<string, unknown>)[k] !== 'function')
  } catch {
    return undefined
  }
}

/** True between persist's onHydrate and onFinishHydration, per persist api. */
const hydrating = new WeakMap<PersistApi, boolean>()

/**
 * `persist`: storage key, version, hydration and persisted keys; the stored
 * value compared with the current state; rehydrate and clear. Rehydration is
 * recorded as `persist/rehydrate`.
 */
export const persistIntegration: InspectorIntegration<PersistApi> = {
  id: 'persist',
  label: 'persist',
  icon: 'storage',
  description: 'Saves state to storage (localStorage by default) and restores it when the page loads.',
  detect(api) {
    const persist = (api as { persist?: Partial<PersistApi> }).persist
    return persist && typeof persist.getOptions === 'function' && typeof persist.hasHydrated === 'function'
      ? (persist as PersistApi)
      : undefined
  },
  setup(persist, ctx) {
    // Async storage may still be loading, and a persist that wraps the inspector
    // connects in the middle of its first hydration.
    hydrating.set(persist, !persist.hasHydrated() && !persist.getOptions().skipHydration)
    const offStart = persist.onHydrate(() => {
      hydrating.set(persist, true)
      ctx.update()
    })
    const offEnd = persist.onFinishHydration(() => {
      hydrating.set(persist, false)
      ctx.update()
    })
    return () => {
      offStart()
      offEnd()
    }
  },
  writing: (persist) => (hydrating.get(persist) ? 'persist/rehydrate' : undefined),
  status(persist) {
    if (persist.hasHydrated()) return { tone: 'success', text: 'Hydrated' }
    if (persist.getOptions().skipHydration) {
      return { tone: 'warning', text: 'Not hydrated yet: skipHydration is on, so the app calls rehydrate()' }
    }
    return { tone: 'info', text: 'Hydrating…' }
  },
  facts(persist, state) {
    const options = persist.getOptions()
    const keys = persistedKeys(persist, state)
    return [
      { label: 'Storage key', value: options.name ?? '' },
      { label: 'Version', value: options.version ?? 0 },
      { label: 'Persisted keys', value: keys ? keys.join(', ') || 'none' : 'unknown' },
    ]
  },
  async inspect(persist, state) {
    const options = persist.getOptions()
    const current = (options.partialize ?? ((s: unknown) => s))(state)
    const stored = options.storage ? await options.storage.getItem(options.name ?? '') : null
    const version = options.version ?? 0
    return {
      title: 'Stored value',
      value: stored ? stored.state : null,
      empty: `Nothing is stored under "${options.name ?? ''}".`,
      ...(stored ? { compare: { with: current, label: 'the current state' } } : {}),
      ...(stored && typeof stored.version === 'number' && stored.version !== version
        ? {
            note: `Stored with version ${stored.version}; the store is on version ${version}, so migrate runs on the next rehydrate.`,
          }
        : {}),
    }
  },
  commands: () => [
    {
      id: 'clear',
      label: 'Clear storage',
      tone: 'destructive',
      description: 'Remove the stored value. The store keeps its current state until it is saved again.',
      run: (persist) => persist.clearStorage(),
    },
    {
      id: 'rehydrate',
      label: 'Rehydrate',
      tone: 'primary',
      description: 'Load the stored value into the store, as on page load',
      run: (persist) => persist.rehydrate(),
    },
  ],
}
