'use client'

// `zustand-inspector/react`. Outside development these are no-ops, as
// TanStack's own plugins are; use `zustand-inspector/react/production` to keep them.
import {
  ZustandInspectorDevtoolsPanelLive,
  ZustandInspectorDevtoolsPanelNoOp,
  zustandInspectorDevtoolsNoOpPlugin,
  zustandInspectorDevtoolsPluginLive,
} from './adapter'

// Inline and unguarded, as TanStack's own plugins do: the consumer's bundler
// replaces `process.env.NODE_ENV`, folds this, and drops the live plugin (with
// its lazily loaded panel) from production builds. A `typeof process` guard
// would defeat that: bundlers replace the property, not `process` itself.
const DEVELOPMENT = process.env.NODE_ENV === 'development'

export const ZustandInspectorDevtoolsPanel = DEVELOPMENT
  ? ZustandInspectorDevtoolsPanelLive
  : ZustandInspectorDevtoolsPanelNoOp
export const zustandInspectorDevtoolsPlugin = DEVELOPMENT
  ? zustandInspectorDevtoolsPluginLive
  : zustandInspectorDevtoolsNoOpPlugin
export type { ZustandInspectorDevtoolsReactInit } from './adapter'
