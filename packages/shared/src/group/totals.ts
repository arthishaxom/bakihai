/**
 * The ceiling a fold's sums saturate at: the largest integer JavaScript holds
 * exactly. Amounts and quantities are integer paise and hundredths (ADR-0008),
 * and every sum of them has to stay inside this range, or the arithmetic stops
 * being exact and stops being order-independent — the property every fold
 * promises. A modified client can write Entries whose amounts are each valid
 * but whose sum is not (#21), so the folds saturate here rather than handing
 * the screens a number no formatter can read.
 */
export const MAX_EXACT_SUM = Number.MAX_SAFE_INTEGER

/**
 * Adds two non-negative amounts, saturating at the ceiling. Saturating addition
 * is associative for non-negative values, so the order Entries arrive in never
 * changes the result, which is why it is safe inside a fold. Balances net in
 * both directions, where saturation is not associative, so they add exactly in
 * BigInt and clamp once instead.
 */
export function addSaturating(left: number, right: number): number {
  return Math.min(MAX_EXACT_SUM, left + right)
}

/** Narrows an exact BigInt sum into the exact-integer range, clamping at the ceiling. */
export function clampToExactSum(value: bigint): number {
  const ceiling = BigInt(MAX_EXACT_SUM)

  if (value > ceiling) {
    return MAX_EXACT_SUM
  }

  if (value < -ceiling) {
    return -MAX_EXACT_SUM
  }

  return Number(value)
}
