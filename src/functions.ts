/**
 * Function values in state (a Zustand store's actions, mostly). The page sends
 * a small description instead of the function itself, so the panel can show a
 * readable signature such as `setStep(step)` or `async load()`.
 */

export type FunctionKind = 'async' | 'generator' | 'async generator' | 'class' | 'native' | 'bound'

export interface EncodedFunction {
  $t: 'function'
  name: string
  /** Parameter list as written, e.g. `step` or `id, { force = false }`. Missing for classes and native code. */
  params?: string
  kind?: FunctionKind
}

const MAX_PARAMS = 60
const MAX_SOURCE = 600

export function encodeFunction(fn: Function): EncodedFunction {
  const out: EncodedFunction = { $t: 'function', name: fn.name || 'anonymous' }
  let source = ''
  try {
    source = Function.prototype.toString.call(fn)
  } catch {
    // Proxies and some host objects refuse toString; the name is enough.
  }
  const kind = kindOf(fn, source)
  if (kind) out.kind = kind
  if (source && kind !== 'class' && kind !== 'native' && kind !== 'bound') {
    const params = paramsOf(source.slice(0, MAX_SOURCE))
    if (params !== undefined) out.params = params
  }
  return out
}

function kindOf(fn: Function, source: string): FunctionKind | undefined {
  if (fn.name.startsWith('bound ')) return 'bound'
  if (/^class[\s{]/.test(source)) return 'class'
  if (/\{\s*\[native code\]\s*\}$/.test(source)) return 'native'
  switch (fn.constructor?.name) {
    case 'AsyncFunction':
      return 'async'
    case 'GeneratorFunction':
      return 'generator'
    case 'AsyncGeneratorFunction':
      return 'async generator'
  }
  return undefined
}

/** The text between a function's parameter parentheses, or the single bare arrow parameter. */
export function paramsOf(source: string): string | undefined {
  const bare = /^(?:async\s+)?([\p{L}_$][\p{L}\p{N}_$]*)\s*=>/u.exec(source)
  if (bare) return bare[1]
  const open = source.indexOf('(')
  if (open < 0) return undefined
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return tidy(source.slice(open + 1, i))
    }
  }
  return '…'
}

function tidy(params: string): string {
  const text = params
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    // String defaults can hold anything (tokens included), so their contents never leave the page.
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > MAX_PARAMS ? `${text.slice(0, MAX_PARAMS - 1)}…` : text
}

/** A readable signature: `increment()`, `setStep(step)`, `async load()`, `class Todo`. */
export function formatFunction(value: object): string {
  const { name: rawName, params: rawParams, kind } = value as { name?: unknown; params?: unknown; kind?: unknown }
  const name = typeof rawName === 'string' && rawName ? rawName : 'anonymous'
  const params = typeof rawParams === 'string' ? rawParams : ''
  switch (kind) {
    case 'class':
      return `class ${name}`
    case 'native':
      return `${name}() [native code]`
    case 'async':
      return `async ${name}(${params})`
    case 'generator':
      return `${name}*(${params})`
    case 'async generator':
      return `async ${name}*(${params})`
    default:
      return `${name}(${params})`
  }
}
