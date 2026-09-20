/** Rupees as typed by a Member: digits, up to two decimals, optional ₹ prefix. */
const RUPEES_PATTERN = /^(?:₹\s*)?(\d+)(?:\.(\d{1,2}))?$/

/**
 * Parses rupees typed by a Member into integer paise, or null when the text is
 * not a rupee amount (ADR-0008). Paise are never typed; the UI accepts rupees
 * with up to two decimals and stores the exact integer.
 */
export function parseRupeesToPaise(input: string): number | null {
  const match = RUPEES_PATTERN.exec(input.trim())

  if (!match) {
    return null
  }

  const whole = Number(match[1] ?? '')
  const fraction = Number((match[2] ?? '').padEnd(2, '0'))
  const paise = whole * 100 + fraction

  return Number.isSafeInteger(paise) ? paise : null
}

/**
 * Formats integer paise as the rupees a Member reads: whole rupees lose the
 * decimals, 90050 becomes "900.50", and 5 becomes "0.05". The currency symbol
 * is added by the caller.
 */
export function formatPaiseAsRupees(amountPaise: number): string {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new RangeError('Amount must be a non-negative integer number of paise')
  }

  const rupees = Math.floor(amountPaise / 100)
  const paise = amountPaise % 100

  return paise === 0 ? String(rupees) : `${rupees}.${String(paise).padStart(2, '0')}`
}
