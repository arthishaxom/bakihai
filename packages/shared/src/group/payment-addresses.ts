import { z } from 'zod'
import { compareText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { isUpiId, UPI_ID_MAX_LENGTH } from '../upi'
import { uuidv7 } from '../uuidv7'
import { foldVoids } from './voids'

/** Entry type that records a Member's Payment address: where the Group pays them by UPI. */
export const PAYMENT_ADDRESS_ENTRY_TYPE = 'payment-address'

/** Longest payee name the app accepts. */
export const PAYEE_NAME_MAX_LENGTH = 60

/**
 * The payload of a Payment address Entry: the UPI ID to pay and the name on
 * that account. It names no Member: the address always belongs to the Entry's
 * author, so one device can never set another Member's address.
 */
export const paymentAddressEntryPayloadSchema = z.strictObject({
  upiId: z.string().trim().min(1).max(UPI_ID_MAX_LENGTH).refine(isUpiId, {
    message: 'a UPI ID reads like name@bank',
  }),
  payeeName: z.string().trim().min(1).max(PAYEE_NAME_MAX_LENGTH),
})

export type PaymentAddressEntryPayload = z.infer<typeof paymentAddressEntryPayloadSchema>

/** A Member's Payment address, folded from their latest Payment address Entry. */
export interface PaymentAddress {
  deviceId: string
  upiId: string
  payeeName: string
}

/** What a device needs to write its own Payment address Entry. */
export interface CreatePaymentAddressEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  upiId: string
  payeeName: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Payment address: a signed record of where money sent to
 * its Member should go. It is an Entry like any other, so it syncs to every
 * device, and only the device's own key can author it (#8).
 */
export async function createPaymentAddressEntry(
  input: CreatePaymentAddressEntryInput,
): Promise<EntryEnvelope> {
  const payload = paymentAddressEntryPayloadSchema.parse({
    upiId: input.upiId,
    payeeName: input.payeeName,
  })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: PAYMENT_ADDRESS_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/**
 * Reads a Payment address's payload, or undefined when the Entry is not a
 * Payment address or its payload is not one this app version understands.
 */
export function readPaymentAddressPayload(
  entry: EntryEnvelope,
): PaymentAddressEntryPayload | undefined {
  if (entry.type !== PAYMENT_ADDRESS_ENTRY_TYPE) {
    return undefined
  }

  const parsed = paymentAddressEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/**
 * Folds the book's Payment address Entries into one address per Member, keyed
 * by device id. An Entry names no Member, so an address always belongs to its
 * author and one device can never set another's. The latest live Entry by Entry
 * id wins, so editing an address replaces it everywhere rather than adding a
 * second one. A Voided Entry drops out, standing aside for the address it
 * replaced, if any (ADR-0005); a Member with no address simply has none. The
 * result is a pure function of the Entries — the same book folds the same
 * addresses in any order — and Entries this version cannot read are ignored
 * rather than misread.
 */
export function foldPaymentAddresses(entries: EntryEnvelope[]): Map<string, PaymentAddress> {
  const voidedByTarget = foldVoids(entries)
  const addresses = entries
    .filter((entry) => entry.type === PAYMENT_ADDRESS_ENTRY_TYPE && !voidedByTarget.has(entry.id))
    .sort((left, right) => compareText(left.id, right.id))
  const byDeviceId = new Map<string, PaymentAddress>()

  for (const entry of addresses) {
    const payload = readPaymentAddressPayload(entry)

    if (payload) {
      byDeviceId.set(entry.authorDeviceId, {
        deviceId: entry.authorDeviceId,
        upiId: payload.upiId,
        payeeName: payload.payeeName,
      })
    }
  }

  return byDeviceId
}
