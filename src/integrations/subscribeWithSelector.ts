import type { StoreApi } from 'zustand/vanilla'
import type { InspectorIntegration } from './types'

interface Subscription {
  id: number
  selector: string
  equality: string
  fireImmediately: boolean
  fires: number
  lastFiredOn?: number
}

type SelectorSubscribe = (
  selector: (state: any) => unknown,
  listener?: (slice: unknown, previous: unknown) => void,
  options?: { equalityFn?: (a: any, b: any) => boolean; fireImmediately?: boolean },
) => () => void

const subscriptions = new WeakMap<StoreApi<any>, Map<number, Subscription>>()

/** Source of a function, on one line and short: `(s) => s.count`. */
function sourceOf(fn: unknown, max = 90): string {
  if (typeof fn !== 'function') return String(fn)
  let text: string
  try {
    text = Function.prototype.toString.call(fn).replace(/\s+/g, ' ').trim()
  } catch {
    text = fn.name || 'anonymous'
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * `subscribeWithSelector`: every selector subscription, with its equality
 * function, how often its listener fired and on which action it last did.
 * Only subscriptions made after the store was created are seen (that's all of
 * them in practice: nothing can subscribe before `create` returns).
 */
export const subscribeWithSelectorIntegration: InspectorIntegration<StoreApi<any>> = {
  id: 'subscribeWithSelector',
  label: 'subscriptions',
  icon: 'subscriptions',
  description:
    'subscribeWithSelector: listeners that run only when their selected slice changes, by the equality function.',
  // Zustand's own subscribe takes one argument; subscribeWithSelector's takes three.
  detect: (api) => (api.subscribe.length >= 2 ? api : undefined),
  setup(api, ctx) {
    const subs = new Map<number, Subscription>()
    subscriptions.set(api, subs)
    let nextId = 0
    const subscribe = api.subscribe as unknown as SelectorSubscribe
    const wrapped: SelectorSubscribe = (selector, listener, options) => {
      if (!listener) return subscribe(selector)
      const sub: Subscription = {
        id: ++nextId,
        selector: sourceOf(selector),
        equality: options?.equalityFn ? sourceOf(options.equalityFn, 40) : 'Object.is',
        fireImmediately: options?.fireImmediately === true,
        fires: 0,
      }
      subs.set(sub.id, sub)
      ctx.update()
      // fireImmediately calls the listener inside subscribe(), not on an action.
      let subscribing = true
      const unsubscribe = subscribe(
        selector,
        (slice, previous) => {
          sub.fires++
          if (!subscribing) sub.lastFiredOn = ctx.nextActionId()
          ctx.update()
          listener(slice, previous)
        },
        options,
      )
      subscribing = false
      return () => {
        subs.delete(sub.id)
        ctx.update()
        unsubscribe()
      }
    }
    api.subscribe = wrapped as unknown as StoreApi<any>['subscribe']
    return () => {
      api.subscribe = subscribe as unknown as StoreApi<any>['subscribe']
    }
  },
  facts(api) {
    const subs = subscriptions.get(api)
    const all = subs ? [...subs.values()] : []
    return [
      { label: 'Selector subscriptions', value: all.length },
      { label: 'Listener calls', value: all.reduce((n, s) => n + s.fires, 0) },
    ]
  },
  inspect(api) {
    const all = [...(subscriptions.get(api)?.values() ?? [])]
    return {
      title: 'Subscriptions',
      rows: all.map((s) => ({
        title: s.selector,
        detail: [
          s.equality === 'Object.is' ? 'Object.is' : `equality: ${s.equality}`,
          s.fireImmediately ? 'fireImmediately' : '',
        ]
          .filter(Boolean)
          .join(' · '),
        meta:
          s.fires === 0
            ? 'not fired yet'
            : `fired ${s.fires} time${s.fires === 1 ? '' : 's'}${s.lastFiredOn !== undefined ? `, last on #${s.lastFiredOn}` : ', on subscribe'}`,
      })),
      empty: 'No selector subscriptions yet. They appear as soon as something calls subscribe(selector, listener).',
    }
  },
}
