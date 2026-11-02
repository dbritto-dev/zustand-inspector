import type { AstryxInspectorHandle, AstryxInspectorOptions } from '../astryx/mount'
import { PLUGIN_ID } from '../protocol'

/**
 * The framework-agnostic devtools: a core class (`mount` / `unmount`) that the
 * `@tanstack/devtools-utils` adapters wrap, and a plugin for
 * `TanStackDevtoolsCore`. The panel itself (React and Astryx, in a shadow root)
 * is loaded with a dynamic import when it first mounts, so code that only
 * imports the middleware never pulls it in.
 */

/** What the devtools host passes to a plugin. */
export interface ZustandInspectorDevtoolsProps {
  theme: 'light' | 'dark'
  devtoolsOpen?: boolean
}

/** Options for the panel. */
export type ZustandInspectorDevtoolsInit = Omit<AstryxInspectorOptions, 'mode'>

export interface ZustandInspectorDevtoolsCoreInstance {
  mount(el: HTMLElement, props: ZustandInspectorDevtoolsProps & ZustandInspectorDevtoolsInit): void
  unmount(): void
}

export type ZustandInspectorDevtoolsCoreClass = new () => ZustandInspectorDevtoolsCoreInstance

let panelModule: Promise<typeof import('../astryx/mount')> | undefined
const loadPanel = () => (panelModule ??= import('../astryx/mount'))

interface Mounted {
  handle?: AstryxInspectorHandle
  mode: 'light' | 'dark'
  /** An unmount is waiting to see whether a mount follows right away. */
  leaving: boolean
  closed: boolean
}

/** One panel per element, shared by every core instance mounted on it. */
const mounted = new WeakMap<HTMLElement, Mounted>()

const INIT_KEYS = ['transport', 'astryxTheme', 'loadFonts', 'asyncConvention'] as const

/**
 * A core class with options baked in (`createReactPanel` constructs it with no
 * arguments). Options can also arrive with the props, as adapters pass them.
 */
export function createZustandInspectorDevtoolsCore(
  init: ZustandInspectorDevtoolsInit = {},
): ZustandInspectorDevtoolsCoreClass {
  return class ZustandInspectorDevtoolsCore implements ZustandInspectorDevtoolsCoreInstance {
    #el: HTMLElement | undefined

    mount(el: HTMLElement, props: ZustandInspectorDevtoolsProps & ZustandInspectorDevtoolsInit): void {
      this.#el = el
      const mode = props.theme === 'light' ? 'light' : 'dark'
      const existing = mounted.get(el)
      if (existing && !existing.closed) {
        // Adapters unmount and mount again whenever their props change (the
        // theme, say). Keep the panel and its selection; only switch the theme.
        existing.leaving = false
        existing.mode = mode
        existing.handle?.setMode(mode)
        return
      }
      const entry: Mounted = { mode, leaving: false, closed: false }
      mounted.set(el, entry)
      const options: ZustandInspectorDevtoolsInit = { ...init }
      for (const key of INIT_KEYS) if (props[key] !== undefined) (options as Record<string, unknown>)[key] = props[key]
      loadPanel()
        .then(({ mountAstryxInspector }) => {
          if (entry.closed) return
          if (!el.style.height) el.style.height = '100%'
          entry.handle = mountAstryxInspector(el, { ...options, mode: entry.mode })
        })
        .catch((error: unknown) => {
          // Devtools must never break the app; say why the panel is missing.
          if (typeof console !== 'undefined') console.error('[zustand-inspector] the panel failed to load', error)
        })
    }

    unmount(): void {
      const el = this.#el
      const entry = el && mounted.get(el)
      if (!el || !entry || entry.closed) return
      entry.leaving = true
      queueMicrotask(() => {
        if (!entry.leaving) return
        entry.closed = true
        entry.handle?.unmount()
        if (mounted.get(el) === entry) mounted.delete(el)
      })
    }
  }
}

/** Mounts nothing: what the root import gives outside development. */
export class ZustandInspectorDevtoolsCoreNoOp implements ZustandInspectorDevtoolsCoreInstance {
  mount(): void {}
  unmount(): void {}
}

export const ZustandInspectorDevtoolsCoreLive = createZustandInspectorDevtoolsCore()

export interface ZustandInspectorDevtoolsPluginOptions extends ZustandInspectorDevtoolsInit {
  /** Tab title. Default "Zustand". */
  name?: string
  /** Default "zustand-inspector". */
  id?: string
  defaultOpen?: boolean
}

/** The plugin contract of `TanStackDevtoolsCore` (and of every adapter, which wraps it). */
export interface ZustandInspectorDevtoolsPlugin {
  id: string
  name: string
  defaultOpen?: boolean
  /**
   * Mounts the panel into `el` and returns nothing. The return type is `any` so
   * the same plugin also fits the React, Preact and Solid adapters, whose
   * `render` is typed to return their own element: they render what this
   * returns (nothing), and the panel is already in `el`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(el: HTMLElement, props: ZustandInspectorDevtoolsProps): any
  destroy(): void
}

/**
 * The inspector as a plugin for the framework-independent host:
 *
 * ```ts
 * import { TanStackDevtoolsCore } from '@tanstack/devtools'
 * import { zustandInspectorDevtoolsPlugin } from 'zustand-inspector'
 *
 * new TanStackDevtoolsCore({ plugins: [zustandInspectorDevtoolsPlugin()] }).mount(el)
 * ```
 */
export function zustandInspectorDevtoolsPluginLive(
  options: ZustandInspectorDevtoolsPluginOptions = {},
): ZustandInspectorDevtoolsPlugin {
  const { name, id, defaultOpen, ...init } = options
  const Core = createZustandInspectorDevtoolsCore(init)
  // `render` runs again on every theme or open change: one core per container.
  const cores = new Map<HTMLElement, ZustandInspectorDevtoolsCoreInstance>()
  return {
    id: id ?? PLUGIN_ID,
    name: name ?? 'Zustand',
    ...(defaultOpen !== undefined ? { defaultOpen } : {}),
    render(el, props) {
      let core = cores.get(el)
      if (!core) {
        core = new Core()
        cores.set(el, core)
      }
      core.mount(el, props)
    },
    destroy() {
      for (const core of cores.values()) core.unmount()
      cores.clear()
    },
  }
}

/** Same shape, renders nothing. */
export function zustandInspectorDevtoolsNoOpPlugin(
  options: Pick<ZustandInspectorDevtoolsPluginOptions, 'name' | 'id' | 'defaultOpen'> = {},
): ZustandInspectorDevtoolsPlugin {
  return {
    id: options.id ?? PLUGIN_ID,
    name: options.name ?? 'Zustand',
    ...(options.defaultOpen !== undefined ? { defaultOpen: options.defaultOpen } : {}),
    render() {},
    destroy() {},
  }
}
