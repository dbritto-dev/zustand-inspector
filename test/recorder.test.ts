import { afterEach, describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import {
  createMemoryTransport,
  getRecorders,
  inferCallerName,
  inspectStore,
  inspector,
  type InspectorEvents,
  type Transport,
} from '../src'
import { envelope } from '../src/session'

function collect(transport: Transport) {
  const events: Array<{ type: keyof InspectorEvents; payload: any }> = []
  const types: Array<keyof InspectorEvents> = [
    'store',
    'action',
    'jumped',
    'status',
    'snapshot',
    'export',
    'removed',
  ]
  for (const type of types) transport.on(type, (payload) => events.push({ type, payload }))
  return events
}

type TodoState = {
  count: number
  tags: Set<string>
  byId: Map<string, { title: string; at: Date }>
  accessToken: string
  inc: () => void
  addTag: (t: string) => void
  addTodo: (id: string, title: string) => void
}

function makeStore(transport: Transport, name = 'todos') {
  return createStore<TodoState>()(
    inspector(
      (set) => ({
        count: 0,
        tags: new Set(),
        byId: new Map(),
        accessToken: 'super-secret',
        inc: () => set((s) => ({ count: s.count + 1 }), false, 'inc'),
        addTag: (t) => set((s) => ({ tags: new Set(s.tags).add(t) }), false, { type: 'addTag', tag: t }),
        addTodo: (id, title) =>
          set((s) => ({ byId: new Map(s.byId).set(id, { title, at: new Date(0) }) })),
      }),
      { name, transport },
    ),
  )
}

afterEach(() => {
  for (const r of getRecorders()) r.dispose({ silent: true })
})

describe('inspector middleware', () => {
  it('records named actions, payloads and inferred caller names', () => {
    const transport = createMemoryTransport()
    const events = collect(transport)
    const store = makeStore(transport)

    store.getState().inc()
    store.getState().addTag('urgent')
    store.getState().addTodo('a', 'Write docs')

    const actions = events.filter((e) => e.type === 'action').map((e) => e.payload.action)
    expect(actions.map((a) => a.name)).toEqual(['inc', 'addTag', 'addTodo'])
    expect(actions[1].payload).toEqual({ tag: 'urgent' })
    expect(actions[0].changes).toEqual([{ path: ['count'], kind: 'changed', from: 0, to: 1 }])
  })

  it('time travels losslessly (Map, Set, Date and actions survive)', () => {
    const transport = createMemoryTransport()
    collect(transport)
    const store = makeStore(transport)
    const recorder = getRecorders()[0]

    store.getState().addTag('urgent')
    store.getState().addTodo('a', 'Write docs')
    const afterTodo = store.getState()
    const todoActionId = recorder.currentId
    store.getState().inc()
    store.getState().inc()
    expect(store.getState().count).toBe(2)

    transport.send('command', { ...envelope(), storeId: 'todos', command: { type: 'jump', toId: todoActionId } })

    const state = store.getState()
    expect(state).toBe(afterTodo) // the exact original object
    expect(state.byId.get('a')?.at).toBeInstanceOf(Date)
    expect(state.tags).toBeInstanceOf(Set)
    expect(typeof state.inc).toBe('function')
    expect(state.count).toBe(0)
    // the jump itself is not recorded as an action
    expect(recorder.actions.at(-1)?.name).toBe('inc')
  })

  it('redacts secret-looking keys before anything leaves the page', () => {
    const transport = createMemoryTransport()
    const events = collect(transport)
    makeStore(transport)
    const store = events.find((e) => e.type === 'store')!.payload
    expect(store.state.accessToken).toEqual({ $t: 'redacted' })
    expect(store.state.inc).toEqual({ $t: 'function', name: 'inc' })
    expect(JSON.stringify(events)).not.toContain('super-secret')
  })

  it('pauses, then records one resume entry if state changed', () => {
    const transport = createMemoryTransport()
    const events = collect(transport)
    const store = makeStore(transport)
    const recorder = getRecorders()[0]

    recorder.handle({ type: 'pause' })
    store.getState().inc()
    store.getState().inc()
    expect(recorder.actions.map((a) => a.name)).toEqual(['@@init'])
    recorder.handle({ type: 'resume' })
    expect(recorder.actions.map((a) => a.name)).toEqual(['@@init', 'devtools/resume'])
    expect(events.filter((e) => e.type === 'status').map((e) => e.payload.paused)).toEqual([true, false])
  })

  it('reset restores the initial state and commit squashes history', () => {
    const transport = createMemoryTransport()
    collect(transport)
    const store = makeStore(transport)
    const recorder = getRecorders()[0]
    store.getState().inc()
    store.getState().inc()

    recorder.handle({ type: 'commit' })
    expect(recorder.actions.map((a) => a.name)).toEqual(['devtools/commit'])
    expect(store.getState().count).toBe(2)

    recorder.handle({ type: 'reset' })
    expect(store.getState().count).toBe(0)
    expect(recorder.actions.map((a) => a.name)).toEqual(['@@init'])
  })

  it('imports an exported session, keeping actions and redacted fields live', () => {
    const transport = createMemoryTransport()
    const events = collect(transport)
    const store = makeStore(transport)
    const recorder = getRecorders()[0]
    store.getState().addTodo('a', 'Write docs')
    store.getState().inc()

    recorder.handle({ type: 'export' })
    const data = events.find((e) => e.type === 'export')!.payload.data
    const exported = JSON.parse(JSON.stringify(data)) // as if it went through a file
    recorder.handle({ type: 'reset' })
    expect(store.getState().count).toBe(0)

    recorder.handle({ type: 'import', state: exported.entries.at(-1).state })
    const state = store.getState()
    expect(state.count).toBe(1)
    expect(state.byId.get('a')?.at).toBeInstanceOf(Date)
    expect(state.accessToken).toBe('super-secret') // redacted in the file, kept live
    expect(typeof state.inc).toBe('function')
    expect(recorder.actions.at(-1)?.name).toBe('devtools/import')
  })

  it('answers a late panel with a full sync and ignores other sessions', () => {
    const transport = createMemoryTransport()
    const events = collect(transport)
    const store = makeStore(transport)
    store.getState().inc()
    events.length = 0

    transport.send('hello', { v: 1, session: 'another-tab' })
    expect(events).toHaveLength(0)
    transport.send('command', { v: 1, session: 'another-tab', storeId: 'todos', command: { type: 'reset' } })
    expect(store.getState().count).toBe(1)

    transport.send('hello', envelope())
    const sync = events.find((e) => e.type === 'store')!.payload
    expect(sync.actions.map((a: any) => a.name)).toEqual(['@@init', 'inc'])
  })

  it('keeps a bounded ring buffer', () => {
    const transport = createMemoryTransport()
    const store = createStore<{ n: number }>()(
      inspector(() => ({ n: 0 }), { name: 'ring', transport, maxHistory: 3 }),
    )
    for (let i = 1; i <= 5; i++) store.setState({ n: i }, false, `set ${i}`)
    const recorder = getRecorders()[0]
    expect(recorder.actions.map((a) => a.name)).toEqual(['set 3', 'set 4', 'set 5'])
    expect(recorder.describe().dropped).toBe(3)
  })

  it('re-registering the same name replaces the old store (HMR)', () => {
    const transport = createMemoryTransport()
    makeStore(transport, 'dup')
    makeStore(transport, 'dup')
    expect(getRecorders().filter((r) => r.name === 'dup')).toHaveLength(1)
  })
})

describe('inspectStore (no middleware)', () => {
  it('records changes and can still time travel', () => {
    const transport = createMemoryTransport()
    collect(transport)
    const store = createStore<{ n: number }>()(() => ({ n: 0 }))
    const stop = inspectStore(store, { name: 'plain', transport })
    store.setState({ n: 1 })
    store.setState({ n: 2 })
    const recorder = getRecorders()[0]
    expect(recorder.actions.map((a) => a.name)).toEqual(['@@init', 'setState', 'setState'])
    recorder.handle({ type: 'jump', toId: recorder.actions[1].id })
    expect(store.getState().n).toBe(1)
    expect(recorder.actions).toHaveLength(3)
    stop()
    expect(getRecorders()).toHaveLength(0)
  })
})

describe('inferCallerName', () => {
  it('reads V8 and Firefox/Safari stacks', () => {
    const v8 = 'Error\n    at namedSet (inspector.js:1:1)\n    at Object.increment (app.js:2:3)\n    at main (app.js:9:9)'
    const ff = 'namedSet@inspector.js:1:1\nincrement@app.js:2:3\nmain@app.js:9:9'
    expect(inferCallerName(v8)).toBe('increment')
    expect(inferCallerName(ff)).toBe('increment')
    expect(inferCallerName('Error\n    at namedSet (x)\n    at http://localhost/app.js:1:1')).toBeUndefined()
    // minified: our frame is renamed, the caller is still the next frame
    const minified = 'Error\n    at o (index.js:1:100)\n    at Object.increment (index.js:1:900)'
    expect(inferCallerName(minified)).toBe('increment')
  })
})
