// `zustand-inspector/production`: everything the root exports, always on.
// Records in any build and uses the always-on EventClient from
// `@tanstack/devtools-event-client/production`.
import { markAlwaysOn } from './env'
import { ZustandInspectorProductionEventClient } from './production-client'
import { useEventClient } from './transport'

markAlwaysOn()
useEventClient(ZustandInspectorProductionEventClient)

export * from './shared-exports'
export {
  ZustandInspectorDevtoolsCoreLive as ZustandInspectorDevtoolsCore,
  zustandInspectorDevtoolsPluginLive as zustandInspectorDevtoolsPlugin,
} from './devtools/core'
export { ZustandInspectorProductionEventClient } from './production-client'
