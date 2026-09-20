import { describe, expect, it } from 'vitest'
import { formatPaiseAsRupees, parseRupeesToPaise } from '../src/money'

describe('parseRupeesToPaise', () => {
  it('parses whole rupees into paise', () => {
    expect(parseRupeesToPaise('900')).toBe(90_000)
    expect(parseRupeesToPaise('1')).toBe(100)
    expect(parseRupeesToPaise('0')).toBe(0)
  })

  it('parses one or two decimal places exactly', () => {
    expect(parseRupeesToPaise('900.5')).toBe(90_050)
    expect(parseRupeesToPaise('900.50')).toBe(90_050)
    expect(parseRupeesToPaise('33.33')).toBe(3333)
    expect(parseRupeesToPaise('0.05')).toBe(5)
  })

  it('tolerates surrounding whitespace and a rupee sign', () => {
    expect(parseRupeesToPaise('  12  ')).toBe(1200)
    expect(parseRupeesToPaise('₹1.05')).toBe(105)
    expect(parseRupeesToPaise('₹ 1.05')).toBe(105)
  })

  it('rejects text that is not a rupee amount', () => {
    expect(parseRupeesToPaise('')).toBeNull()
    expect(parseRupeesToPaise('  ')).toBeNull()
    expect(parseRupeesToPaise('twelve')).toBeNull()
    expect(parseRupeesToPaise('12.345')).toBeNull()
    expect(parseRupeesToPaise('1e3')).toBeNull()
    expect(parseRupeesToPaise('-5')).toBeNull()
    expect(parseRupeesToPaise('₹')).toBeNull()
    expect(parseRupeesToPaise('12,000')).toBeNull()
    expect(parseRupeesToPaise('12.')).toBeNull()
    expect(parseRupeesToPaise('.5')).toBeNull()
  })

  it('rejects amounts beyond exact integer arithmetic', () => {
    expect(parseRupeesToPaise('999999999999999999')).toBeNull()
  })
})

describe('formatPaiseAsRupees', () => {
  it('formats whole rupees without decimals', () => {
    expect(formatPaiseAsRupees(90_000)).toBe('900')
    expect(formatPaiseAsRupees(0)).toBe('0')
  })

  it('always shows both paise digits when there are paise', () => {
    expect(formatPaiseAsRupees(90_050)).toBe('900.50')
    expect(formatPaiseAsRupees(3333)).toBe('33.33')
    expect(formatPaiseAsRupees(5)).toBe('0.05')
  })

  it('refuses amounts that are not non-negative integer paise', () => {
    expect(() => formatPaiseAsRupees(-1)).toThrow(RangeError)
    expect(() => formatPaiseAsRupees(1.5)).toThrow(RangeError)
    expect(() => formatPaiseAsRupees(Number.NaN)).toThrow(RangeError)
  })
})
