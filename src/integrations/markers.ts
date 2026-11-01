import type { InspectorIntegration } from './types'

/** Redux DevTools' `devtools` middleware on the same store. Nothing to show, only a marker. */
export const devtoolsIntegration: InspectorIntegration<true> = {
  id: 'devtools',
  label: 'devtools',
  description: "Redux DevTools' devtools middleware records this store as well.",
  detect: (api) => (api as unknown as { devtools?: unknown }).devtools !== undefined || undefined,
}

/**
 * `immer`: set() accepts draft updaters. Detected from the source of the
 * wrapped setState, so it is found in dev builds only. Nothing to show, only a marker.
 */
export const immerIntegration: InspectorIntegration<true> = {
  id: 'immer',
  label: 'immer',
  description: 'The immer middleware: set() takes draft updaters, and state is produced immutably.',
  detect(api) {
    try {
      return /\bproduce\(/.test(Function.prototype.toString.call(api.setState)) || undefined
    } catch {
      return undefined
    }
  },
}
