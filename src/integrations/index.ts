import { devtoolsIntegration, immerIntegration } from './markers'
import { persistIntegration } from './persist'
import { reduxIntegration } from './redux'
import { subscribeWithSelectorIntegration } from './subscribeWithSelector'
import type { InspectorIntegration } from './types'

export * from './types'
export { persistIntegration, reduxIntegration, subscribeWithSelectorIntegration, devtoolsIntegration, immerIntegration }

/** Zustand's own middlewares. `combine` leaves no trace on the store, so there's nothing to detect. */
export const builtInIntegrations: ReadonlyArray<InspectorIntegration> = [
  persistIntegration,
  reduxIntegration,
  subscribeWithSelectorIntegration,
  immerIntegration,
  devtoolsIntegration,
]
