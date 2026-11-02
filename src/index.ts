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

// Inline and unguarded, as TanStack's own plugins do: the consumer's bundler
// replaces `process.env.NODE_ENV`, folds this, and drops the live plugin (with
// its lazily loaded panel) from production builds. A `typeof process` guard
// would defeat that: bundlers replace the property, not `process` itself.
const DEVELOPMENT = process.env.NODE_ENV === 'development'

export const ZustandInspectorDevtoolsCore = DEVELOPMENT
  ? ZustandInspectorDevtoolsCoreLive
  : ZustandInspectorDevtoolsCoreNoOp
export const zustandInspectorDevtoolsPlugin = DEVELOPMENT
  ? zustandInspectorDevtoolsPluginLive
  : zustandInspectorDevtoolsNoOpPlugin
