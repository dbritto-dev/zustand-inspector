export * from './shared-exports'

// Devtools side: the framework-agnostic plugin. Outside development (see
// `isDevelopment`) these are no-ops, as TanStack's own plugins are; import
// from `zustand-inspector/production` to keep them.
import {
  ZustandInspectorDevtoolsCoreLive,
  ZustandInspectorDevtoolsCoreNoOp,
  zustandInspectorDevtoolsNoOpPlugin,
  zustandInspectorDevtoolsPluginLive,
} from './devtools/core'

// Inline (not a function call) so the consumer's bundler folds it and drops the
// live plugin, with its lazily loaded panel, from production builds.
const DEVELOPMENT = typeof process !== 'undefined' && process.env.NODE_ENV === 'development'

export const ZustandInspectorDevtoolsCore = DEVELOPMENT
  ? ZustandInspectorDevtoolsCoreLive
  : ZustandInspectorDevtoolsCoreNoOp
export const zustandInspectorDevtoolsPlugin = DEVELOPMENT
  ? zustandInspectorDevtoolsPluginLive
  : zustandInspectorDevtoolsNoOpPlugin
