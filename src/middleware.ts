import type { StateCreator, StoreApi, StoreMutatorIdentifier } from 'zustand/vanilla'
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

/** Best-effort caller name from the stack (V8, SpiderMonkey and JavaScriptCore formats). */
export function inferCallerName(stack: string | undefined, skipUntil = 'namedSet'): string | undefined {
  if (!stack) return undefined
  // Keep only frame lines (drops V8's "Error" header). The stack is created
  // inside `namedSet`, so frame 0 is ours and frame 1 is the caller. Matching by
  // name is preferred, but minifiers rename `namedSet`, so fall back to position.
  const frames = stack.split('\n').filter((l) => /^\s*at\s/.test(l) || /@/.test(l))
  const at = frames.findIndex((line) => line.includes(skipUntil))
  const line = frames[at === -1 ? 1 : at + 1]
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

    // Named so `inferCallerName` can find the frame right above it.
    // Count listeners so each action can report how many it notified.
    let listenerCount = 0
    const subscribe = api.subscribe
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
      const stack =
        action === undefined && options.inferActionName !== false ? new Error().stack : undefined
      const before = get()
      const start = now()
      // Zustand runs its listeners synchronously inside set(), so this times them too.
      const result = (set as any)(partial, replace)
      const end = now()
      if (recorder && !recorder.isSilent) {
        const { name, payload } = resolveAction(action, options, stack)
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
    ;(api as any).inspector = { recorder, dispose: () => recorder?.dispose() }
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
  const unsubscribe = store.subscribe(() => {
    if (!recorder.isSilent) recorder.record(options.anonymousActionType ?? 'setState')
  })
  return () => {
    unsubscribe()
    recorder.dispose()
  }
}
