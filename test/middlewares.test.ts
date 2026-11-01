import { describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { combine, createJSONStorage, devtools, persist, redux, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { createMemoryTransport, inspector, type InspectorEvents, type Transport } from '../src'
import { envelope } from '../src/session'

function memoryStorage(initial?: Record<string, unknown>) {
  const items = new Map<string, string>()
  for (const [k, v] of Object.entries(initial ?? {})) items.set(k, JSON.stringify(v))
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  }
}

function listen(transport: Transport) {
  const names: Array<string> = []
  const vias: Array<string | undefined> = []
  const integrations: Array<InspectorEvents['integrations']['integrations']> = []
  const inspected: Array<InspectorEvents['inspected']> = []
  const results: Array<InspectorEvents['integration-result']> = []
  transport.on('action', (p) => {
    names.push(p.action.name)
    vias.push(p.action.via)
  })
  transport.on('integrations', (p) => integrations.push(p.integrations))
  transport.on('inspected', (p) => inspected.push(p))
  transport.on('integration-result', (p) => results.push(p))
  const latest = (id: string) => integrations.at(-1)?.find((i) => i.id === id)
  const fact = (id: string, label: string) => latest(id)?.facts?.find((f) => f.label === label)?.value
  return { names, vias, integrations, inspected, results, latest, fact }
}

const command = (transport: Transport, storeId: string, cmd: InspectorEvents['command']['command']) =>
  transport.send('command', { ...envelope(), storeId, command: cmd })

const tick = () => new Promise((r) => setTimeout(r, 0))
const run = (transport: Transport, storeId: string, id: string, cmd: string, input?: unknown) =>
  command(transport, storeId, { type: 'integration', id, command: cmd, ...(input !== undefined ? { input } : {}) })
const inspect = (transport: Transport, storeId: string, id: string) =>
  command(transport, storeId, { type: 'integration:inspect', id })

type Counter = { count: number; step: number; inc: () => void }

describe('persist', () => {
  const create = (transport: Transport, storage: ReturnType<typeof memoryStorage>, extra: object = {}) =>
    createStore<Counter>()(
      inspector(
        persist(
          (set) => ({ count: 0, step: 1, inc: () => set((s) => ({ count: s.count + s.step })) }),
          {
            name: 'counter',
            version: 2,
            storage: createJSONStorage(() => storage),
            partialize: (s) => ({ count: s.count }),
            ...extra,
          },
        ),
        { name: 'persisted', transport },
      ),
    )

  it('names actions through persist and labels rehydration', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const storage = memoryStorage({ counter: { state: { count: 5 }, version: 2 } })
    const store = create(transport, storage)
    expect(store.getState().count).toBe(5)
    store.getState().inc()
    await store.persist.rehydrate()
    expect(seen.names).toEqual(['inc', 'persist/rehydrate'])
    expect(seen.vias).toEqual([undefined, 'persist'])
  })

  it('reports hydration, version and persisted keys', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    create(transport, memoryStorage())
    expect(seen.latest('persist')?.status).toEqual({ tone: 'success', text: 'Hydrated' })
    expect(seen.fact('persist', 'Storage key')).toBe('counter')
    expect(seen.fact('persist', 'Version')).toBe(2)
    expect(seen.fact('persist', 'Persisted keys')).toBe('count')
    expect(seen.latest('persist')?.commands?.map((c) => c.id)).toEqual(['clear', 'rehydrate'])
  })

  it('reads, rehydrates and clears storage on command', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const storage = memoryStorage()
    const store = create(transport, storage)
    store.getState().inc()
    inspect(transport, 'persisted', 'persist')
    await tick()
    expect(seen.inspected.at(-1)?.result).toMatchObject({
      title: 'Stored value',
      value: { count: 1 },
      compare: { with: { count: 1 }, label: 'the current state' },
    })

    storage.setItem('counter', JSON.stringify({ state: { count: 9 }, version: 1 }))
    inspect(transport, 'persisted', 'persist')
    await tick()
    expect(seen.inspected.at(-1)?.result?.note).toMatch(/version 1.*version 2/)

    storage.setItem('counter', JSON.stringify({ state: { count: 9 }, version: 2 }))
    run(transport, 'persisted', 'persist', 'rehydrate')
    await tick()
    expect(store.getState().count).toBe(9)
    expect(seen.names.at(-1)).toBe('persist/rehydrate')
    expect(seen.results.at(-1)).toMatchObject({ id: 'persist', command: 'rehydrate' })

    run(transport, 'persisted', 'persist', 'clear')
    await tick()
    expect(storage.items.has('counter')).toBe(false)
    expect(seen.inspected.at(-1)?.result?.value).toBeNull()
  })

  it('waits for skipHydration stores to rehydrate', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const store = create(transport, memoryStorage({ counter: { state: { count: 3 }, version: 2 } }), {
      skipHydration: true,
    })
    expect(seen.latest('persist')?.status?.tone).toBe('warning')
    store.getState().inc()
    await store.persist.rehydrate()
    await tick()
    expect(seen.names).toEqual(['inc', 'persist/rehydrate'])
    expect(seen.latest('persist')?.status?.tone).toBe('success')
  })

  it('still records rehydration when persist wraps the inspector', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const storage = memoryStorage({ outer: { state: { count: 4 }, version: 0 } })
    const store = createStore<Counter>()(
      persist(
        inspector((set) => ({ count: 0, step: 1, inc: () => set((s) => ({ count: s.count + 1 })) }), {
          name: 'outer',
          transport,
        }),
        { name: 'outer', storage: createJSONStorage(() => storage) },
      ),
    )
    store.getState().inc()
    await tick()
    expect(seen.names).toEqual(['persist/rehydrate', 'inc'])
    expect(seen.fact('persist', 'Storage key')).toBe('outer')
  })
})

describe('other built-in middlewares', () => {
  it('immer: names come from the caller or the action', () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const store = createStore<{ count: number; inc: () => void; add: (n: number) => void }>()(
      inspector(
        immer((set) => ({
          count: 0,
          inc: () =>
            set((s) => {
              s.count++
            }),
          add: (n) =>
            set(
              (s) => {
                s.count += n
              },
              false,
              { type: 'add', n },
            ),
        })),
        { name: 'immer', transport },
      ),
    )
    store.getState().inc()
    store.getState().add(2)
    expect(seen.names).toEqual(['inc', 'add'])
    expect(store.getState().count).toBe(3)
    expect(seen.latest('immer')).toMatchObject({ label: 'immer' })
  })

  it('redux: dispatched actions keep their type and payload, and redux is reported', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const payloads: Array<unknown> = []
    transport.on('action', (p) => payloads.push(p.action.payload))
    const store = createStore(
      inspector(
        redux((s: { count: number }, a: { type: 'inc'; by: number }) => (a.type === 'inc' ? { count: s.count + a.by } : s), {
          count: 0,
        }),
        { name: 'redux', transport },
      ),
    )
    store.dispatch({ type: 'inc', by: 2 })
    expect(seen.names).toEqual(['inc'])
    expect(payloads).toEqual([{ by: 2 }])
    await tick()
    expect(seen.fact('redux', 'Dispatched')).toBe(1)
    expect(seen.fact('redux', 'Action types')).toBe('inc')

    run(transport, 'redux', 'redux', 'dispatch', { type: 'inc', by: 3 })
    await tick()
    expect(store.getState().count).toBe(5)
    expect(seen.names.at(-1)).toBe('inc')
    expect(seen.latest('redux')?.commands?.[0]?.input?.placeholder).toBe('{"type":"inc","by":3}')

    run(transport, 'redux', 'redux', 'dispatch', { by: 1 })
    await tick()
    expect(seen.results.at(-1)?.error).toMatch(/string "type"/)
  })

  it('subscribeWithSelector and combine keep names and listener counts', async () => {
    const transport = createMemoryTransport()
    const listeners: Array<number | undefined> = []
    const seen = listen(transport)
    transport.on('action', (p) => listeners.push(p.action.cost?.listeners))
    const store = createStore(
      inspector(
        subscribeWithSelector(
          combine({ count: 0, other: 0 }, (set) => ({ inc: () => set((s) => ({ count: s.count + 1 })) })),
        ),
        { name: 'sws', transport },
      ),
    )
    store.subscribe((s) => s.count, () => {})
    store.subscribe((s) => s.other, () => {}, { fireImmediately: true })
    store.getState().inc()
    expect(seen.names).toEqual(['inc'])
    expect(listeners).toEqual([2])

    await tick()
    expect(seen.fact('subscribeWithSelector', 'Selector subscriptions')).toBe(2)
    inspect(transport, 'sws', 'subscribeWithSelector')
    await tick()
    const rows = seen.inspected.at(-1)?.result?.rows
    expect(rows?.map((r) => [r.title, r.detail, r.meta])).toEqual([
      ['(s) => s.count', 'Object.is', 'fired 1 time, last on #2'],
      ['(s) => s.other', 'Object.is · fireImmediately', 'fired 1 time, on subscribe'],
    ])
  })

  it('devtools: reported when it wraps the inspector', async () => {
    // A stand-in for the Redux DevTools extension, which the middleware needs to switch on.
    const g = globalThis as unknown as { window?: Record<string, unknown> }
    const hadWindow = g.window !== undefined
    g.window ??= {}
    g.window.__REDUX_DEVTOOLS_EXTENSION__ = {
      connect: () => ({ init() {}, send() {}, subscribe: () => () => {} }),
    }
    const transport = createMemoryTransport()
    const seen = listen(transport)
    createStore(devtools(inspector(() => ({ count: 0 }), { name: 'both', transport }), { enabled: true }))
    await tick()
    delete g.window.__REDUX_DEVTOOLS_EXTENSION__
    if (!hadWindow) delete g.window
    expect(seen.integrations.at(-1)?.map((i) => i.id)).toEqual(['devtools'])
  })
})

describe('inspectStore with persist', () => {
  it('connects persist and labels rehydration', async () => {
    const { inspectStore } = await import('../src')
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const storage = memoryStorage({ theme: { state: { mode: 'light' }, version: 0 } })
    const store = createStore<{ mode: string }>()(
      persist(() => ({ mode: 'dark' }), { name: 'theme', storage: createJSONStorage(() => storage) }),
    )
    const stop = inspectStore(store, { name: 'theme-store', transport })
    expect(seen.fact('persist', 'Persisted keys')).toBe('mode')
    store.setState({ mode: 'dark' })
    storage.setItem('theme', JSON.stringify({ state: { mode: 'light' }, version: 0 }))
    await store.persist.rehydrate()
    expect(seen.names).toEqual(['setState', 'persist/rehydrate'])
    expect(store.getState().mode).toBe('light')
    stop()
  })
})

describe('name inference through wrappers', () => {
  it('skips a bundled setState wrapper (immer) to reach the action', async () => {
    const { inferCallerName } = await import('../src')
    const stack = [
      'Error',
      '    at namedSet (http://localhost/assets/index.js:1:100)',
      '    at store.setState (http://localhost/assets/index.js:1:200)',
      '    at Object.increment (http://localhost/assets/index.js:1:300)',
    ].join('\n')
    expect(inferCallerName(stack)).toBe('increment')
  })

  it('skips Vite prebundled middleware frames', async () => {
    const { inferCallerName } = await import('../src')
    const stack = [
      'Error',
      '    at namedSet (http://localhost:5173/src/middleware.ts:10:1)',
      '    at http://localhost:5173/node_modules/.vite/deps/zustand_middleware.js?v=1:300:5',
      '    at Object.addTodo (http://localhost:5173/src/store.ts:12:3)',
    ].join('\n')
    expect(inferCallerName(stack)).toBe('addTodo')
  })
})
