import type { TanStackDevtoolsPlugin } from '@tanstack/devtools'
import { PLUGIN_ID } from '../protocol'
import { mountAstryxInspector, type AstryxInspectorHandle, type AstryxInspectorOptions } from './mount'

export interface ZustandInspectorAstryxPluginOptions extends Omit<AstryxInspectorOptions, 'mode'> {
  /** Tab label. Default "Zustand". */
  name?: string
  /** Plugin id. Default "zustand-inspector". */
  id?: string
  defaultOpen?: boolean
}

/**
 * TanStack Devtools plugin with the Astryx UI. The app's stores stay plain
 * Zustand; React and Astryx only run inside the devtools pane.
 */
export function zustandInspectorAstryxPlugin(
  options: ZustandInspectorAstryxPluginOptions = {},
): TanStackDevtoolsPlugin {
  const { name, id, defaultOpen, ...mountOptions } = options
  // `render` runs again on every theme or open change: one mount per container.
  const mounts = new Map<HTMLElement, AstryxInspectorHandle>()
  return {
    id: id ?? PLUGIN_ID,
    name: name ?? 'Zustand',
    defaultOpen,
    render(el, props) {
      const existing = mounts.get(el)
      if (existing) {
        existing.setMode(props.theme)
        return
      }
      el.style.height = '100%'
      mounts.set(el, mountAstryxInspector(el, { ...mountOptions, mode: props.theme }))
    },
    destroy() {
      for (const handle of mounts.values()) handle.unmount()
      mounts.clear()
    },
  }
}
