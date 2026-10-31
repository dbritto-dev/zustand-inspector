import type { Change } from './protocol'
import { isTagged } from './serialize'

/** Structural diff between two serialized (JSON-safe, tagged) values. */
export function diff(
  before: unknown,
  after: unknown,
  limit = 200,
): { changes: Array<Change>; truncated: boolean } {
  const changes: Array<Change> = []
  let truncated = false

  const push = (change: Change) => {
    if (changes.length >= limit) {
      truncated = true
      return
    }
    changes.push(change)
  }

  const walk = (a: unknown, b: unknown, path: Array<string | number>) => {
    if (truncated) return
    if (a === b) return

    const aContainer = containerOf(a)
    const bContainer = containerOf(b)

    if (aContainer && bContainer && aContainer.kind === bContainer.kind) {
      if (aContainer.kind === 'array') {
        const aa = aContainer.value as Array<unknown>
        const bb = bContainer.value as Array<unknown>
        const len = Math.max(aa.length, bb.length)
        for (let i = 0; i < len; i++) {
          if (i >= aa.length) push({ path: [...path, i], kind: 'added', to: bb[i] })
          else if (i >= bb.length) push({ path: [...path, i], kind: 'removed', from: aa[i] })
          else walk(aa[i], bb[i], [...path, i])
        }
        return
      }
      const ao = aContainer.value as Record<string, unknown>
      const bo = bContainer.value as Record<string, unknown>
      for (const key of Object.keys(ao)) {
        if (!(key in bo)) push({ path: [...path, key], kind: 'removed', from: ao[key] })
        else walk(ao[key], bo[key], [...path, key])
      }
      for (const key of Object.keys(bo)) {
        if (!(key in ao)) push({ path: [...path, key], kind: 'added', to: bo[key] })
      }
      return
    }

    if (!sameLeaf(a, b)) push({ path, kind: 'changed', from: a, to: b })
  }

  walk(before, after, [])
  return { changes, truncated }
}

type Container = { kind: 'array' | 'object'; value: unknown }

function containerOf(value: unknown): Container | null {
  if (Array.isArray(value)) return { kind: 'array', value }
  if (typeof value !== 'object' || value === null) return null
  if (!isTagged(value)) return { kind: 'object', value }
  // Tagged containers are diffed through their body so a single Map entry or
  // instance field change does not show up as "the whole thing changed".
  if (value.$t === 'object') return { kind: 'object', value: value.v }
  if (value.$t === 'instance') return { kind: 'object', value: value.v }
  if (value.$t === 'Set') return { kind: 'array', value: value.v }
  if (value.$t === 'Map') {
    const body: Record<string, unknown> = {}
    for (const [k, v] of value.v as Array<[unknown, unknown]>) {
      body[typeof k === 'string' ? k : JSON.stringify(k)] = v
    }
    return { kind: 'object', value: body }
  }
  return null
}

function sameLeaf(a: unknown, b: unknown): boolean {
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return Object.is(a, b)
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

export function formatPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) return '(root)'
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else if (/^[A-Za-z_$][\w$]*$/.test(segment)) out += out ? `.${segment}` : segment
    else out += `[${JSON.stringify(segment)}]`
  }
  return out
}
