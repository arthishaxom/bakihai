import { z } from 'zod'
import { compareText, laterText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'
import { foldSettlements, type SettlementState } from './settlements'
import { addSaturating } from './totals'
import { foldVoids } from './voids'

/** Entry type that records an Expense: one Member paid, others share the cost. */
export const EXPENSE_ENTRY_TYPE = 'expense'

/**
 * The payload of an Expense Entry: a payer, the Members sharing the cost, and
 * the amount in integer paise (ADR-0008). The payer is a participant when they
 * share the cost and omitted when fronting a cost the others owe; either way
 * every device computes the same equal split from this Entry, so no per-Member
 * shares are stored.
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

/**
 * One participant's progress on an Expense: their share, and the tagged
 * payments toward the payer that count against it. Only payments from this
 * participant to the payer count, and only while both are live: a payment
 * tagged to the Expense from anyone else — or in the other direction — moves
 * the Balance without touching coverage (ADR-0004).
 */
export interface ExpenseCoverage {
  deviceId: string
  sharePaise: number
  /** The live tagged Settlements from this participant to the payer, in Entry id order. */
  settlements: SettlementState[]
  /** What those Settlements amount to, exactly as paid; it may exceed the share. */
  paidPaise: number
  /** The paid part that counts against the share, never above it. */
  coveredPaise: number
  /** True when the tagged payments cover this participant's share. */
  settled: boolean
}

/**
 * An Expense folded from the whole book: its payer and shares, and per
 * participant what tagged Settlements have covered of what they owe.
 */
export interface ExpenseState {
  expenseEntryId: string
  entry: EntryEnvelope
  amountPaise: number
  payerDeviceId: string
  participantDeviceIds: string[]
  /** Every participant's equal share, computed from the amount (ADR-0008). */
  shares: ExpenseShare[]
  /** One line per participant who owes the payer, in the shares' device-id order. */
  coverage: ExpenseCoverage[]
  /** What the participants who owe the payer owe together. */
  owedPaise: number
  /** The covered part of what they owe, never above owedPaise. */
  coveredPaise: number
  /** True when every participant who owes the payer is covered. */
  settled: boolean
  /**
   * When the Expense became Settled, on the Entry clocks: the first contributing
   * Settlement after which every share was covered, or the Expense's own
   * `occurredAt` when it owed nothing from the start. Absent while it is open.
   * The archive deadline reads this; it is computed, never stored (ADR-0005).
   */
  settledAt?: string
}

/**
 * When an Expense became Settled: the crossing point of its coverage, read from
 * the Entry clocks. Coverage only grows as tagged Settlements are appended, so
 * the instant it settled is the `occurredAt` of the first contributing
 * Settlement after which every participant who owes the payer is covered —
 * every earlier Settlement was already there, and no later one can take it
 * back. An Expense that owed nothing (the payer was its only participant) was
 * Settled from its own `occurredAt`, and an Expense is never Settled before it
 * existed, however the clocks read. Ties break on Entry id so every device
 * picks the same instant.
 */
function expenseSettledAt(entry: EntryEnvelope, coverage: ExpenseCoverage[]): string | undefined {
  if (coverage.length === 0) {
    return entry.occurredAt
  }

  const contributing = coverage
    .flatMap((line) => line.settlements)
    .sort(
      (left, right) =>
        compareText(left.entry.occurredAt, right.entry.occurredAt) ||
        compareText(left.settlementEntryId, right.settlementEntryId),
    )
  const paidByDevice = new Map<string, number>()

  for (const settlement of contributing) {
    paidByDevice.set(
      settlement.fromDeviceId,
      addSaturating(paidByDevice.get(settlement.fromDeviceId) ?? 0, settlement.amountPaise),
    )

    const everyShareCovered = coverage.every(
      (line) => (paidByDevice.get(line.deviceId) ?? 0) >= line.sharePaise,
    )

    if (everyShareCovered) {
      return laterText(entry.occurredAt, settlement.entry.occurredAt)
    }
  }

  return undefined
}

/**
 * Folds the book's Expense Entries with the Settlements tagged to them into
 * item states (ADR-0004, ADR-0016): each participant's share is their equal
 * split, a live Settlement tagged to the Expense and paid by that participant
 * to the payer covers up to their share, and the Expense reads Settled once
 * every participant who owes the payer is covered. The payer's own share needs
 * no coverage. Untagged Settlements, and Settlements tagged to something else
 * or paid in the other direction, never change coverage; a claim covers from
 * the moment it is appended, exactly as it counts toward the Balance
 * (ADR-0007); Voiding a tagged Settlement reopens what it had covered, and a
 * Voided Expense drops out with them (ADR-0005). A participant who overpays is
 * covered, not credited: coverage is clamped at the share. A Settled Expense
 * also carries the instant it settled, so the archive deadline is computed
 * rather than stored (ADR-0005). The result is a pure function of the Entries —
 * the same book folds the same coverage in any order, on any clock — and
 * Entries this version cannot read are ignored rather than misread. Tagged
 * payments are summed with saturation, so an absurd pile of crafted claims
 * stays inside exact integer arithmetic instead of folding a number no
 * formatter can read (#21).
 */
export function foldExpenses(entries: EntryEnvelope[]): ExpenseState[] {
  const voidedByTarget = foldVoids(entries)
  const taggedSettlements = new Map<string, SettlementState[]>()

  for (const settlement of foldSettlements(entries)) {
    if (settlement.tag?.kind !== 'expense') {
      continue
    }

    const tagged = taggedSettlements.get(settlement.tag.entryId) ?? []

    tagged.push(settlement)
    taggedSettlements.set(settlement.tag.entryId, tagged)
  }

  const expenses: ExpenseState[] = []

  for (const entry of entries) {
    if (entry.type !== EXPENSE_ENTRY_TYPE || voidedByTarget.has(entry.id)) {
      continue
    }

    const payload = expenseEntryPayloadSchema.safeParse(entry.payload)

    if (!payload.success) {
      continue
    }

    const { amountPaise, payerDeviceId, participantDeviceIds } = payload.data
    const shares = splitExpense(amountPaise, participantDeviceIds)
    const coverage = shares
      .filter((share) => share.deviceId !== payerDeviceId)
      .map((share): ExpenseCoverage => {
        const settlements = (taggedSettlements.get(entry.id) ?? []).filter(
          (settlement) =>
            settlement.fromDeviceId === share.deviceId && settlement.toDeviceId === payerDeviceId,
        )
        const paidPaise = settlements.reduce(
          (total, settlement) => addSaturating(total, settlement.amountPaise),
          0,
        )
        const coveredPaise = Math.min(paidPaise, share.amountPaise)

        return {
          deviceId: share.deviceId,
          sharePaise: share.amountPaise,
          settlements,
          paidPaise,
          coveredPaise,
          settled: coveredPaise >= share.amountPaise,
        }
      })
    const owedPaise = coverage.reduce((total, line) => total + line.sharePaise, 0)
    const coveredPaise = coverage.reduce((total, line) => total + line.coveredPaise, 0)
    const settled = coveredPaise >= owedPaise
    const settledAt = settled ? expenseSettledAt(entry, coverage) : undefined

    expenses.push({
      expenseEntryId: entry.id,
      entry,
      amountPaise,
      payerDeviceId,
      participantDeviceIds,
      shares,
      coverage,
      owedPaise,
      coveredPaise,
      settled,
      ...(settledAt === undefined ? {} : { settledAt }),
    })
  }

  return expenses.sort((left, right) => compareText(left.expenseEntryId, right.expenseEntryId))
}
