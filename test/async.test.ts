import { describe, expect, it } from 'vitest'
import { asyncError, defaultAsyncConvention, groupAsyncActions, type ActionMeta } from '../src'

let nextId = 1
const act = (name: string, ts: number, payload?: unknown, source: ActionMeta['source'] = 'app'): ActionMeta => ({
  id: nextId++,
  name,
  ts,
  source,
  ...(payload !== undefined ? { payload } : {}),
})

describe('async convention', () => {
  it('reads RTK-style phases with : or /, and request ids', () => {
    expect(defaultAsyncConvention('todos/load:pending', undefined)).toEqual({ key: 'todos/load', phase: 'pending' })
    expect(defaultAsyncConvention('todos/load/fulfilled', { requestId: 7 })).toEqual({
      key: 'todos/load',
      phase: 'fulfilled',
      requestId: '7',
    })
    expect(defaultAsyncConvention('save:rejected', { meta: { requestId: 'a' } })?.requestId).toBe('a')
    expect(defaultAsyncConvention('increment', undefined)).toBeNull()
    expect(defaultAsyncConvention(':pending', undefined)).toBeNull()
  })
})

describe('groupAsyncActions', () => {
  it('pairs pending with the action that settles it, around other actions', () => {
    const actions = [
      act('@@init', 0, undefined, 'init'),
      act('todos/load:pending', 10),
      act('tags/add', 20),
      act('todos/load:fulfilled', 410),
    ]
    const { groups, groupOf } = groupAsyncActions(actions)
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(g).toMatchObject({ key: 'todos/load', status: 'fulfilled', durationMs: 400, ambiguous: false })
    expect(groupOf.get(actions[1]!.id)).toBe(g)
    expect(groupOf.get(actions[3]!.id)).toBe(g)
    expect(groupOf.has(actions[2]!.id)).toBe(false)
  })

  it('keeps calls running, records errors, and leaves orphans alone', () => {
    const actions = [
      act('save:pending', 0),
      act('save:rejected', 5, { error: { $t: 'Error', name: 'Error', message: 'offline' } }),
      act('load:pending', 6),
      act('sync:fulfilled', 7),
    ]
    const { groups, groupOf } = groupAsyncActions(actions)
    expect(groups.map((g) => g.status)).toEqual(['rejected', 'running'])
    expect(asyncError(groups[0]!)).toEqual({ $t: 'Error', name: 'Error', message: 'offline' })
    expect(groupOf.has(actions[3]!.id)).toBe(false)
  })

  it('pairs overlapping calls by request id, or marks them ambiguous', () => {
    const withIds = [
      act('load:pending', 0, { requestId: 'a' }),
      act('load:pending', 1, { requestId: 'b' }),
      act('load:fulfilled', 5, { requestId: 'b' }),
      act('load:fulfilled', 9, { requestId: 'a' }),
    ]
    const byId = groupAsyncActions(withIds).groups
    expect(byId.map((g) => [g.requestId, g.durationMs, g.ambiguous])).toEqual([
      ['a', 9, false],
      ['b', 4, false],
    ])

    const without = [act('load:pending', 0), act('load:pending', 1), act('load:fulfilled', 5), act('load:fulfilled', 9)]
    const guessed = groupAsyncActions(without).groups
    expect(guessed.map((g) => [g.durationMs, g.ambiguous])).toEqual([
      [5, true],
      [8, false],
    ])
  })

  it('takes a custom convention', () => {
    const actions = [act('loadStart', 0), act('loadDone', 3)]
    const { groups } = groupAsyncActions(actions, (name) => {
      const m = /^(\w+?)(Start|Done|Failed)$/.exec(name)
      if (!m) return null
      return { key: m[1]!, phase: m[2] === 'Start' ? 'pending' : m[2] === 'Done' ? 'fulfilled' : 'rejected' }
    })
    expect(groups).toMatchObject([{ key: 'load', status: 'fulfilled', durationMs: 3 }])
  })
})
