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
  const middlewares: Array<InspectorEvents['middlewares']['middlewares']> = []
  const persisted: Array<InspectorEvents['persisted']> = []
  transport.on('action', (p) => names.push(p.action.name))
  transport.on('middlewares', (p) => middlewares.push(p.middlewares))
  transport.on('persisted', (p) => persisted.push(p))
  return { names, middlewares, persisted }
}

const command = (transport: Transport, storeId: string, cmd: InspectorEvents['command']['command']) =>
  transport.send('command', { ...envelope(), storeId, command: cmd })

const tick = () => new Promise((r) => setTimeout(r, 0))

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
  })

  it('reports hydration, version and persisted keys', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    create(transport, memoryStorage())
    expect(seen.middlewares.at(-1)?.persist).toEqual({ name: 'counter', version: 2, hydrated: true, keys: ['count'] })
  })

  it('reads, rehydrates and clears storage on command', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const storage = memoryStorage()
    const store = create(transport, storage)
    store.getState().inc()
    command(transport, 'persisted', { type: 'persist:read' })
    await tick()
    expect(seen.persisted.at(-1)).toMatchObject({ stored: { state: { count: 1 }, version: 2 }, current: { count: 1 } })

    storage.setItem('counter', JSON.stringify({ state: { count: 9 }, version: 2 }))
    command(transport, 'persisted', { type: 'persist:rehydrate' })
    await tick()
    expect(store.getState().count).toBe(9)
    expect(seen.names.at(-1)).toBe('persist/rehydrate')

    command(transport, 'persisted', { type: 'persist:clear' })
    await tick()
    expect(storage.items.has('counter')).toBe(false)
    expect(seen.persisted.at(-1)?.stored).toBeNull()
  })

  it('waits for skipHydration stores to rehydrate', async () => {
    const transport = createMemoryTransport()
    const seen = listen(transport)
    const store = create(transport, memoryStorage({ counter: { state: { count: 3 }, version: 2 } }), {
      skipHydration: true,
    })
    expect(seen.middlewares.at(-1)?.persist).toMatchObject({ hydrated: false, skipHydration: true })
    store.getState().inc()
    await store.persist.rehydrate()
    expect(seen.names).toEqual(['inc', 'persist/rehydrate'])
    expect(seen.middlewares.at(-1)?.persist?.hydrated).toBe(true)
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
    expect(seen.middlewares.at(-1)?.persist?.name).toBe('outer')
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
  })

  it('redux: dispatched actions keep their type and payload, and redux is reported', () => {
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
    expect(seen.middlewares.at(-1)).toEqual({ redux: true })
  })

  it('subscribeWithSelector and combine keep names and listener counts', () => {
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
    store.subscribe((s) => s.other, () => {})
    store.getState().inc()
    expect(seen.names).toEqual(['inc'])
    expect(listeners).toEqual([2])
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
    expect(seen.middlewares.at(-1)).toEqual({ devtools: true })
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
    expect(seen.middlewares.at(-1)?.persist).toMatchObject({ name: 'theme', hydrated: true, keys: ['mode'] })
    store.setState({ mode: 'dark' })
    storage.setItem('theme', JSON.stringify({ state: { mode: 'light' }, version: 0 }))
    await store.persist.rehydrate()
    expect(seen.names).toEqual(['setState', 'persist/rehydrate'])
    expect(store.getState().mode).toBe('light')
    stop()
  })
})
