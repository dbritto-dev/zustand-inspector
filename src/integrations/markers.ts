import type { InspectorIntegration } from './types'

/** Redux DevTools' `devtools` middleware on the same store. Nothing to show, only a marker. */
export const devtoolsIntegration: InspectorIntegration<true> = {
  id: 'devtools',
  label: 'devtools',
  icon: 'devtools',
  description: 'Also sends this store to the Redux DevTools browser extension.',
  detect: (api) => (api as unknown as { devtools?: unknown }).devtools !== undefined || undefined,
}

/**
 * `immer`: set() accepts draft updaters. Detected from the source of the
 * wrapped setState, so it is found in dev builds only. Nothing to show, only a marker.
 */
export const immerIntegration: InspectorIntegration<true> = {
  id: 'immer',
  label: 'immer',
  icon: 'draft',
  description: 'Lets actions update state by mutating a draft, which immer turns into a new state.',
  detect(api) {
    try {
      return /\bproduce\(/.test(Function.prototype.toString.call(api.setState)) || undefined
    } catch {
      return undefined
    }
  },
}
