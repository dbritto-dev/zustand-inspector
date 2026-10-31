import { isTagged } from '../serialize'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type NodeKind = 'object' | 'array' | 'map' | 'set' | 'instance' | 'leaf'

export interface Child {
  key: string
  keyHtml: string
  value: unknown
}

/** Describe how a serialized value should be shown in the tree. */
export function nodeKind(value: unknown): NodeKind {
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

export function isFunctionValue(value: unknown): boolean {
  return isTagged(value) && value.$t === 'function'
}

export function childrenOf(value: unknown, showFunctions: boolean): Array<Child> {
  const kind = nodeKind(value)
  const keep = (v: unknown) => showFunctions || !isFunctionValue(v)
  if (kind === 'array') {
    return (value as Array<unknown>)
      .map((v, i) => ({ key: String(i), keyHtml: `<span class="zi-index">${i}</span>`, value: v }))
      .filter((c) => keep(c.value))
  }
  if (kind === 'object' || kind === 'instance') {
    const body = (isTagged(value) ? value.v : value) as Record<string, unknown>
    return Object.entries(body)
      .filter(([, v]) => keep(v))
      .map(([k, v]) => ({ key: k, keyHtml: `<span class="zi-key">${escapeHtml(k)}</span>`, value: v }))
  }
  if (kind === 'map') {
    const entries = (value as { v: Array<[unknown, unknown]> }).v
    return entries
      .filter(([, v]) => keep(v))
      .map(([k, v], i) => ({
        key: `entry ${i}`,
        keyHtml: `<span class="zi-mapkey">${inline(k, 40)}</span><span class="zi-arrow">→</span>`,
        value: v,
      }))
  }
  if (kind === 'set') {
    return (value as { v: Array<unknown> }).v.map((v, i) => ({
      key: String(i),
      keyHtml: `<span class="zi-index">${i}</span>`,
      value: v,
    }))
  }
  return []
}

/** Summary shown next to a collapsible node. */
export function summary(value: unknown, showFunctions: boolean): string {
  const kind = nodeKind(value)
  const count = childrenOf(value, showFunctions).length
  switch (kind) {
    case 'array':
      return `<span class="zi-type">Array(${(value as Array<unknown>).length})</span>`
    case 'map':
      return `<span class="zi-type">Map(${(value as { size: number }).size})</span>`
    case 'set':
      return `<span class="zi-type">Set(${(value as { size: number }).size})</span>`
    case 'instance':
      return `<span class="zi-type">${escapeHtml(String((value as { name: string }).name))}</span> <span class="zi-muted">{${count}}</span>`
    default:
      return `<span class="zi-muted">{${count} ${count === 1 ? 'key' : 'keys'}}</span>`
  }
}

/** One-line rendering of any serialized value (leaves fully, containers abbreviated). */
export function inline(value: unknown, max = 80): string {
  if (value === null) return '<span class="zi-null">null</span>'
  if (typeof value === 'string') {
    const text = value.length > max ? `${value.slice(0, max)}…` : value
    return `<span class="zi-str" title="${escapeHtml(value.slice(0, 2000))}">"${escapeHtml(text)}"</span>`
  }
  if (typeof value === 'number') return `<span class="zi-num">${value}</span>`
  if (typeof value === 'boolean') return `<span class="zi-bool">${value}</span>`
  if (Array.isArray(value)) {
    return `<span class="zi-type">Array(${value.length})</span> <span class="zi-muted">${escapeHtml(preview(value, max))}</span>`
  }
  if (typeof value !== 'object') return escapeHtml(String(value))
  if (!isTagged(value)) {
    return `<span class="zi-muted">${escapeHtml(preview(value, max))}</span>`
  }
  switch (value.$t) {
    case 'undefined':
      return '<span class="zi-null">undefined</span>'
    case 'number':
      return `<span class="zi-num">${escapeHtml(String(value.v))}</span>`
    case 'bigint':
      return `<span class="zi-num">${escapeHtml(String(value.v))}n</span>`
    case 'Date':
      return `<span class="zi-date">Date</span> <span class="zi-str">${escapeHtml(String(value.v))}</span>`
    case 'function':
      return `<span class="zi-fn">ƒ ${escapeHtml(String(value.name))}()</span>`
    case 'redacted':
      return '<span class="zi-redacted" title="Redacted in the page before sending">•••• redacted</span>'
    case 'truncated':
      return '<span class="zi-muted" title="maxDepth reached">… truncated</span>'
    case 'more':
      return `<span class="zi-muted">… ${escapeHtml(String(value.count))} more</span>`
    case 'ref':
      return `<span class="zi-muted">[Circular ~${escapeHtml((value.path as Array<unknown>).join('.'))}]</span>`
    case 'symbol':
      return `<span class="zi-fn">Symbol(${escapeHtml(String(value.v))})</span>`
    case 'RegExp':
      return `<span class="zi-str">/${escapeHtml(String(value.source))}/${escapeHtml(String(value.flags))}</span>`
    case 'Error':
      return `<span class="zi-error">${escapeHtml(String(value.name))}: ${escapeHtml(String(value.message))}</span>`
    case 'Map':
    case 'Set':
      return `<span class="zi-type">${value.$t}(${escapeHtml(String(value.size))})</span>`
    case 'instance':
      return `<span class="zi-type">${escapeHtml(String(value.name))}</span> <span class="zi-muted">${escapeHtml(preview(value.v, max))}</span>`
    case 'object':
      return `<span class="zi-muted">${escapeHtml(preview(value.v, max))}</span>`
    default:
      return `<span class="zi-type">${escapeHtml(value.$t)}</span>`
  }
}

/** Plain-text compact preview, e.g. `{ count: 1, items: […] }`. */
export function preview(value: unknown, max = 80): string {
  const text = previewInner(value, 2)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function previewInner(value: unknown, depth: number): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    if (depth === 0) return `[…${value.length}]`
    return `[${value.slice(0, 5).map((v) => previewInner(v, depth - 1)).join(', ')}${value.length > 5 ? ', …' : ''}]`
  }
  if (isTagged(value)) {
    switch (value.$t) {
      case 'undefined':
        return 'undefined'
      case 'Date':
        return `Date(${value.v})`
      case 'function':
        return `ƒ ${value.name}()`
      case 'redacted':
        return '••••'
      case 'bigint':
        return `${value.v}n`
      case 'number':
        return String(value.v)
      case 'Map':
      case 'Set':
        return `${value.$t}(${value.size})`
      case 'object':
      case 'instance':
        return previewInner(value.v, depth)
      default:
        return value.$t
    }
  }
  const keys = Object.keys(value)
  if (depth === 0) return `{…${keys.length}}`
  const parts = keys
    .slice(0, 4)
    .map((k) => `${k}: ${previewInner((value as Record<string, unknown>)[k], depth - 1)}`)
  return `{ ${parts.join(', ')}${keys.length > 4 ? ', …' : ''} }`
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

export function formatDelta(ms: number): string {
  if (ms < 1000) return `+${ms}ms`
  if (ms < 60_000) return `+${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`
  return `+${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}
