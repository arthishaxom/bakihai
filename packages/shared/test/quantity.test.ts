import { describe, expect, it } from 'vitest'
import { formatHundredthsAsQuantity, parseQuantityToHundredths } from '../src/quantity'

describe('parseQuantityToHundredths', () => {
  it('parses whole quantities into hundredths', () => {
    expect(parseQuantityToHundredths('3')).toBe(300)
    expect(parseQuantityToHundredths('1')).toBe(100)
    expect(parseQuantityToHundredths('0')).toBe(0)
  })

  it('parses one or two decimal places exactly', () => {
    expect(parseQuantityToHundredths('3.5')).toBe(350)
    expect(parseQuantityToHundredths('3.50')).toBe(350)
    expect(parseQuantityToHundredths('1.25')).toBe(125)
    expect(parseQuantityToHundredths('0.05')).toBe(5)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseQuantityToHundredths('  12  ')).toBe(1200)
  })

  it('rejects text that is not a quantity', () => {
    expect(parseQuantityToHundredths('')).toBeNull()
    expect(parseQuantityToHundredths('  ')).toBeNull()
    expect(parseQuantityToHundredths('eggs')).toBeNull()
    expect(parseQuantityToHundredths('1.234')).toBeNull()
    expect(parseQuantityToHundredths('1e3')).toBeNull()
    expect(parseQuantityToHundredths('-5')).toBeNull()
    expect(parseQuantityToHundredths('3 kg')).toBeNull()
    expect(parseQuantityToHundredths('1,000')).toBeNull()
    expect(parseQuantityToHundredths('12.')).toBeNull()
    expect(parseQuantityToHundredths('.5')).toBeNull()
  })

  it('rejects quantities beyond exact integer arithmetic', () => {
    expect(parseQuantityToHundredths('999999999999999999')).toBeNull()
  })
})

describe('formatHundredthsAsQuantity', () => {
  it('formats whole quantities without decimals', () => {
    expect(formatHundredthsAsQuantity(300)).toBe('3')
    expect(formatHundredthsAsQuantity(0)).toBe('0')
  })

  it('shows hundredths without a trailing zero', () => {
    expect(formatHundredthsAsQuantity(350)).toBe('3.5')
    expect(formatHundredthsAsQuantity(125)).toBe('1.25')
    expect(formatHundredthsAsQuantity(5)).toBe('0.05')
  })

  it('refuses quantities that are not non-negative integer hundredths', () => {
    expect(() => formatHundredthsAsQuantity(-1)).toThrow(RangeError)
    expect(() => formatHundredthsAsQuantity(1.5)).toThrow(RangeError)
    expect(() => formatHundredthsAsQuantity(Number.NaN)).toThrow(RangeError)
  })
})
