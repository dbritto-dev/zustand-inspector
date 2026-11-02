'use client'

// `zustand-inspector/react/production`: the React adapter, always on.
import { markAlwaysOn } from '../env'
import { ZustandInspectorProductionEventClient } from '../production-client'
import { useEventClient } from '../transport'

markAlwaysOn()
useEventClient(ZustandInspectorProductionEventClient)

export {
  ZustandInspectorDevtoolsPanelLive as ZustandInspectorDevtoolsPanel,
  zustandInspectorDevtoolsPluginLive as zustandInspectorDevtoolsPlugin,
} from './adapter'
export type { ZustandInspectorDevtoolsReactInit } from './adapter'
