/**
 * Turns arbitrary store state into JSON-safe tagged values, and back.
 *
 * The TanStack bus JSON-stringifies every event (it mirrors them to other tabs),
 * so anything non-JSON must be tagged here. Time travel never relies on this
 * round trip: the recorder keeps the original objects in the page. Reviving is
 * only used for `import`.
 */

export type Path = ReadonlyArray<string | number>

export type RedactOption =
  | boolean
  | RegExp
  | ((key: string, path: Path) => boolean)

export interface SerializeOptions {
  /** Max nesting depth before values are replaced with a `truncated` tag. Default 12. */
  maxDepth?: number
  /** Max items rendered per array / Map / Set. Default 500. */
  maxItems?: number
  /**
   * Redact values whose key matches. `true` (default) uses DEFAULT_REDACT,
   * `false` disables, a RegExp or predicate customises it. Applied in the page,
   * before anything leaves it.
   */
  redact?: RedactOption
}

/** Keys that end in one of these words are redacted by default. */
export const DEFAULT_REDACT =
  /(password|passwd|secret|token|api[-_]?key|authorization|cookie|credentials?|private[-_]?key)$/i

export interface Tagged {
  $t: string
  [key: string]: unknown
}

export function isTagged(value: unknown): value is Tagged {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Tagged).$t === 'string'
  )
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function shouldRedact(redact: RedactOption, key: string, path: Path): boolean {
  if (redact === false) return false
  if (redact === true) return DEFAULT_REDACT.test(key)
  if (redact instanceof RegExp) return redact.test(key)
  return redact(key, path)
}

export function serialize(value: unknown, options: SerializeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 12
  const maxItems = options.maxItems ?? 500
  const redact = options.redact ?? true
  const ancestors = new Map<object, Path>()

  const encode = (input: unknown, path: Array<string | number>, depth: number): unknown => {
    switch (typeof input) {
      case 'string':
      case 'boolean':
        return input
      case 'number':
        return Number.isFinite(input) ? input : { $t: 'number', v: String(input) }
      case 'undefined':
        return { $t: 'undefined' }
      case 'bigint':
        return { $t: 'bigint', v: input.toString() }
      case 'symbol':
        return { $t: 'symbol', v: input.description ?? '' }
      case 'function':
        return { $t: 'function', name: input.name || 'anonymous' }
    }
    if (input === null) return null

    const obj = input as object
    const seenAt = ancestors.get(obj)
    if (seenAt) return { $t: 'ref', path: [...seenAt] }
    if (depth >= maxDepth) return { $t: 'truncated' }

    ancestors.set(obj, [...path])
    try {
      if (Array.isArray(obj)) {
        const out = obj
          .slice(0, maxItems)
          .map((item, i) => encode(item, [...path, i], depth + 1))
        if (obj.length > maxItems) out.push({ $t: 'more', count: obj.length - maxItems })
        return out
      }
      if (obj instanceof Date) {
        return { $t: 'Date', v: Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString() }
      }
      if (obj instanceof RegExp) return { $t: 'RegExp', source: obj.source, flags: obj.flags }
      if (obj instanceof Error) return { $t: 'Error', name: obj.name, message: obj.message }
      if (obj instanceof Map) {
        const entries: Array<[unknown, unknown]> = []
        let i = 0
        for (const [k, v] of obj) {
          if (i++ >= maxItems) break
          entries.push([
            encode(k, [...path, `<key ${i}>`], depth + 1),
            encode(v, [...path, i - 1], depth + 1),
          ])
        }
        return { $t: 'Map', size: obj.size, v: entries }
      }
      if (obj instanceof Set) {
        const items: Array<unknown> = []
        let i = 0
        for (const v of obj) {
          if (i >= maxItems) break
          items.push(encode(v, [...path, i], depth + 1))
          i++
        }
        return { $t: 'Set', size: obj.size, v: items }
      }
      if (typeof WeakMap !== 'undefined' && (obj instanceof WeakMap || obj instanceof WeakSet)) {
        return { $t: obj.constructor.name }
      }
      if (typeof Promise !== 'undefined' && obj instanceof Promise) return { $t: 'Promise' }

      const record = obj as Record<string, unknown>
      const body: Record<string, unknown> = {}
      for (const key of Object.keys(record)) {
        const childPath = [...path, key]
        body[key] = shouldRedact(redact, key, childPath)
          ? { $t: 'redacted' }
          : encode(record[key], childPath, depth + 1)
      }
      if (!isPlainObject(obj)) {
        return { $t: 'instance', name: obj.constructor?.name ?? 'Object', v: body }
      }
      // A plain object that happens to own a `$t` key must not be mistaken for a tag.
      return '$t' in body ? { $t: 'object', v: body } : body
    } finally {
      ancestors.delete(obj)
    }
  }

  return encode(value, [], 0)
}

/** Marker for values that cannot be rebuilt (functions, redacted, truncated…). */
export const UNREVIVABLE: unique symbol = Symbol('zustand-inspector/unrevivable')

export function revive(value: unknown): unknown {
  if (Array.isArray(value)) {
    const out: Array<unknown> = []
    for (const item of value) {
      if (isTagged(item) && item.$t === 'more') continue
      const revived = revive(item)
      out.push(revived === UNREVIVABLE ? undefined : revived)
    }
    return out
  }
  if (typeof value !== 'object' || value === null) return value
  if (!isTagged(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const revived = revive(v)
      if (revived !== UNREVIVABLE) out[k] = revived
    }
    return out
  }
  switch (value.$t) {
    case 'undefined':
      return undefined
    case 'number':
      return Number(value.v)
    case 'bigint':
      return BigInt(value.v as string)
    case 'Date':
      return new Date(value.v as string)
    case 'RegExp':
      return new RegExp(value.source as string, value.flags as string)
    case 'Map':
      return new Map(
        (value.v as Array<[unknown, unknown]>).map(([k, v]) => [revive(k), revive(v)]),
      )
    case 'Set':
      return new Set((value.v as Array<unknown>).map(revive))
    case 'object':
    case 'instance':
      // Class instances come back as plain objects: prototypes cannot cross the wire.
      return revive(value.v)
    default:
      // function, redacted, truncated, ref, symbol, Error, Promise, more…
      return UNREVIVABLE
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && isPlainObject(value)
}

/**
 * Rebuild `encoded` on top of `current`: anything that cannot be revived
 * (actions, redacted secrets, truncated branches) keeps its current value.
 * This is what makes importing an exported session safe for Zustand stores,
 * whose actions live inside the state.
 */
export function reviveInto<T>(current: T, encoded: unknown): T {
  const revived = revive(encoded)
  if (revived === UNREVIVABLE) return current
  return mergeKeepingUnrevivable(current, encoded) as T
}

function mergeKeepingUnrevivable(current: unknown, encoded: unknown): unknown {
  if (isTagged(encoded) && (encoded.$t === 'object' || encoded.$t === 'instance')) {
    return mergeKeepingUnrevivable(current, encoded.v)
  }
  if (!isPlainRecord(encoded) || isTagged(encoded) || !isPlainRecord(current)) {
    const revived = revive(encoded)
    return revived === UNREVIVABLE ? current : revived
  }
  const out: Record<string, unknown> = { ...current }
  for (const [key, value] of Object.entries(encoded)) {
    out[key] = mergeKeepingUnrevivable(current[key], value)
  }
  return out
}
