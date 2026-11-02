// Type check only (tsc -p . includes test/): the framework-agnostic plugin, as
// TanStack's marketplace adds it, must type-check in @tanstack/react-devtools.
import { TanStackDevtools } from '@tanstack/react-devtools'
import { zustandInspectorDevtoolsPlugin } from '../../src'
import { zustandInspectorDevtoolsPlugin as reactPlugin } from '../../src/react'

export const RootPluginInReact = () => <TanStackDevtools plugins={[zustandInspectorDevtoolsPlugin()]} />
export const ReactPluginInReact = () => <TanStackDevtools plugins={[reactPlugin()]} />
