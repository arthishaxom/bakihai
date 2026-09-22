import { describe, expect, it } from 'vitest'
import { buildUpiIntent, isUpiId, UPI_ID_MAX_LENGTH } from '../src/upi'

describe('buildUpiIntent', () => {
  it('builds a upi://pay intent with the payee, rupee amount, and note', () => {
    expect(
      buildUpiIntent({
        payeeUpiId: 'mira@ybl',
        payeeName: 'Mira Nair',
        amountPaise: 45_000,
        note: 'for dinner',
      }),
    ).toBe('upi://pay?pa=mira%40ybl&pn=Mira%20Nair&am=450&cu=INR&tn=for%20dinner')
  })

  it('leaves the note out when none was written and keeps exact paise', () => {
    expect(
      buildUpiIntent({
        payeeUpiId: 'rohan@okhdfcbank',
        payeeName: 'Rohan',
        amountPaise: 9_950,
      }),
    ).toBe('upi://pay?pa=rohan%40okhdfcbank&pn=Rohan&am=99.50&cu=INR')
  })

  it('percent-encodes reserved characters so every value survives the deep link', () => {
    expect(
      buildUpiIntent({
        payeeUpiId: 'rohan.p-2@ybl',
        payeeName: 'Rohan & Co',
        amountPaise: 100,
        note: 'chai #1',
      }),
    ).toBe('upi://pay?pa=rohan.p-2%40ybl&pn=Rohan%20%26%20Co&am=1&cu=INR&tn=chai%20%231')
  })
})

describe('isUpiId', () => {
  it('accepts a name@handle with the punctuation UPI IDs actually use', () => {
    expect(isUpiId('rohan@ybl')).toBe(true)
    expect(isUpiId('rohan.pothal-1_2@okhdfcbank')).toBe(true)
    expect(isUpiId(`${'a'.repeat(UPI_ID_MAX_LENGTH - 4)}@ybl`)).toBe(true)
    expect(isUpiId('9@a')).toBe(true)
  })

  it('refuses what is not a name@handle', () => {
    expect(isUpiId('rohan')).toBe(false)
    expect(isUpiId('rohan@')).toBe(false)
    expect(isUpiId('@ybl')).toBe(false)
    expect(isUpiId('rohan@y@bl')).toBe(false)
    expect(isUpiId('.rohan@ybl')).toBe(false)
    expect(isUpiId('rohan@1ybl')).toBe(false)
    expect(isUpiId(`${'a'.repeat(UPI_ID_MAX_LENGTH - 3)}@ybl`)).toBe(false)
  })
})
