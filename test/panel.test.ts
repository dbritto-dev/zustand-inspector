// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createMemoryTransport, getRecorders, inspector } from '../src'
import { PanelView, zustandInspectorPlugin } from '../src/panel'

type Counter = { count: number; history: Array<number>; inc: () => void }

function counter(transport: ReturnType<typeof createMemoryTransport>, name = 'counter') {
  return createStore<Counter>()(
    inspector(
      (set) => ({
        count: 0,
        history: [],
        inc: () => set((s) => ({ count: s.count + 1, history: [...s.history, s.count] }), false, 'inc'),
      }),
      { name, transport },
    ),
  )
}

afterEach(() => {
  for (const r of getRecorders()) r.dispose({ silent: true })
  document.body.innerHTML = ''
})

const rows = (view: PanelView) =>
  [...view.root.querySelectorAll<HTMLElement>('.zi-row')].map(
    (r) => r.querySelector('.zi-name')!.firstChild!.textContent,
  )

describe('PanelView', () => {
  it('syncs stores that existed before the panel mounted (late mount)', () => {
    const transport = createMemoryTransport()
    const store = counter(transport)
    store.getState().inc()
    store.getState().inc()

    const view = new PanelView(document.body, { transport })
    view.render()
    expect(rows(view)).toEqual(['@@init', 'inc', 'inc'])
    expect(view.root.querySelector('.zi-body')!.textContent).toContain('2')
  })

  it('appends live actions and time travels from the row button', () => {
    const transport = createMemoryTransport()
    const view = new PanelView(document.body, { transport })
    const store = counter(transport)
    store.getState().inc()
    store.getState().inc()
    store.getState().inc()
    view.render()
    expect(rows(view)).toHaveLength(4)

    const second = view.root.querySelectorAll<HTMLElement>('.zi-row')[1]
    second.querySelector<HTMLButtonElement>('.zi-jump')!.click()
    expect(store.getState().count).toBe(1)

    view.render()
    const current = view.root.querySelector('.zi-row.zi-current .zi-name')!.textContent
    expect(current).toBe('inc')
    expect(view.root.querySelectorAll('.zi-row.zi-future')).toHaveLength(2)
    expect(view.root.querySelector('.zi-scrub span')!.textContent).toContain('time travelling')
  })

  it('shows diffs, snapshots of past actions and filters', () => {
    const transport = createMemoryTransport()
    const store = counter(transport)
    store.getState().inc()
    store.getState().inc()
    const view = new PanelView(document.body, { transport })
    view.render()

    // select the first `inc` (a past action) and look at its diff
    view.root.querySelectorAll<HTMLElement>('.zi-row')[1].click()
    view.root.querySelector<HTMLElement>('[data-tab="diff"]')!.click()
    const diffText = view.root.querySelector('.zi-body')!.textContent!
    expect(diffText).toContain('count')
    expect(diffText).toContain('history[0]')

    // state tab requests the snapshot from the page and renders it
    view.root.querySelector<HTMLElement>('[data-tab="state"]')!.click()
    view.render()
    const stateText = view.root.querySelector('.zi-body')!.textContent!
    expect(stateText).not.toContain('Loading')
    expect(stateText).toMatch(/^count1/)

    const filter = view.root.querySelector<HTMLInputElement>('[data-ref="filter"]')!
    filter.value = 'init'
    filter.dispatchEvent(new Event('input'))
    expect(rows(view)).toEqual(['@@init'])
  })

  it('drives pause / reset from the toolbar', () => {
    const transport = createMemoryTransport()
    const store = counter(transport)
    const view = new PanelView(document.body, { transport })
    view.render()

    view.root.querySelector<HTMLButtonElement>('[data-ref="pause"]')!.click()
    store.getState().inc()
    view.render()
    expect(view.root.querySelector('[data-ref="pause"]')!.textContent).toBe('Resume')
    expect(rows(view)).toEqual(['@@init'])

    view.root.querySelector<HTMLButtonElement>('[data-ref="reset"]')!.click()
    expect(store.getState().count).toBe(0)
  })

  it('escapes store content', () => {
    const transport = createMemoryTransport()
    const store = createStore<{ html: string }>()(
      inspector(() => ({ html: '<img src=x onerror=alert(1)>' }), { name: '<b>evil</b>', transport }),
    )
    store.setState({ html: '<script>x</script>' }, false, '<i>act</i>')
    const view = new PanelView(document.body, { transport })
    view.render()
    expect(view.root.querySelector('img, script, b, i')).toBeNull()
  })
})

describe('zustandInspectorPlugin', () => {
  it('renders once per container and only updates the theme on re-render', () => {
    const transport = createMemoryTransport()
    counter(transport)
    const plugin = zustandInspectorPlugin({ transport })
    const el = document.createElement('div')
    document.body.appendChild(el)

    plugin.render(el, { theme: 'dark', devtoolsOpen: true })
    plugin.render(el, { theme: 'light', devtoolsOpen: true })
    expect(el.querySelectorAll('.zi-root')).toHaveLength(1)
    expect(el.querySelector('.zi-root')!.classList.contains('zi-light')).toBe(true)

    plugin.destroy?.('zustand-inspector')
    expect(el.querySelector('.zi-root')).toBeNull()
  })
})
