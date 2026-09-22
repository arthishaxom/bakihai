import { z } from 'zod'
import { compareText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'
import { foldMemberKeys } from './members'
import { foldVoids } from './voids'

/** Entry type that records a Settlement: a real payment from one Member to another. */
export const SETTLEMENT_ENTRY_TYPE = 'settlement'

/** Entry type that records a Confirm: a Settlement's receiver's key attesting to a claim. */
export const SETTLEMENT_CONFIRM_ENTRY_TYPE = 'settlement-confirm'

/** Longest note a Settlement may carry. */
export const SETTLEMENT_NOTE_MAX_LENGTH = 200

/**
 * The tag a Settlement may carry: the Expense or Loan it pays off. The kind
 * keeps the reference readable on its own, and the Entry id is a uuidv7 like
 * every other reference in the book. The tag powers an item's computed
 * coverage and Settled state, and never changes the Balance arithmetic
 * (ADR-0004).
 */
export const settlementTagSchema = z.strictObject({
  kind: z.enum(['expense', 'loan']),
  entryId: z.uuidv7(),
})

export type SettlementTag = z.infer<typeof settlementTagSchema>

/**
 * The payload of a Settlement Entry: who paid whom, and how much. The amount is
 * stored exactly like paise (ADR-0008), the note is free text, and either side
 * may author it — the payer claims "I paid", the receiver records "they paid
 * me" (ADR-0007). A Settlement the receiver's key authored starts confirmed
 * (ADR-0015, ADR-0021). An optional tag names the Expense or Loan this payment
 * pays off.
 */
export const settlementEntryPayloadSchema = z
  .strictObject({
    fromDeviceId: z.string().min(1),
    toDeviceId: z.string().min(1),
    amountPaise: z.int().positive(),
    note: z.string().trim().min(1).max(SETTLEMENT_NOTE_MAX_LENGTH).optional(),
    tag: settlementTagSchema.optional(),
  })
  .refine((payload) => payload.fromDeviceId !== payload.toDeviceId, {
    message: 'a Settlement cannot be from a Member to themselves',
  })

export type SettlementEntryPayload = z.infer<typeof settlementEntryPayloadSchema>

/**
 * The payload of a Confirm Entry: the Settlement the receiver's key attests
 * to. A Confirm naming a Voided Settlement is moot and ignored (ADR-0015).
 */
export const settlementConfirmEntryPayloadSchema = z.strictObject({
  settlementEntryId: z.uuidv7(),
})

export type SettlementConfirmEntryPayload = z.infer<typeof settlementConfirmEntryPayloadSchema>

/**
 * Reads a Settlement's payload, or undefined when the Entry is not a Settlement
 * or its payload is not one this app version understands.
 */
export function readSettlementPayload(entry: EntryEnvelope): SettlementEntryPayload | undefined {
  if (entry.type !== SETTLEMENT_ENTRY_TYPE) {
    return undefined
  }

  const parsed = settlementEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** Reads a Confirm's payload, or undefined when the Entry is not a readable Confirm. */
export function readSettlementConfirmPayload(
  entry: EntryEnvelope,
): SettlementConfirmEntryPayload | undefined {
  if (entry.type !== SETTLEMENT_CONFIRM_ENTRY_TYPE) {
    return undefined
  }

  const parsed = settlementConfirmEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** What a device needs to write a Settlement Entry. */
export interface CreateSettlementEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  fromDeviceId: string
  toDeviceId: string
  amountPaise: number
  /** Optional free-text note, kept as written minus surrounding whitespace. */
  note?: string
  /** Optional tag naming the Expense or Loan this payment pays off. */
  tag?: SettlementTag
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Settlement Entry: a signed record of money that moved
 * between two Members. Either side may author it (ADR-0007), and a Settlement
 * the receiver's key authored is confirmed by its own authorship (ADR-0015,
 * ADR-0021). A tag, when one is given, names the Expense or Loan the payment
 * pays off.
 */
export async function createSettlementEntry(
  input: CreateSettlementEntryInput,
): Promise<EntryEnvelope> {
  const { fromDeviceId, toDeviceId, amountPaise, note, tag } = settlementEntryPayloadSchema.parse({
    fromDeviceId: input.fromDeviceId,
    toDeviceId: input.toDeviceId,
    amountPaise: input.amountPaise,
    ...(input.note?.trim() ? { note: input.note } : {}),
    ...(input.tag === undefined ? {} : { tag: input.tag }),
  })
  // Missing fields are left out of the JSON entirely rather than written as
  // undefined, which the canonical-JSON envelope cannot hold.
  const payload = {
    fromDeviceId,
    toDeviceId,
    amountPaise,
    ...(note === undefined ? {} : { note }),
    ...(tag === undefined ? {} : { tag }),
  }

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: SETTLEMENT_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/** What a device needs to write a Confirm Entry. */
export interface CreateSettlementConfirmEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  settlementEntryId: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Confirm Entry: a signed attestation that a Settlement
 * the receiver did not write happened. The fold is the gate, not this writer:
 * a Confirm from any key but the receiver's is ignored, so a device that never
 * received the money cannot mark it confirmed (ADR-0015, ADR-0021).
 */
export async function createSettlementConfirmEntry(
  input: CreateSettlementConfirmEntryInput,
): Promise<EntryEnvelope> {
  const payload = settlementConfirmEntryPayloadSchema.parse({
    settlementEntryId: input.settlementEntryId,
  })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: SETTLEMENT_CONFIRM_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/**
 * A Settlement folded from the whole book: the money that moved, and whether
 * its receiver's key has attested to it. A Settlement the receiver's key
 * authored is confirmed by its own authorship; a payer's claim is confirmed by
 * a Confirm Entry that key wrote (ADR-0015, ADR-0021).
 */
export interface SettlementState {
  settlementEntryId: string
  entry: EntryEnvelope
  fromDeviceId: string
  toDeviceId: string
  amountPaise: number
  note?: string
  /** The Expense or Loan this Settlement pays off, when it carries a tag. */
  tag?: SettlementTag
  /** The receiver's Confirm Entry, when one attests to this Settlement. */
  confirmation?: EntryEnvelope
  /** True when the receiver's key authored the Settlement or confirmed a claim. */
  confirmed: boolean
}

/**
 * Folds the book's Settlement and Confirm Entries into payment states. A
 * Settlement counts from the moment it is appended (ADR-0007), so the fold
 * never holds one back: it only says whether the receiver's key has attested
 * to it. Attestation is by that key, not by the receiver's device id
 * (ADR-0021): a Settlement is confirmed when its author holds the key bound to
 * the receiver's id — for a Member whose own phone holds it, that is the
 * receiver's own authorship — and a Confirm counts when that key holder wrote
 * it. A Confirm from any other key is ignored, as is one naming a Voided
 * Settlement; when two Confirms name one Settlement, the earliest by Entry id
 * wins, so every device reports the same confirmation. Voided Entries drop out
 * entirely, and a Voided Confirm reopens the claim it had closed (ADR-0005).
 * The result is a pure function of the Entries — the same book folds the same
 * payments in any order — and Entries this version cannot read are ignored
 * rather than misread.
 */
export function foldSettlements(entries: EntryEnvelope[]): SettlementState[] {
  const voidedByTarget = foldVoids(entries)
  const memberKeys = foldMemberKeys(entries)
  const settlements = new Map<string, { entry: EntryEnvelope; payload: SettlementEntryPayload }>()

  for (const entry of entries) {
    if (entry.type !== SETTLEMENT_ENTRY_TYPE || voidedByTarget.has(entry.id)) {
      continue
    }

    const payload = settlementEntryPayloadSchema.safeParse(entry.payload)

    if (payload.success) {
      settlements.set(entry.id, { entry, payload: payload.data })
    }
  }

  const confirms = entries
    .filter(
      (entry) => entry.type === SETTLEMENT_CONFIRM_ENTRY_TYPE && !voidedByTarget.has(entry.id),
    )
    .sort((left, right) => compareText(left.id, right.id))
  const confirmationBySettlementId = new Map<string, EntryEnvelope>()

  for (const confirmEntry of confirms) {
    const payload = readSettlementConfirmPayload(confirmEntry)

    if (!payload) {
      continue
    }

    const settlement = settlements.get(payload.settlementEntryId)

    if (
      !settlement ||
      memberKeys.get(settlement.payload.toDeviceId) !== confirmEntry.signerPublicKey
    ) {
      continue
    }

    if (!confirmationBySettlementId.has(settlement.entry.id)) {
      confirmationBySettlementId.set(settlement.entry.id, confirmEntry)
    }
  }

  return [...settlements.values()]
    .map(({ entry, payload }): SettlementState => {
      const confirmation = confirmationBySettlementId.get(entry.id)
      // A Settlement the receiver's key wrote is a record of what happened,
      // not a claim: there is nothing left to attest (ADR-0015, ADR-0021).
      const receiverKeyAuthored = memberKeys.get(payload.toDeviceId) === entry.signerPublicKey

      return {
        settlementEntryId: entry.id,
        entry,
        fromDeviceId: payload.fromDeviceId,
        toDeviceId: payload.toDeviceId,
        amountPaise: payload.amountPaise,
        ...(payload.note === undefined ? {} : { note: payload.note }),
        ...(payload.tag === undefined ? {} : { tag: payload.tag }),
        ...(confirmation === undefined ? {} : { confirmation }),
        confirmed: receiverKeyAuthored || confirmation !== undefined,
      }
    })
    .sort((left, right) => compareText(left.settlementEntryId, right.settlementEntryId))
}

/**
 * The Settlements still waiting for the receiver's key to attest:
 * payer-written claims with no Confirm yet. This is the count the book shows
 * near Balances, so nothing sits in limbo (ADR-0007).
 */
export function foldSettlementsAwaitingConfirmation(entries: EntryEnvelope[]): SettlementState[] {
  return foldSettlements(entries).filter((settlement) => !settlement.confirmed)
}
