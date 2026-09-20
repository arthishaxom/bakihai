import { z } from 'zod'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'

/** Entry type that records an Expense: one Member paid, others share the cost. */
export const EXPENSE_ENTRY_TYPE = 'expense'

/**
 * The payload of an Expense Entry: a payer, the Members sharing the cost, and
 * the amount in integer paise (ADR-0008). The payer is a participant when they
 * share the cost and omitted when treating the others; either way every device
 * computes the same equal split from this Entry, so no per-Member shares are
 * stored.
 */
export const expenseEntryPayloadSchema = z.strictObject({
  amountPaise: z.int().positive(),
  payerDeviceId: z.string().min(1),
  participantDeviceIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((deviceIds) => new Set(deviceIds).size === deviceIds.length, {
      message: 'participantDeviceIds must be unique',
    }),
})

export type ExpenseEntryPayload = z.infer<typeof expenseEntryPayloadSchema>

/** What one participant owes for an Expense, computed from its amount. */
export interface ExpenseShare {
  deviceId: string
  amountPaise: number
}

/**
 * Splits an amount equally into integer paise. Any remainder is handed out one
 * paise at a time to the participants in device-id order, so every device
 * computes identical shares from the same Entry, and the shares always sum to
 * the amount exactly (ADR-0008).
 */
export function splitExpense(amountPaise: number, participantDeviceIds: string[]): ExpenseShare[] {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new RangeError('Amount must be a positive integer number of paise')
  }

  if (participantDeviceIds.length === 0) {
    throw new Error('An Expense needs at least one participant')
  }

  const participants = [...participantDeviceIds].sort()

  if (new Set(participants).size !== participants.length) {
    throw new Error('Participants must be unique')
  }

  const base = Math.floor(amountPaise / participants.length)
  const remainder = amountPaise % participants.length

  return participants.map((deviceId, index) => ({
    deviceId,
    amountPaise: base + (index < remainder ? 1 : 0),
  }))
}

/** What a device needs to write an Expense Entry. */
export interface CreateExpenseEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  amountPaise: number
  payerDeviceId: string
  participantDeviceIds: string[]
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/** Writes this device's Expense Entry: a signed record of who paid and who shares. */
export async function createExpenseEntry(input: CreateExpenseEntryInput): Promise<EntryEnvelope> {
  const payload = expenseEntryPayloadSchema.parse({
    amountPaise: input.amountPaise,
    payerDeviceId: input.payerDeviceId,
    participantDeviceIds: input.participantDeviceIds,
  })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: EXPENSE_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}
