// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handles: Array<{ mode: string; unmounted: boolean; setMode: (m: string) => void; unmount: () => void }> = []
vi.mock('../src/astryx/mount', () => ({
  mountAstryxInspector: vi.fn((_el: HTMLElement, options: { mode: string }) => {
    const handle = {
      mode: options.mode,
      unmounted: false,
      setMode(mode: string) {
        handle.mode = mode
      },
      unmount() {
        handle.unmounted = true
      },
    }
    handles.push(handle)
    return handle
  }),
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('devtools plugin and core', () => {
  beforeEach(() => {
    handles.length = 0
  })

  it('the root import gives the live plugin in development', async () => {
    const root = await import('../src')
    const core = await import('../src/devtools/core')
    expect(root.zustandInspectorDevtoolsPlugin).toBe(core.zustandInspectorDevtoolsPluginLive)
    expect(root.ZustandInspectorDevtoolsCore).toBe(core.ZustandInspectorDevtoolsCoreLive)
  })

  it('renders one panel per container and follows the theme', async () => {
    const { zustandInspectorDevtoolsPluginLive } = await import('../src/devtools/core')
    const plugin = zustandInspectorDevtoolsPluginLive({ defaultOpen: true })
    expect(plugin).toMatchObject({ id: 'zustand-inspector', name: 'Zustand', defaultOpen: true })
    const el = document.createElement('div')
    plugin.render(el, { theme: 'dark', devtoolsOpen: true })
    await flush()
    plugin.render(el, { theme: 'light', devtoolsOpen: true })
    await flush()
    expect(handles).toHaveLength(1)
    expect(handles[0]!.mode).toBe('light')
    plugin.destroy()
    await flush()
    expect(handles[0]!.unmounted).toBe(true)
  })

  it('keeps the panel when an adapter unmounts and mounts again right away', async () => {
    const { createZustandInspectorDevtoolsCore } = await import('../src/devtools/core')
    const Core = createZustandInspectorDevtoolsCore()
    const el = document.createElement('div')
    const first = new Core()
    first.mount(el, { theme: 'dark' })
    await flush()
    first.unmount()
    const second = new Core()
    second.mount(el, { theme: 'light' })
    await flush()
    expect(handles).toHaveLength(1)
    expect(handles[0]).toMatchObject({ mode: 'light', unmounted: false })
    second.unmount()
    await flush()
    expect(handles[0]!.unmounted).toBe(true)
  })

  it('no-op variants mount nothing', async () => {
    const { ZustandInspectorDevtoolsCoreNoOp, zustandInspectorDevtoolsNoOpPlugin } = await import('../src/devtools/core')
    const el = document.createElement('div')
    new ZustandInspectorDevtoolsCoreNoOp().mount()
    const plugin = zustandInspectorDevtoolsNoOpPlugin()
    plugin.render(el, { theme: 'dark' })
    await flush()
    expect(handles).toHaveLength(0)
    expect(plugin.name).toBe('Zustand')
  })
})
