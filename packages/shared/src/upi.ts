import { formatPaiseAsRupees } from './money'

/** Longest UPI ID the app accepts. */
export const UPI_ID_MAX_LENGTH = 100

/**
 * UPI IDs are `name@handle`: a local part of letters, digits, dots, hyphens and
 * underscores, then a handle of letters, with digits allowed after the first.
 */
const UPI_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z][a-zA-Z0-9]*$/

/** Whether a value reads as a UPI ID: `name@handle`, within the app's length cap. */
export function isUpiId(value: string): boolean {
  return value.length <= UPI_ID_MAX_LENGTH && UPI_ID_PATTERN.test(value)
}

/**
 * What a Payment address needs to build a payment: where the money goes, under
 * whose name, how much, and an optional note. The amount is paise (ADR-0008).
 */
export interface UpiIntentInput {
  payeeUpiId: string
  payeeName: string
  amountPaise: number
  /** Free-text note, carried as the transaction note when present. */
  note?: string
}

/**
 * Builds the UPI payment intent a Settlement offers: a `upi://pay` deep link
 * that opens the payer's UPI app with the payee, the rupee amount, and the note
 * prefilled. It is one string, so the same intent both opens the UPI app and is
 * rendered as a QR for in-person payment.
 */
export function buildUpiIntent(input: UpiIntentInput): string {
  const params: Array<[string, string]> = [
    ['pa', input.payeeUpiId],
    ['pn', input.payeeName],
    ['am', formatPaiseAsRupees(input.amountPaise)],
    ['cu', 'INR'],
  ]

  if (input.note !== undefined) {
    params.push(['tn', input.note])
  }

  // Values are percent-encoded by hand rather than through URLSearchParams,
  // which writes spaces as "+"; UPI apps expect the "upi://pay" query to read
  // like a normal URL.
  const query = params.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&')

  return `upi://pay?${query}`
}
