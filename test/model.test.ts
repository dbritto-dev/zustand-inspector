import { afterEach, describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createMemoryTransport, getRecorders, inspector } from '../src'
import { createPanelModel, snapshotKey } from '../src/model'

afterEach(() => {
  for (const r of getRecorders()) r.dispose({ silent: true })
})

function setup() {
  const transport = createMemoryTransport()
  const store = createStore<{ n: number; inc: () => void }>()(
    inspector((set) => ({ n: 0, inc: () => set((s) => ({ n: s.n + 1 }), false, 'inc') }), {
      name: 'counter',
      transport,
    }),
  )
  return { transport, store }
}

describe('createPanelModel', () => {
  it('syncs existing stores on creation and follows live actions', () => {
    const { transport, store } = setup()
    store.getState().inc()
    const model = createPanelModel(transport)
    const state = () => model.store.getState()
    expect(state().order).toEqual(['counter'])
    expect(state().selectedStore).toBe('counter')
    expect(state().stores.counter.actions.map((a) => a.name)).toEqual(['@@init', 'inc'])

    store.getState().inc()
    expect(state().stores.counter.actions.map((a) => a.name)).toEqual(['@@init', 'inc', 'inc'])
    expect(state().stores.counter.state).toMatchObject({ n: 2 })
    model.dispose()
  })

  it('sends commands for the selected store and tracks time travel', () => {
    const { transport, store } = setup()
    store.getState().inc()
    store.getState().inc()
    const model = createPanelModel(transport)
    const firstInc = model.store.getState().stores.counter.actions[1].id

    model.command({ type: 'jump', toId: firstInc })
    expect(store.getState().n).toBe(1)
    expect(model.store.getState().stores.counter.currentId).toBe(firstInc)

    model.command({ type: 'pause' })
    expect(model.store.getState().stores.counter.paused).toBe(true)
    model.dispose()
  })

  it('requests a past snapshot once and stores the reply', () => {
    const { transport, store } = setup()
    store.getState().inc()
    store.getState().inc()
    const model = createPanelModel(transport)
    const init = model.store.getState().stores.counter.actions[0].id
    // The init snapshot is not the current one, so it is fetched from the page.
    expect(model.snapshot('counter', init)).toBeUndefined()
    expect(model.store.getState().snapshots[snapshotKey('counter', init)]).toMatchObject({ n: 0 })
    expect(model.snapshot('counter', init)).toMatchObject({ n: 0 })
    model.dispose()
  })

  it('selecting the live action follows it; reset clears the selection', () => {
    const { transport, store } = setup()
    store.getState().inc()
    const model = createPanelModel(transport)
    const [init, inc] = model.store.getState().stores.counter.actions
    model.selectAction(init.id)
    expect(model.store.getState().selectedAction).toBe(init.id)
    model.selectAction(inc.id)
    expect(model.store.getState().selectedAction).toBeNull()

    model.selectAction(init.id)
    model.command({ type: 'reset' })
    expect(model.store.getState().selectedAction).toBeNull()
    expect(model.store.getState().stores.counter.actions.map((a) => a.name)).toEqual(['@@init'])
    model.dispose()
  })

  it('drops discarded actions when the page reports a branch', () => {
    const { transport, store } = setup()
    store.getState().inc()
    store.getState().inc()
    const model = createPanelModel(transport)
    const [init, first] = model.store.getState().stores.counter.actions
    model.selectAction(model.store.getState().stores.counter.actions[2].id)
    model.command({ type: 'jump', toId: first.id })
    store.getState().inc()
    const data = model.store.getState().stores.counter
    expect(data.actions.map((a) => a.id)).toEqual([init.id, first.id, data.currentId])
    expect(data.actions.at(-1)!.branch).toEqual({ fromId: first.id, count: 1 })
    // The selection pointed at a discarded action, so it falls back to following live.
    expect(model.store.getState().selectedAction).toBeNull()
    model.dispose()
  })

  it('compares a range with shift-click and clears it on branch, reset or store switch', () => {
    const { transport, store } = setup()
    store.getState().inc()
    store.getState().inc()
    const model = createPanelModel(transport)
    const [init, first, second] = model.store.getState().stores.counter.actions
    model.selectAction(first.id)
    model.selectRange(second.id)
    expect(model.store.getState()).toMatchObject({ compareFrom: first.id, selectedAction: second.id, tab: 'diff' })
    model.selectAction(init.id)
    expect(model.store.getState().compareFrom).toBeNull()

    model.selectAction(first.id)
    model.selectRange(second.id)
    model.command({ type: 'jump', toId: init.id })
    store.getState().inc() // branches from #init, discarding the compared actions
    expect(model.store.getState().compareFrom).toBeNull()
    model.dispose()
  })

  it('picks the initial and final states in compare mode', () => {
    const { transport, store } = setup()
    store.getState().inc()
    store.getState().inc()
    const model = createPanelModel(transport)
    const [init, , second] = model.store.getState().stores.counter.actions
    model.startCompare()
    expect(model.store.getState()).toMatchObject({ comparePick: 'from', compareFrom: null })
    model.pickCompare(init.id)
    expect(model.store.getState()).toMatchObject({ comparePick: 'to', compareFrom: init.id })
    model.pickCompare(init.id) // the same action cannot be both ends
    expect(model.store.getState().comparePick).toBe('to')
    model.pickCompare(second.id)
    expect(model.store.getState()).toMatchObject({
      comparePick: null,
      compareFrom: init.id,
      selectedAction: second.id,
      tab: 'diff',
    })
    model.clearCompare()
    expect(model.store.getState()).toMatchObject({ comparePick: null, compareFrom: null })
    model.dispose()
  })

  it('keeps path pins per store', () => {
    const { transport } = setup()
    const model = createPanelModel(transport)
    model.pinPath(['n'])
    expect(model.store.getState()).toMatchObject({ pinnedPath: ['n'], selectedPath: ['n'] })
    model.pinPath(null)
    expect(model.store.getState().pinnedPath).toBeNull()
    model.pinPath(['n'])
    model.selectStore('counter')
    expect(model.store.getState()).toMatchObject({ pinnedPath: null, selectedPath: null, stateSearch: '' })
    model.dispose()
  })

  it('drops a removed store and ignores other sessions', () => {
    const { transport } = setup()
    const model = createPanelModel(transport)
    transport.send('removed', { v: 1, session: 'other-tab', storeId: 'counter' })
    expect(model.store.getState().order).toEqual(['counter'])
    getRecorders()[0].dispose()
    expect(model.store.getState().order).toEqual([])
    expect(model.store.getState().selectedStore).toBeNull()
    model.dispose()
  })
})
