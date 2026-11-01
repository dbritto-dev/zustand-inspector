import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { mapKeySegment } from '../analysis'
import { isTagged } from '../serialize'

/**
 * Renders serialized values (see `serialize`) as Astryx Text. `data-zi-tone`
 * maps each kind to the theme's syntax tokens (rules in css.ts), so values
 * follow the active theme and color mode.
 */

type Tone = 'string' | 'number' | 'constant' | 'function' | 'type' | 'property' | 'muted' | 'warning' | 'error'

export interface Described {
  text: string
  tone: Tone
}

export type ValueKind = 'object' | 'array' | 'map' | 'set' | 'instance' | 'leaf'

export function kindOf(value: unknown): ValueKind {
  if (Array.isArray(value)) return 'array'
  if (typeof value !== 'object' || value === null) return 'leaf'
  if (!isTagged(value)) return 'object'
  switch (value.$t) {
    case 'object':
      return 'object'
    case 'instance':
      return 'instance'
    case 'Map':
      return 'map'
    case 'Set':
      return 'set'
    default:
      return 'leaf'
  }
}

const isFunctionValue = (v: unknown) => isTagged(v) && v.$t === 'function'

export interface ValueChild {
  /** Stable path segment for ids. */
  segment: string
  key: Described
  value: unknown
}

export function childrenOf(value: unknown, showFunctions: boolean): Array<ValueChild> {
  const keep = (v: unknown) => showFunctions || !isFunctionValue(v)
  switch (kindOf(value)) {
    case 'array':
      return (value as Array<unknown>)
        .map((v, i) => ({ segment: String(i), key: { text: String(i), tone: 'muted' as Tone }, value: v }))
        .filter((c) => keep(c.value))
    case 'set':
      return ((value as { v: Array<unknown> }).v ?? []).map((v, i) => ({
        segment: String(i),
        key: { text: String(i), tone: 'muted' as Tone },
        value: v,
      }))
    case 'map':
      return ((value as { v: Array<[unknown, unknown]> }).v ?? [])
        .filter(([, v]) => keep(v))
        .map(([k, v]) => ({ segment: mapKeySegment(k), key: { ...describe(k, 40), text: `${describe(k, 40).text} →` }, value: v }))
    case 'object':
    case 'instance': {
      const body = (isTagged(value) ? value.v : value) as Record<string, unknown>
      return Object.entries(body)
        .filter(([, v]) => keep(v))
        .map(([k, v]) => ({ segment: k, key: { text: k, tone: 'property' as Tone }, value: v }))
    }
    default:
      return []
  }
}

/** Short type-and-size label for an expanded container: `Map(3)`, `{4 keys}`. */
export function summarize(value: unknown, showFunctions: boolean): Described {
  const count = childrenOf(value, showFunctions).length
  switch (kindOf(value)) {
    case 'array':
      return { text: `Array(${(value as Array<unknown>).length})`, tone: 'type' }
    case 'map':
      return { text: `Map(${(value as { size: number }).size})`, tone: 'type' }
    case 'set':
      return { text: `Set(${(value as { size: number }).size})`, tone: 'type' }
    case 'instance':
      return { text: `${(value as { name: string }).name} {${count}}`, tone: 'type' }
    default:
      return { text: `{${count} ${count === 1 ? 'key' : 'keys'}}`, tone: 'muted' }
  }
}

/** One-line description of any serialized value. */
export function describe(value: unknown, max = 120): Described {
  const clip = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)
  if (value === null) return { text: 'null', tone: 'muted' }
  if (typeof value === 'string') return { text: clip(JSON.stringify(value)), tone: 'string' }
  if (typeof value === 'number') return { text: String(value), tone: 'number' }
  if (typeof value === 'boolean') return { text: String(value), tone: 'constant' }
  if (Array.isArray(value)) return { text: clip(preview(value)), tone: 'muted' }
  if (typeof value !== 'object') return { text: String(value), tone: 'muted' }
  if (!isTagged(value)) return { text: clip(preview(value)), tone: 'muted' }
  switch (value.$t) {
    case 'undefined':
      return { text: 'undefined', tone: 'muted' }
    case 'number':
      return { text: String(value.v), tone: 'number' }
    case 'bigint':
      return { text: `${value.v}n`, tone: 'number' }
    case 'Date':
      return { text: `Date(${value.v})`, tone: 'type' }
    case 'function':
      return { text: `ƒ ${value.name}()`, tone: 'function' }
    case 'redacted':
      return { text: '•••• redacted', tone: 'warning' }
    case 'truncated':
      return { text: '… truncated', tone: 'muted' }
    case 'more':
      return { text: `… ${value.count} more`, tone: 'muted' }
    case 'ref':
      return { text: `[Circular ~${(value.path as Array<unknown>).join('.')}]`, tone: 'muted' }
    case 'symbol':
      return { text: `Symbol(${value.v})`, tone: 'function' }
    case 'RegExp':
      return { text: `/${value.source}/${value.flags}`, tone: 'string' }
    case 'Error':
      return { text: `${value.name}: ${value.message}`, tone: 'error' }
    case 'Map':
    case 'Set':
      return { text: `${value.$t}(${value.size})`, tone: 'type' }
    case 'instance':
      return { text: clip(`${value.name} ${preview(value.v)}`), tone: 'type' }
    case 'object':
      return { text: clip(preview(value.v)), tone: 'muted' }
    default:
      return { text: value.$t, tone: 'type' }
  }
}

function preview(value: unknown, depth = 2): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    if (depth === 0) return `[…${value.length}]`
    return `[${value.slice(0, 5).map((v) => preview(v, depth - 1)).join(', ')}${value.length > 5 ? ', …' : ''}]`
  }
  if (isTagged(value)) {
    if (value.$t === 'object' || value.$t === 'instance') return preview(value.v, depth)
    return describe(value, 60).text
  }
  const keys = Object.keys(value)
  if (depth === 0) return `{…${keys.length}}`
  const parts = keys.slice(0, 4).map((k) => `${k}: ${preview((value as Record<string, unknown>)[k], depth - 1)}`)
  return `{ ${parts.join(', ')}${keys.length > 4 ? ', …' : ''} }`
}

/** A value on one line; truncates with a tooltip when it does not fit. */
export function ValueText({
  value,
  described,
  isStruck,
}: {
  value?: unknown
  described?: Described
  isStruck?: boolean
}) {
  const d = described ?? describe(value)
  return (
    <Text type="code" maxLines={1} hasStrikethrough={isStruck} data-zi-tone={d.tone}>
      {d.text}
    </Text>
  )
}

/** `key: value` on one line, as used in tree rows. */
export function KeyValue({ name, value }: { name: Described; value: Described }) {
  return (
    <HStack gap={1.5} vAlign="center">
      <Text type="code" data-zi-tone={name.tone}>
        {name.text.endsWith('→') ? name.text : `${name.text}:`}
      </Text>
      <StackItem size="fill">
        <ValueText described={value} />
      </StackItem>
    </HStack>
  )
}
