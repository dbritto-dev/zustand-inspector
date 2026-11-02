'use client'

// `zustand-inspector/react`. Outside development these are no-ops, as
// TanStack's own plugins are; use `zustand-inspector/react/production` to keep them.
import {
  ZustandInspectorDevtoolsPanelLive,
  ZustandInspectorDevtoolsPanelNoOp,
  zustandInspectorDevtoolsNoOpPlugin,
  zustandInspectorDevtoolsPluginLive,
} from './adapter'

// Inline (not a function call) so the consumer's bundler folds it and drops the
// live plugin, with its lazily loaded panel, from production builds.
const DEVELOPMENT = typeof process !== 'undefined' && process.env.NODE_ENV === 'development'

export const ZustandInspectorDevtoolsPanel = DEVELOPMENT
  ? ZustandInspectorDevtoolsPanelLive
  : ZustandInspectorDevtoolsPanelNoOp
export const zustandInspectorDevtoolsPlugin = DEVELOPMENT
  ? zustandInspectorDevtoolsPluginLive
  : zustandInspectorDevtoolsNoOpPlugin
export type { ZustandInspectorDevtoolsReactInit } from './adapter'
