import { diff } from './diff'
import type { ActionMeta, Change } from './protocol'
import { isTagged } from './serialize'

/**
 * Pure helpers behind the "who changed this?" tools and the cost flags.
 * Paths use the same segments as `diff`: object keys, array/Set indexes and,
 * for Map entries, the key itself (strings as-is, other keys as JSON).
 */

export type Path = ReadonlyArray<string | number>

export function samePath(a: Path | null | undefined, b: Path | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false
  return a.every((segment, i) => String(segment) === String(b[i]))
}

/** `a` is `b` or an ancestor of it. */
export function isPrefix(a: Path, b: Path): boolean {
  return a.length <= b.length && a.every((segment, i) => String(segment) === String(b[i]))
}

/** A change at `changePath` affects `path` when one contains the other. */
export function isRelated(changePath: Path, path: Path): boolean {
  return isPrefix(changePath, path) || isPrefix(path, changePath)
}

export function changesAt(changes: ReadonlyArray<Change> | undefined, path: Path): Array<Change> {
  return (changes ?? []).filter((c) => isRelated(c.path, path))
}

/** Actions in the buffer whose recorded changes touch `path`, oldest first. */
export function actionsTouching(actions: ReadonlyArray<ActionMeta>, path: Path): Array<ActionMeta> {
  return actions.filter((a) => changesAt(a.changes, path).length > 0)
}

/** Whether a path history may be incomplete because some diffs were cut off. */
export function historyMayBeIncomplete(actions: ReadonlyArray<ActionMeta>): boolean {
  return actions.some((a) => a.changesTruncated)
}

/** The last action at or before `uptoId` that changed `path`. */
export function lastChangeOf(
  actions: ReadonlyArray<ActionMeta>,
  path: Path,
  uptoId: number,
): { action: ActionMeta; changes: Array<Change> } | undefined {
  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i]
    if (action.id > uptoId) continue
    const changes = changesAt(action.changes, path)
    if (changes.length > 0) return { action, changes }
  }
  return undefined
}

/** Read a serialized value at `path`, following tagged containers. */
export function valueAt(serialized: unknown, path: Path): { found: boolean; value: unknown } {
  let node: unknown = serialized
  for (const segment of path) {
    const next = child(node, segment)
    if (!next.found) return next
    node = next.value
  }
  return { found: true, value: node }
}

function child(node: unknown, segment: string | number): { found: boolean; value: unknown } {
  const missing = { found: false, value: undefined }
  if (Array.isArray(node)) {
    const i = Number(segment)
    return Number.isInteger(i) && i >= 0 && i < node.length ? { found: true, value: node[i] } : missing
  }
  if (typeof node !== 'object' || node === null) return missing
  if (isTagged(node)) {
    switch (node.$t) {
      case 'object':
      case 'instance':
        return child(node.v, segment)
      case 'Set':
        return child(node.v, segment)
      case 'Map': {
        for (const [k, v] of node.v as Array<[unknown, unknown]>) {
          if (mapKeySegment(k) === String(segment)) return { found: true, value: v }
        }
        return missing
      }
      default:
        return missing
    }
  }
  const record = node as Record<string, unknown>
  const key = String(segment)
  return Object.prototype.hasOwnProperty.call(record, key) ? { found: true, value: record[key] } : missing
}

/** The path segment for a serialized Map key, matching `diff`. */
export function mapKeySegment(key: unknown): string {
  return typeof key === 'string' ? key : JSON.stringify(key)
}

/** Changes between two serialized states (for a range of actions). */
export function rangeDiff(from: unknown, to: unknown, limit = 500) {
  return diff(from, to, limit)
}

export interface Thresholds {
  /** A `set()` longer than this (listeners included) is slow. Default 16 ms, one frame at 60 Hz. */
  slowMs: number
  /** State larger than this many serialized characters is flagged. Default 1,000,000. */
  largeState: number
}

export const DEFAULT_THRESHOLDS: Thresholds = { slowMs: 16, largeState: 1_000_000 }

export type FlagKind = 'slow' | 'noop' | 'sameValue' | 'large'

export interface CostFlag {
  kind: FlagKind
  /** Short label for a tag. */
  label: string
  /** One sentence explaining it. */
  detail: string
}

export function flagsFor(action: ActionMeta, thresholds: Thresholds = DEFAULT_THRESHOLDS): Array<CostFlag> {
  const cost = action.cost
  if (!cost) return []
  const flags: Array<CostFlag> = []
  if (cost.durationMs !== undefined && cost.durationMs >= thresholds.slowMs) {
    flags.push({
      kind: 'slow',
      label: formatMs(cost.durationMs),
      detail: `set() took ${formatMs(cost.durationMs)} including ${cost.listeners ?? 0} listener${cost.listeners === 1 ? '' : 's'}, longer than one frame (${thresholds.slowMs} ms).`,
    })
  }
  if (cost.noop) {
    flags.push({
      kind: 'noop',
      label: 'no-op',
      detail: `No value changed, but the state object did, so ${cost.listeners ?? 'every'} listener${cost.listeners === 1 ? '' : 's'} ran for nothing.`,
    })
  } else if (cost.sameValueKeys && cost.sameValueKeys.length > 0) {
    const keys = cost.sameValueKeys
    flags.push({
      kind: 'sameValue',
      label: 'same value',
      detail: `${list(keys)} got a new reference with an equal value; selectors reading ${keys.length === 1 ? 'it' : 'them'} re-render for nothing.`,
    })
  }
  if (cost.stateSize >= thresholds.largeState) {
    flags.push({
      kind: 'large',
      label: formatSize(cost.stateSize),
      detail: `The state serializes to ${formatSize(cost.stateSize)}; large states slow down every update and the devtools.`,
    })
  }
  return flags
}

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
}

/** Sizes are serialized characters, shown as approximate bytes. */
export function formatSize(chars: number): string {
  if (chars < 1000) return `${chars} B`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)} KB`
  return `${(chars / 1_000_000).toFixed(1)} MB`
}

function list(items: ReadonlyArray<string>): string {
  const quoted = items.map((k) => `"${k}"`)
  if (quoted.length <= 2) return quoted.join(' and ')
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}
