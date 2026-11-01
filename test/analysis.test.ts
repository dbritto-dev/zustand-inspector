import { describe, expect, it } from 'vitest'
import {
  actionsTouching,
  flagsFor,
  formatSize,
  isRelated,
  lastChangeOf,
  rangeDiff,
  valueAt,
} from '../src/analysis'
import type { ActionMeta } from '../src/protocol'
import { serialize } from '../src/serialize'

const action = (id: number, paths: Array<Array<string | number>>, extra: Partial<ActionMeta> = {}): ActionMeta => ({
  id,
  name: `a${id}`,
  ts: id,
  source: 'app',
  changes: paths.map((path) => ({ path, kind: 'changed' as const })),
  ...extra,
})

describe('path matching', () => {
  it('relates ancestors and descendants, not siblings', () => {
    expect(isRelated(['todos', '1', 'done'], ['todos'])).toBe(true)
    expect(isRelated(['todos'], ['todos', '1', 'done'])).toBe(true)
    expect(isRelated(['todos', 1], ['todos', '1'])).toBe(true)
    expect(isRelated(['todos', '2'], ['todos', '1'])).toBe(false)
    expect(isRelated(['tags'], ['todos'])).toBe(false)
  })

  it('finds the actions that touched a path and the last one before a point', () => {
    const actions = [action(1, []), action(2, [['count']]), action(3, [['todos', 'a']]), action(4, [['todos', 'b', 'done']])]
    expect(actionsTouching(actions, ['todos']).map((a) => a.id)).toEqual([3, 4])
    expect(actionsTouching(actions, ['todos', 'b']).map((a) => a.id)).toEqual([4])
    expect(lastChangeOf(actions, ['todos'], 3)?.action.id).toBe(3)
    expect(lastChangeOf(actions, ['todos'], 4)?.action.id).toBe(4)
    expect(lastChangeOf(actions, ['count'], 1)).toBeUndefined()
  })
})

describe('valueAt', () => {
  it('follows objects, arrays, Maps, Sets and class instances', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const state = serialize({
      todos: new Map([['a', { title: 'Write', at: new Date(0) }]]),
      tags: new Set(['x', 'y']),
      list: [10, 20],
      origin: new Point(1, 2),
    })
    expect(valueAt(state, ['todos', 'a', 'title'])).toEqual({ found: true, value: 'Write' })
    expect(valueAt(state, ['tags', 1])).toEqual({ found: true, value: 'y' })
    expect(valueAt(state, ['list', '0'])).toEqual({ found: true, value: 10 })
    expect(valueAt(state, ['origin', 'y'])).toEqual({ found: true, value: 2 })
    expect(valueAt(state, ['todos', 'missing']).found).toBe(false)
  })
})

describe('rangeDiff', () => {
  it('diffs two snapshots across several actions', () => {
    const from = serialize({ n: 1, items: [1] })
    const to = serialize({ n: 3, items: [1, 2] })
    expect(rangeDiff(from, to).changes).toEqual([
      { path: ['n'], kind: 'changed', from: 1, to: 3 },
      { path: ['items', 1], kind: 'added', to: 2 },
    ])
  })
})

describe('flagsFor', () => {
  it('flags slow, no-op, same-value and large updates', () => {
    const flags = (cost: ActionMeta['cost']) => flagsFor(action(9, [], { cost })).map((f) => f.kind)
    expect(flags({ stateSize: 10, durationMs: 3 })).toEqual([])
    expect(flags({ stateSize: 10, durationMs: 20, listeners: 4 })).toEqual(['slow'])
    expect(flags({ stateSize: 10, noop: true, sameValueKeys: ['items'] })).toEqual(['noop'])
    expect(flags({ stateSize: 10, sameValueKeys: ['items'] })).toEqual(['sameValue'])
    expect(flags({ stateSize: 2_000_000 })).toEqual(['large'])
    expect(flagsFor(action(9, [], { cost: { stateSize: 1, sameValueKeys: ['a', 'b', 'c'] } }))[0].detail).toContain(
      '"a", "b" and "c"',
    )
  })

  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2300)).toBe('2.3 KB')
    expect(formatSize(1_500_000)).toBe('1.5 MB')
  })
})
