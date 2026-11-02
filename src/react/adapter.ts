import { createReactPlugin, type DevtoolsPanelProps } from '@tanstack/devtools-utils/react'
import { createElement, Fragment, useEffect, useRef, type JSX } from 'react'
import { createZustandInspectorDevtoolsCore, type ZustandInspectorDevtoolsInit } from '../devtools/core'
import { PLUGIN_ID } from '../protocol'

/** Props of `ZustandInspectorDevtoolsPanel`: the host's props, all optional, plus the panel's options. */
export interface ZustandInspectorDevtoolsReactInit extends Partial<DevtoolsPanelProps>, ZustandInspectorDevtoolsInit {}

type PanelComponent = (props?: ZustandInspectorDevtoolsReactInit) => JSX.Element

const Core = createZustandInspectorDevtoolsCore()

/**
 * Mounts the core in a div, like `createReactPanel` from
 * `@tanstack/devtools-utils/react`, which this follows. That helper misses
 * prop changes under React 19's StrictMode: StrictMode detaches the ref
 * before the simulated unmount, so its cleanup skips the reset and every
 * later run returns early, and the panel never sees a theme change. Here
 * every prop change unmounts and mounts again; the core keeps the panel (and
 * its selection) when a mount follows an unmount straight away.
 */
function Panel(props: DevtoolsPanelProps & ZustandInspectorDevtoolsInit) {
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef(props)
  latest.current = props
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const core = new Core()
    core.mount(el, latest.current)
    return () => core.unmount()
  }, [props.theme, props.devtoolsOpen])
  return createElement('div', { ref, style: { height: '100%' } })
}

function NoOpPanel(_props: DevtoolsPanelProps & ZustandInspectorDevtoolsInit) {
  return createElement(Fragment)
}

function resolvePanelProps(props: ZustandInspectorDevtoolsReactInit | undefined) {
  return { ...props, theme: props?.theme ?? 'dark', devtoolsOpen: props?.devtoolsOpen ?? false } as DevtoolsPanelProps
}

/** The inspector as a React component, for a custom plugin entry or your own layout. */
export const ZustandInspectorDevtoolsPanelLive: PanelComponent = (props) =>
  createElement(Panel, resolvePanelProps(props))
export const ZustandInspectorDevtoolsPanelNoOp: PanelComponent = (props) =>
  createElement(NoOpPanel, resolvePanelProps(props))

const plugins = createReactPlugin({
  name: 'Zustand',
  id: PLUGIN_ID,
  Component: ZustandInspectorDevtoolsPanelLive,
})

type PluginFactory = (typeof plugins)[0]

/**
 * The inspector as a plugin for `@tanstack/react-devtools`:
 *
 * ```tsx
 * import { TanStackDevtools } from '@tanstack/react-devtools'
 * import { zustandInspectorDevtoolsPlugin } from 'zustand-inspector/react'
 *
 * <TanStackDevtools plugins={[zustandInspectorDevtoolsPlugin()]} />
 * ```
 */
export const zustandInspectorDevtoolsPluginLive: PluginFactory = plugins[0]
export const zustandInspectorDevtoolsNoOpPlugin: PluginFactory = plugins[1]
