/** Item quantities as typed by a Member: digits, up to two decimals. */
const QUANTITY_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses a quantity typed by a Member into integer hundredths, or null when the
 * text is not a quantity. Quantities are stored exactly like paise (ADR-0008):
 * up to two decimals are typed and an exact integer is kept, so a Loan of 3.25
 * is 325 hundredths.
 */
export function parseQuantityToHundredths(input: string): number | null {
  const match = QUANTITY_PATTERN.exec(input.trim())

  if (!match) {
    return null
  }

  const whole = Number(match[1] ?? '')
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const hundredths = whole * 100 + fraction

  return Number.isSafeInteger(hundredths) ? hundredths : null
}

/**
 * Formats integer hundredths as the quantity a Member reads: whole quantities
 * lose the decimals, 350 becomes "3.5", and 5 becomes "0.05".
 */
export function formatHundredthsAsQuantity(hundredths: number): string {
  if (!Number.isSafeInteger(hundredths) || hundredths < 0) {
    throw new RangeError('Quantity must be a non-negative integer number of hundredths')
  }

  const whole = Math.floor(hundredths / 100)
  const fraction = hundredths % 100

  if (fraction === 0) {
    return String(whole)
  }

  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}`
}
