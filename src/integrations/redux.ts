import type { InspectorIntegration } from './types'

interface ReduxApi {
  dispatch(action: { type: string }): unknown
}

/** Dispatches seen per store, for the facts and the Dispatch placeholder. */
const seen = new WeakMap<ReduxApi, { count: number; types: Set<string>; last?: unknown }>()

/** `redux`: what has been dispatched, and a Dispatch command that takes an action as JSON. */
export const reduxIntegration: InspectorIntegration<ReduxApi> = {
  id: 'redux',
  label: 'redux',
  icon: 'dispatch',
  description: 'Actions come from the redux middleware: dispatch(action) runs the reducer and keeps its type and payload.',
  detect: (api) => {
    const a = api as unknown as Record<string, unknown>
    return typeof a.dispatch === 'function' && 'dispatchFromDevtools' in a ? (api as unknown as ReduxApi) : undefined
  },
  setup(api, ctx) {
    const stats: { count: number; types: Set<string>; last?: unknown } = { count: 0, types: new Set() }
    seen.set(api, stats)
    const dispatch = api.dispatch
    api.dispatch = (action) => {
      stats.count++
      if (action && typeof action.type === 'string') stats.types.add(action.type)
      stats.last = action
      ctx.update()
      return dispatch(action)
    }
    return () => {
      api.dispatch = dispatch
    }
  },
  facts(api) {
    const stats = seen.get(api)
    return [
      { label: 'Dispatched', value: stats?.count ?? 0 },
      { label: 'Action types', value: stats && stats.types.size > 0 ? [...stats.types].join(', ') : 'none yet' },
    ]
  },
  commands(api) {
    const last = seen.get(api)?.last
    return [
      {
        id: 'dispatch',
        label: 'Dispatch',
        tone: 'primary',
        description: 'Run the reducer with this action',
        input: {
          kind: 'json',
          label: 'Action',
          placeholder: last !== undefined ? safeJson(last) : '{ "type": "increment" }',
        },
        run(target, input) {
          if (!input || typeof input !== 'object' || typeof (input as { type?: unknown }).type !== 'string') {
            throw new Error('An action needs a string "type", for example { "type": "increment" }.')
          }
          target.dispatch(input as { type: string })
        },
      },
    ]
  },
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '{ "type": "" }'
  }
}
