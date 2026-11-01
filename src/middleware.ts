import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand/vanilla'
import { connectPersist, detectMiddlewares, persistApiOf, type PersistConnection } from './integrations/persist'
import { StoreRecorder, type RecorderOptions } from './recorder'

export type Action = string | { type: string; [key: string]: unknown }

type Cast<T, U> = T extends U ? T : U
type Write<T, U> = Omit<T, keyof U> & U
type TakeTwo<T> = T extends { length: 0 }
  ? [undefined, undefined]
  : T extends { length: 1 }
    ? [...args0: Cast<T, Array<unknown>>, arg1: undefined]
    : T extends { length: 0 | 1 }
      ? [...args0: Cast<T, Array<unknown>>, arg1: undefined]
      : T extends { length: 2 }
        ? T
        : T extends { length: 1 | 2 }
          ? T
          : T extends { length: 0 | 1 | 2 }
            ? T
            : T extends [infer A0, infer A1, ...Array<unknown>]
              ? [A0, A1]
              : T extends [infer A0, (infer A1)?, ...Array<unknown>]
                ? [A0, A1?]
                : T extends [(infer A0)?, (infer A1)?, ...Array<unknown>]
                  ? [A0?, A1?]
                  : never

type StoreInspector<S> = S extends {
  setState: {
    (...args: infer Sa1): infer Sr1
    (...args: infer Sa2): infer Sr2
  }
}
  ? {
      setState(...args: [...args: TakeTwo<Sa1>, action?: Action]): Sr1
      setState(...args: [...args: TakeTwo<Sa2>, action?: Action]): Sr2
      inspector: { recorder: StoreRecorder<unknown> | undefined; dispose: () => void }
    }
  : never

type WithInspector<S> = Write<S, StoreInspector<S>>

declare module 'zustand/vanilla' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface StoreMutators<S, A> {
    'zustand-inspector': WithInspector<S>
  }
}

export interface InspectorOptions extends RecorderOptions {
  /** Defaults to `false` in production builds. */
  enabled?: boolean
  /** Name used when `set` is called without an action and no caller name can be inferred. */
  anonymousActionType?: string
  /** Infer the action name from the calling function (`increment` in `increment: () => set(...)`). Default true. */
  inferActionName?: boolean
}

type Inspector = <
  T,
  Mps extends Array<[StoreMutatorIdentifier, unknown]> = [],
  Mcs extends Array<[StoreMutatorIdentifier, unknown]> = [],
  U = T,
>(
  initializer: StateCreator<T, [...Mps, ['zustand-inspector', never]], Mcs, U>,
  options: InspectorOptions,
) => StateCreator<T, Mps, [['zustand-inspector', never], ...Mcs], U>

/**
 * Uses `process.env.NODE_ENV` on purpose: the consumer's bundler replaces it
 * literally (same signal TanStack's EventClient uses), while `import.meta.env`
 * would be frozen into this package's own build output.
 */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === 'production'
  } catch {
    return false
  }
}

const IGNORED_CALLERS = new Set([
  '',
  'anonymous',
  '<anonymous>',
  'setState',
  'namedSet',
  'eval',
  'Object',
])

/**
 * Frames from Zustand itself or another installed package: middlewares such as
 * `persist` and `immer` wrap `set`, so the caller that names the action is the
 * first frame above them. Covers node_modules paths and Vite's prebundled deps.
 */
const LIBRARY_FRAME = /[\\/]node_modules[\\/]|[\\/]\.vite[\\/]deps[\\/]/

/** Best-effort caller name from the stack (V8, SpiderMonkey and JavaScriptCore formats). */
export function inferCallerName(stack: string | undefined, skipUntil = 'namedSet'): string | undefined {
  if (!stack) return undefined
  // Keep only frame lines (drops V8's "Error" header). The stack is created
  // inside `namedSet`, so frame 0 is ours and frame 1 is the caller. Matching by
  // name is preferred, but minifiers rename `namedSet`, so fall back to position.
  const frames = stack.split('\n').filter((l) => /^\s*at\s/.test(l) || /@/.test(l))
  const at = frames.findIndex((line) => line.includes(skipUntil))
  let index = at === -1 ? 1 : at + 1
  while (index < frames.length && LIBRARY_FRAME.test(frames[index]!)) index++
  const line = frames[index]
  if (!line) return undefined
  const v8 = /^\s*at\s+(?:async\s+)?([^\s(]+)/.exec(line)
  const other = /^\s*([^@\s]*)@/.exec(line)
  const raw = v8?.[1] ?? other?.[1]
  if (!raw || raw.includes('/') || raw.includes(':')) return undefined
  const name = raw.split('.').pop()?.replace(/^\[|\]$/g, '').replace(/<$/, '') ?? ''
  if (IGNORED_CALLERS.has(name) || !/^[\w$]+$/.test(name)) return undefined
  return name
}

function resolveAction(
  action: Action | undefined,
  options: InspectorOptions,
  stack: string | undefined,
): { name: string; payload?: unknown } {
  if (typeof action === 'string') return { name: action }
  if (action && typeof action === 'object') {
    const { type, ...rest } = action
    return { name: type, payload: Object.keys(rest).length > 0 ? rest : undefined }
  }
  const inferred = options.inferActionName === false ? undefined : inferCallerName(stack)
  return { name: inferred ?? options.anonymousActionType ?? 'anonymous' }
}

const inspectorImpl =
  (fn: StateCreator<any, [], []>, options: InspectorOptions) =>
  (set: StoreApi<any>['setState'], get: StoreApi<any>['getState'], api: StoreApi<any>) => {
    if (options.enabled === false || (options.enabled === undefined && isProduction())) {
      return fn(set, get, api)
    }

    let recorder: StoreRecorder<any> | undefined
    let persist: PersistConnection | undefined
    let inSet = 0

    // Named so `inferCallerName` can find the frame right above it.
    // Count listeners so each action can report how many it notified.
    let listenerCount = 0
    const subscribe = api.subscribe
    // Changes that bypass `namedSet`: a middleware applied *outside* the inspector
    // (persist(inspector(…))) writes with the raw `set`. Record them anyway.
    // Subscribed before the wrapper below, so it isn't counted as a listener.
    subscribe(() => {
      if (inSet > 0 || !recorder || recorder.isSilent) return
      recorder.record(persistApiOf(api) ? 'persist/rehydrate' : 'setState (outside inspector)')
    })
    api.subscribe = (listener) => {
      listenerCount++
      const unsubscribe = subscribe(listener)
      let active = true
      return () => {
        if (active) {
          active = false
          listenerCount--
        }
        unsubscribe()
      }
    }

    function namedSet(partial: any, replace?: any, action?: Action) {
      // persist's rehydration writes through this `set` with no action name.
      const hydrating = action === undefined && persist?.hydrating === true
      const stack =
        action === undefined && !hydrating && options.inferActionName !== false ? new Error().stack : undefined
      const before = get()
      const start = now()
      inSet++
      let result: unknown
      try {
        // Zustand runs its listeners synchronously inside set(), so this times them too.
        result = (set as any)(partial, replace)
      } finally {
        inSet--
      }
      const end = now()
      if (recorder && !recorder.isSilent) {
        const { name, payload } = hydrating ? { name: 'persist/rehydrate', payload: undefined } : resolveAction(action, options, stack)
        const listeners = Object.is(before, get()) ? 0 : listenerCount
        recorder.record(name, payload, 'app', { start, end, listeners })
      }
      return result
    }

    api.setState = namedSet as StoreApi<any>['setState']
    const initialState = fn(namedSet as StoreApi<any>['setState'], get, api)

    recorder = new StoreRecorder(
      { getState: get, setState: (state) => (set as any)(state, true) },
      initialState,
      options,
    )
    const connect = () => {
      if (!recorder || persist) return
      const persistApi = persistApiOf(api)
      if (persistApi) persist = connectPersist(persistApi, recorder, api)
      else {
        const others = detectMiddlewares(api)
        if (Object.keys(others).length > 0) recorder.setMiddlewares(others)
      }
    }
    connect()
    // A middleware applied outside the inspector attaches its api after this
    // creator returns (persist(inspector(…))): look again once creation is done.
    queueMicrotask(connect)
    ;(api as any).inspector = {
      recorder,
      dispose: () => {
        persist?.dispose()
        recorder?.dispose()
      },
    }
    return initialState
  }

/**
 * Records every `set` with its action name and keeps the original state objects
 * in the page, so the panel can time travel without a lossy JSON round trip.
 *
 * ```ts
 * const store = createStore<State>()(
 *   inspector((set) => ({ count: 0, inc: () => set((s) => ({ count: s.count + 1 }), false, 'inc') }), { name: 'counter' }),
 * )
 * ```
 */
export const inspector = inspectorImpl as unknown as Inspector

/**
 * Inspect an existing store without changing how it was created.
 * Action names are not available on this path (everything is recorded as `anonymousActionType`).
 * Returns a cleanup function.
 */
export function inspectStore<T>(
  store: StoreApi<T>,
  options: Omit<InspectorOptions, 'inferActionName'>,
): () => void {
  if (options.enabled === false || (options.enabled === undefined && isProduction())) {
    return () => {}
  }
  const recorder = new StoreRecorder<T>(
    { getState: store.getState, setState: (state) => store.setState(state, true as any) },
    store.getState(),
    options,
  )
  const persistApi = persistApiOf(store)
  const persist = persistApi ? connectPersist(persistApi, recorder, store) : undefined
  if (!persist) {
    const others = detectMiddlewares(store)
    if (Object.keys(others).length > 0) recorder.setMiddlewares(others)
  }
  const unsubscribe = store.subscribe(() => {
    if (recorder.isSilent) return
    recorder.record(persist?.hydrating ? 'persist/rehydrate' : (options.anonymousActionType ?? 'setState'))
  })
  return () => {
    unsubscribe()
    persist?.dispose()
    recorder.dispose()
  }
}
