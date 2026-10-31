import type { TanStackDevtoolsPlugin } from '@tanstack/devtools'
import { PLUGIN_ID } from '../protocol'
import type { Transport } from '../transport'
import { PanelView } from './view'

export interface ZustandInspectorPluginOptions {
  /** Tab label. Default "Zustand". */
  name?: string
  /** Plugin id. Default "zustand-inspector". */
  id?: string
  defaultOpen?: boolean
  transport?: Transport
}

/**
 * TanStack Devtools plugin (vanilla core contract: `render(el, props)` / `destroy`).
 *
 * ```ts
 * import { TanStackDevtoolsCore } from '@tanstack/devtools'
 * new TanStackDevtoolsCore({ plugins: [zustandInspectorPlugin()] }).mount(el)
 * ```
 */
export function zustandInspectorPlugin(
  options: ZustandInspectorPluginOptions = {},
): TanStackDevtoolsPlugin {
  // `render` runs again on every theme/open change, so keep one view per container.
  const views = new Map<HTMLElement, PanelView>()
  return {
    id: options.id ?? PLUGIN_ID,
    name: options.name ?? 'Zustand',
    defaultOpen: options.defaultOpen,
    render(el, props) {
      let view = views.get(el)
      if (!view) {
        el.style.height = '100%'
        view = new PanelView(el, { transport: options.transport, theme: props.theme })
        views.set(el, view)
      }
      view.setTheme(props.theme)
    },
    destroy() {
      for (const view of views.values()) view.dispose()
      views.clear()
    },
  }
}

/** Same shape, renders nothing. Use it in production builds if you keep the plugin import static. */
export function zustandInspectorPluginNoop(
  options: Pick<ZustandInspectorPluginOptions, 'name' | 'id'> = {},
): TanStackDevtoolsPlugin {
  return { id: options.id ?? PLUGIN_ID, name: options.name ?? 'Zustand', render: () => {} }
}
