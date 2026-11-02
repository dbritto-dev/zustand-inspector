import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand/vanilla'
import { devtoolsEnabled } from './env'
import { builtInIntegrations, type InspectorIntegration } from './integrations'
import { IntegrationRuntime } from './integrations/runtime'
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
  /**
   * Record this store. Defaults to on in development (`process.env.NODE_ENV ===
   * 'development'`) and off otherwise; `zustand-inspector/production` turns it on.
   */
  enabled?: boolean
  /** Name used when `set` is called without an action and no caller name can be inferred. */
  anonymousActionType?: string
  /** Infer the action name from the calling function (`increment` in `increment: () => set(...)`). Default true. */
  inferActionName?: boolean
  /**
   * Middleware integrations to look for on the store. Defaults to Zustand's own
   * (`persist`, `redux`, `subscribeWithSelector`, `immer`, `devtools`); pass
   * `[...builtInIntegrations, mine]` to add yours. Experimental.
   */
  integrations?: ReadonlyArray<InspectorIntegration>
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

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  for (let index = at === -1 ? 1 : at + 1; index < frames.length; index++) {
    const line = frames[index]!
    // Middlewares that wrap `set` (persist, immer…) sit between `set` and the
    // action: skip library frames, and wrappers named setState (immer's
    // `store.setState = …`) even when they are bundled into the app.
    if (LIBRARY_FRAME.test(line)) continue
    const name = frameName(line)
    if (name === 'setState') continue
    if (!name || IGNORED_CALLERS.has(name) || !/^[\w$]+$/.test(name)) return undefined
    return name
  }
  return undefined
}

function frameName(line: string): string | undefined {
  const v8 = /^\s*at\s+(?:async\s+)?([^\s(]+)/.exec(line)
  const other = /^\s*([^@\s]*)@/.exec(line)
  const raw = v8?.[1] ?? other?.[1]
  if (!raw || raw.includes('/') || raw.includes(':')) return undefined
  return raw.split('.').pop()?.replace(/^\[|\]$/g, '').replace(/<$/, '') ?? ''
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
    if (!(options.enabled ?? devtoolsEnabled())) {
      return fn(set, get, api)
    }

    let recorder: StoreRecorder<any> | undefined
    let integrations: IntegrationRuntime | undefined
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
      // The middleware that wrote may only have attached its api just now.
      integrations?.connect()
      const label = integrations?.label()
      recorder.record(label?.name ?? 'setState (outside inspector)', undefined, 'app', undefined, label?.via)
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
      // Middlewares write through this `set` with no action name (persist's
      // rehydration, say): an integration may know what to call it.
      const label = action === undefined ? integrations?.label() : undefined
      const stack =
        action === undefined && !label && options.inferActionName !== false ? new Error().stack : undefined
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
        const { name, payload } = label ? { name: label.name, payload: undefined } : resolveAction(action, options, stack)
        const listeners = Object.is(before, get()) ? 0 : listenerCount
        recorder.record(name, payload, 'app', { start, end, listeners }, label?.via)
        integrations?.schedulePublish()
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
    integrations = new IntegrationRuntime(api, recorder, options.integrations ?? builtInIntegrations)
    integrations.connect()
    // A middleware applied outside the inspector attaches its api after this
    // creator returns (persist(inspector(…))): look again once creation is done.
    queueMicrotask(() => integrations?.connect())
    ;(api as any).inspector = {
      recorder,
      dispose: () => {
        integrations?.dispose()
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
  if (!(options.enabled ?? devtoolsEnabled())) {
    return () => {}
  }
  const recorder = new StoreRecorder<T>(
    { getState: store.getState, setState: (state) => store.setState(state, true as any) },
    store.getState(),
    options,
  )
  const integrations = new IntegrationRuntime(
    store as StoreApi<any>,
    recorder,
    options.integrations ?? builtInIntegrations,
  )
  const unsubscribe = store.subscribe(() => {
    if (recorder.isSilent) return
    const label = integrations.label()
    recorder.record(label?.name ?? options.anonymousActionType ?? 'setState', undefined, 'app', undefined, label?.via)
    integrations.schedulePublish()
  })
  integrations.connect()
  return () => {
    unsubscribe()
    integrations.dispose()
    recorder.dispose()
  }
}
