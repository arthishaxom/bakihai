import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from '../src/bytes'

const utf8 = (value: string) => new TextEncoder().encode(value)

describe('base64url', () => {
  it('encodes the RFC 4648 test vectors without padding', () => {
    expect(toBase64Url(utf8(''))).toBe('')
    expect(toBase64Url(utf8('f'))).toBe('Zg')
    expect(toBase64Url(utf8('fo'))).toBe('Zm8')
    expect(toBase64Url(utf8('foo'))).toBe('Zm9v')
    expect(toBase64Url(utf8('foob'))).toBe('Zm9vYg')
    expect(toBase64Url(utf8('fooba'))).toBe('Zm9vYmE')
    expect(toBase64Url(utf8('foobar'))).toBe('Zm9vYmFy')
  })

  it('uses the URL-safe alphabet', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8')
  })

  it('round-trips arbitrary bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(300))

    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it('decodes the empty string to no bytes', () => {
    expect(fromBase64Url('')).toEqual(new Uint8Array())
  })

  it('rejects standard-base64 characters and padding', () => {
    expect(() => fromBase64Url('a+b/')).toThrow()
    expect(() => fromBase64Url('Zg==')).toThrow()
    expect(() => fromBase64Url('Zg=')).toThrow()
  })

  it('rejects impossible lengths', () => {
    expect(() => fromBase64Url('Z')).toThrow()
  })

  it('rejects encodings with trailing bits set', () => {
    expect(() => fromBase64Url('Zh')).toThrow()
  })
})
