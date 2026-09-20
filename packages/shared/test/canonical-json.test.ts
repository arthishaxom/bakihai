import { describe, expect, it } from 'vitest'
import { canonicalJson, canonicalJsonBytes } from '../src/canonical-json'

describe('canonicalJson', () => {
  it('serializes primitives like JSON.stringify', () => {
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson(true)).toBe('true')
    expect(canonicalJson(false)).toBe('false')
    expect(canonicalJson(42)).toBe('42')
    expect(canonicalJson(-0)).toBe('0')
    expect(canonicalJson('a"b\\c')).toBe(JSON.stringify('a"b\\c'))
    expect(canonicalJson('हैलो')).toBe(JSON.stringify('हैलो'))
  })

  it('sorts object keys by UTF-16 code unit', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ z: 1, á: 2 })).toBe('{"z":1,"á":2}')
  })

  it('is independent of property insertion order at any depth', () => {
    const left = { a: 1, b: { d: 4, c: [{ g: 7, f: 6 }] } }
    const right = { b: { c: [{ f: 6, g: 7 }], d: 4 }, a: 1 }

    expect(canonicalJson(left)).toBe(canonicalJson(right))
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]')
  })

  it('rejects values JSON cannot represent', () => {
    const invalid: unknown[] = [undefined, NaN, Infinity, -Infinity, 1n, Symbol('s'), () => {}]

    for (const value of invalid) {
      expect(() => canonicalJson(value), String(value)).toThrow(TypeError)
    }

    expect(() => canonicalJson({ a: undefined })).toThrow(TypeError)
    expect(() => canonicalJson([undefined])).toThrow(TypeError)
    expect(() => canonicalJson(new Array<string>(3))).toThrow(TypeError)
    expect(() => canonicalJson(new Date())).toThrow(TypeError)
    expect(() => canonicalJson(new Map())).toThrow(TypeError)
    expect(() => canonicalJson({ [Symbol('k')]: 1 })).toThrow(TypeError)
  })

  it('encodes to UTF-8 bytes', () => {
    expect(new TextDecoder().decode(canonicalJsonBytes({ a: 'हैलो' }))).toBe('{"a":"हैलो"}')
  })
})
