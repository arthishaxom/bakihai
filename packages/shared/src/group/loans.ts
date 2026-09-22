import { z } from 'zod'
import { compareText, laterText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'
import { addSaturating } from './totals'
import { foldVoids } from './voids'

/** Entry type that records a Loan: a Member took a quantity of an item from another. */
export const LOAN_ENTRY_TYPE = 'loan'

/** Entry type that records a Return: some quantity of a Loan's item came back. */
export const RETURN_ENTRY_TYPE = 'return'

/** Longest item label a Loan may carry. */
export const LOAN_ITEM_LABEL_MAX_LENGTH = 80

/** Longest unit a Loan may carry. */
export const LOAN_UNIT_MAX_LENGTH = 20

/**
 * The payload of a Loan Entry: who took what from whom. The quantity is stored
 * exactly like paise (ADR-0008) — a positive integer number of hundredths, so
 * 3.25 is 325 — and the item label and unit are free text, with no item
 * catalog (ADR-0006).
 */
export const loanEntryPayloadSchema = z
  .strictObject({
    itemLabel: z.string().trim().min(1).max(LOAN_ITEM_LABEL_MAX_LENGTH),
    quantityHundredths: z.int().positive(),
    unit: z.string().trim().min(1).max(LOAN_UNIT_MAX_LENGTH).optional(),
    lenderDeviceId: z.string().min(1),
    borrowerDeviceId: z.string().min(1),
  })
  .refine((payload) => payload.lenderDeviceId !== payload.borrowerDeviceId, {
    message: 'a Loan cannot be from a Member to themselves',
  })

export type LoanEntryPayload = z.infer<typeof loanEntryPayloadSchema>

/**
 * The payload of a Return Entry: the Loan it returns and how much came back.
 * A Return is only ever read against its Loan; the fold ignores one whose Loan
 * is not in the book or is Voided.
 */
export const returnEntryPayloadSchema = z.strictObject({
  loanEntryId: z.uuidv7(),
  quantityHundredths: z.int().positive(),
})

export type ReturnEntryPayload = z.infer<typeof returnEntryPayloadSchema>

/**
 * Reads a Loan's payload, or undefined when the Entry is not a Loan or its
 * payload is not one this app version understands. The fold is the usual
 * reader; this is for lines the fold has dropped, like a Voided Loan.
 */
export function readLoanPayload(entry: EntryEnvelope): LoanEntryPayload | undefined {
  if (entry.type !== LOAN_ENTRY_TYPE) {
    return undefined
  }

  const parsed = loanEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** Reads a Return's payload, or undefined when the Entry is not a readable Return. */
export function readReturnPayload(entry: EntryEnvelope): ReturnEntryPayload | undefined {
  if (entry.type !== RETURN_ENTRY_TYPE) {
    return undefined
  }

  const parsed = returnEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** What a device needs to write a Loan Entry. */
export interface CreateLoanEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  itemLabel: string
  quantityHundredths: number
  /** Optional free-text unit, kept as written minus surrounding whitespace. */
  unit?: string
  lenderDeviceId: string
  borrowerDeviceId: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Loan Entry: a signed record of who lent what to whom.
 * Any Member may record either direction, so this writes what it is asked to
 * (ADR-0007).
 */
export async function createLoanEntry(input: CreateLoanEntryInput): Promise<EntryEnvelope> {
  const { itemLabel, quantityHundredths, unit, lenderDeviceId, borrowerDeviceId } =
    loanEntryPayloadSchema.parse({
      itemLabel: input.itemLabel,
      quantityHundredths: input.quantityHundredths,
      ...(input.unit?.trim() ? { unit: input.unit } : {}),
      lenderDeviceId: input.lenderDeviceId,
      borrowerDeviceId: input.borrowerDeviceId,
    })
  // A missing unit is left out of the JSON entirely rather than written as
  // undefined, which the canonical-JSON envelope cannot hold.
  const payload =
    unit === undefined
      ? { itemLabel, quantityHundredths, lenderDeviceId, borrowerDeviceId }
      : { itemLabel, quantityHundredths, unit, lenderDeviceId, borrowerDeviceId }

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: LOAN_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/** What a device needs to write a Return Entry. */
export interface CreateReturnEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  loanEntryId: string
  quantityHundredths: number
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Return Entry: a signed record that some quantity of a
 * Loan's item came back. The fold is the gate, not this writer: a Return is
 * never rejected after the fact, so two phones that raced past the remaining
 * quantity fold to zero with an over-returned marker rather than corrupting
 * the book (ADR-0001, ADR-0006).
 */
export async function createReturnEntry(input: CreateReturnEntryInput): Promise<EntryEnvelope> {
  const payload = returnEntryPayloadSchema.parse({
    loanEntryId: input.loanEntryId,
    quantityHundredths: input.quantityHundredths,
  })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: RETURN_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/** One Return folded onto its Loan. */
export interface LoanReturn {
  entry: EntryEnvelope
  quantityHundredths: number
}

/**
 * A Loan folded from the whole book: its item, its direction, every admitted
 * Return, and what is still outstanding.
 */
export interface LoanState {
  loanEntryId: string
  entry: EntryEnvelope
  itemLabel: string
  unit?: string
  lenderDeviceId: string
  borrowerDeviceId: string
  quantityHundredths: number
  /** The admitted Returns, in Entry id order. */
  returns: LoanReturn[]
  returnedHundredths: number
  /** What is still outstanding, never below zero. */
  remainingHundredths: number
  /** How far past the Loan's quantity the Returns went; zero when they did not. */
  overReturnedByHundredths: number
  /** Nothing left outstanding. An over-returned Loan is settled and marked. */
  settled: boolean
  /**
   * When the Loan became Settled, on the Entry clocks: the first Return after
   * which nothing was outstanding, or the Loan's own `occurredAt` when it never
   * needed one. Absent while it is open. The archive deadline reads this; it is
   * computed, never stored (ADR-0005).
   */
  settledAt?: string
}

/**
 * When a Loan became Settled: the crossing point of its Returns, read from the
 * Entry clocks. Returns only ever add up, so the instant the Loan settled is
 * the `occurredAt` of the first Return whose cumulative quantity covered the
 * Loan — every earlier Return was already there, and a later one, even an
 * over-return, cannot make it unsettled again. An over-returned Loan settled at
 * that same first crossing. Ties break on Entry id so every device picks the
 * same instant.
 */
function loanSettledAt(
  entry: EntryEnvelope,
  quantityHundredths: number,
  returns: LoanReturn[],
): string | undefined {
  const ordered = [...returns].sort(
    (left, right) =>
      compareText(left.entry.occurredAt, right.entry.occurredAt) ||
      compareText(left.entry.id, right.entry.id),
  )
  let returnedHundredths = 0

  for (const returned of ordered) {
    returnedHundredths = addSaturating(returnedHundredths, returned.quantityHundredths)

    if (returnedHundredths >= quantityHundredths) {
      // A Loan cannot have settled before it existed, however the clocks read.
      return laterText(entry.occurredAt, returned.entry.occurredAt)
    }
  }

  return undefined
}

/**
 * Folds the book's Loan and Return Entries into item states (ADR-0006): a
 * Loan's remaining quantity is its quantity minus the sum of its Returns,
 * clamped at zero, so two offline Returns that together exceed the quantity
 * fold to zero with an over-returned marker instead of a negative remainder. A
 * Settled Loan also carries the instant it settled, so the archive deadline is
 * computed rather than stored (ADR-0005). The result is a pure function of the
 * Entries — the same book folds the same items in any order, on any clock — and
 * Voided Entries drop out entirely, so a Voided Loan takes its Returns with it
 * and a Voided Return reopens what it had closed (ADR-0005). Entries this
 * version cannot read, and Returns whose Loan is not in the book, are ignored
 * rather than misread. The Returns' quantities are summed with saturation, so
 * an absurd pile of crafted Returns stays inside exact integer arithmetic
 * instead of folding a number no formatter can read (#21).
 */
export function foldLoans(entries: EntryEnvelope[]): LoanState[] {
  const voidedByTarget = foldVoids(entries)
  const loans = new Map<string, { entry: EntryEnvelope; payload: LoanEntryPayload }>()

  for (const entry of entries) {
    if (entry.type !== LOAN_ENTRY_TYPE || voidedByTarget.has(entry.id)) {
      continue
    }

    const payload = loanEntryPayloadSchema.safeParse(entry.payload)

    if (payload.success) {
      loans.set(entry.id, { entry, payload: payload.data })
    }
  }

  const returnsByLoanId = new Map<string, LoanReturn[]>()

  for (const entry of entries) {
    if (entry.type !== RETURN_ENTRY_TYPE || voidedByTarget.has(entry.id)) {
      continue
    }

    const payload = returnEntryPayloadSchema.safeParse(entry.payload)

    if (!payload.success) {
      continue
    }

    const loanId = payload.data.loanEntryId

    if (!loans.has(loanId)) {
      continue
    }

    const returns = returnsByLoanId.get(loanId) ?? []

    returns.push({ entry, quantityHundredths: payload.data.quantityHundredths })
    returnsByLoanId.set(loanId, returns)
  }

  return [...loans.values()]
    .map(({ entry, payload }): LoanState => {
      const returns = (returnsByLoanId.get(entry.id) ?? []).sort((left, right) =>
        compareText(left.entry.id, right.entry.id),
      )
      const returnedHundredths = returns.reduce(
        (total, returned) => addSaturating(total, returned.quantityHundredths),
        0,
      )
      const remainingHundredths = Math.max(0, payload.quantityHundredths - returnedHundredths)
      const settled = remainingHundredths === 0
      const settledAt = settled
        ? loanSettledAt(entry, payload.quantityHundredths, returns)
        : undefined

      return {
        loanEntryId: entry.id,
        entry,
        itemLabel: payload.itemLabel,
        ...(payload.unit === undefined ? {} : { unit: payload.unit }),
        lenderDeviceId: payload.lenderDeviceId,
        borrowerDeviceId: payload.borrowerDeviceId,
        quantityHundredths: payload.quantityHundredths,
        returns,
        returnedHundredths,
        remainingHundredths,
        overReturnedByHundredths: Math.max(0, returnedHundredths - payload.quantityHundredths),
        settled,
        ...(settledAt === undefined ? {} : { settledAt }),
      }
    })
    .sort((left, right) => compareText(left.loanEntryId, right.loanEntryId))
}
