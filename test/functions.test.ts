import { describe, expect, it } from 'vitest'
import { encodeFunction, formatFunction, paramsOf } from '../src/functions'
import { serialize } from '../src'

describe('function signatures', () => {
  it('reads parameters from arrows, functions and methods', () => {
    expect(paramsOf('(step) => set({ step })')).toBe('step')
    expect(paramsOf('step => step')).toBe('step')
    expect(paramsOf('async (id, { force = false } = {}) => {}')).toBe('id, { force = false } = {}')
    expect(paramsOf('function add(title /* the title */, done) {}')).toBe('title , done')
    expect(paramsOf('load() { return 1 }')).toBe('')
    expect(paramsOf('(a = ")", b) => a')).toBe('a = "…", b')
    expect(paramsOf("(token = 'super-secret') => token")).toBe('token = "…"')
  })

  it('encodes kind, name and params', () => {
    const state = {
      increment: () => {},
      setStep: (step: number) => step,
      load: async () => {},
      *ids() {},
      Todo: class Todo {},
      push: [].push,
    }
    const encoded = serialize(state) as Record<string, unknown>
    expect(encoded.increment).toEqual({ $t: 'function', name: 'increment', params: '' })
    expect(formatFunction(encoded.setStep as object)).toBe('setStep(step)')
    expect(formatFunction(encoded.load as object)).toBe('async load()')
    expect(formatFunction(encoded.ids as object)).toBe('ids*()')
    expect(formatFunction(encoded.Todo as object)).toBe('class Todo')
    expect(formatFunction(encoded.push as object)).toBe('push() [native code]')
  })

  it('keeps older exports without params readable', () => {
    expect(formatFunction({ $t: 'function', name: 'increment' })).toBe('increment()')
    expect(formatFunction(encodeFunction(function () {}))).toBe('anonymous()')
  })
})
