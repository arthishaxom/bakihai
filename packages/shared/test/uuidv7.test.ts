import { afterEach, describe, expect, it, vi } from 'vitest'
import { uuidv7 } from '../src/uuidv7'

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats an RFC 9562 version 7 UUID', () => {
    expect(uuidv7(0x0123456789ab)).toMatch(UUID_V7_PATTERN)
  })

  it('encodes the timestamp in the first 48 bits, big-endian', () => {
    expect(uuidv7(0x010203040506).slice(0, 13)).toBe('01020304-0506')
    expect(uuidv7(0).slice(0, 13)).toBe('00000000-0000')
  })

  it('is unique across calls in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_760_000_000_000)))

    expect(ids.size).toBe(1000)
  })

  it('sorts lexicographically by timestamp', () => {
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true)
  })

  it('defaults to the device clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-20T10:00:00.000Z'))
    const expected = Date.now().toString(16).padStart(12, '0')

    expect(uuidv7().slice(0, 13)).toBe(`${expected.slice(0, 8)}-${expected.slice(8, 12)}`)
  })

  it('rejects timestamps outside the 48-bit range', () => {
    expect(() => uuidv7(-1)).toThrow(RangeError)
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError)
    expect(() => uuidv7(1.5)).toThrow(RangeError)
  })
})
