import { z } from 'zod'
import { compareText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'
import { MEMBER_ENTRY_TYPE } from './members'

/** Entry type that records a Void: a correction of an earlier Entry, both lines staying in the book. */
export const VOID_ENTRY_TYPE = 'void'

/** Longest reason a Void may carry. */
export const VOID_REASON_MAX_LENGTH = 200

/**
 * The payload of a Void Entry: the Entry it Voided and an optional short
 * reason. A Void may target any Entry except a Member Entry (ADR-0014) or
 * another Void (#12); the fold ignores such a Void rather than misreading it.
 */
export const voidEntryPayloadSchema = z.strictObject({
  targetEntryId: z.uuidv7(),
  reason: z.string().trim().min(1).max(VOID_REASON_MAX_LENGTH).optional(),
})

export type VoidEntryPayload = z.infer<typeof voidEntryPayloadSchema>

/**
 * Whether an Entry may be a Void's target: any Entry except a Member Entry
 * (ADR-0014) and another Void (#12). The fold ignores a Void naming either,
 * and the book never offers a Void action for one.
 */
export function canVoidEntry(entry: EntryEnvelope): boolean {
  return entry.type !== MEMBER_ENTRY_TYPE && entry.type !== VOID_ENTRY_TYPE
}

/**
 * Reads a Void's payload, or undefined when the Entry is not a Void or its
 * payload is not one this app version understands.
 */
export function readVoidPayload(entry: EntryEnvelope): VoidEntryPayload | undefined {
  if (entry.type !== VOID_ENTRY_TYPE) {
    return undefined
  }

  const parsed = voidEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** What a device needs to write a Void Entry. */
export interface CreateVoidEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  targetEntryId: string
  /** Optional short reason, kept as written minus surrounding whitespace. */
  reason?: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Void Entry: a signed record that Voids an earlier
 * Entry. Any Member may Void any Entry, so this writes what it is asked to and
 * never touches the target — both lines stay in the book (ADR-0005).
 */
export async function createVoidEntry(input: CreateVoidEntryInput): Promise<EntryEnvelope> {
  const { targetEntryId, reason } = voidEntryPayloadSchema.parse({
    targetEntryId: input.targetEntryId,
    ...(input.reason?.trim() ? { reason: input.reason } : {}),
  })
  // A missing reason is left out of the JSON entirely rather than written as
  // undefined, which the canonical-JSON envelope cannot hold.
  const payload = reason === undefined ? { targetEntryId } : { targetEntryId, reason }

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: VOID_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/**
 * Folds the book's Void Entries into the Entries they Void, keyed by the
 * Voided Entry's id. A Void naming a Member Entry (ADR-0014) or another Void
 * (#12) is ignored, as is a Void naming an Entry this book does not hold.
 * When two Voids name one Entry, the earliest by Entry id wins, so every
 * device reports the same voider. The result is a pure function of the
 * Entries — the same book folds the same Voids in any order.
 */
export function foldVoids(entries: EntryEnvelope[]): Map<string, EntryEnvelope> {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const voids = entries
    .filter((entry) => entry.type === VOID_ENTRY_TYPE)
    .sort((left, right) => compareText(left.id, right.id))
  const voidedByTarget = new Map<string, EntryEnvelope>()

  for (const voidEntry of voids) {
    const payload = readVoidPayload(voidEntry)

    if (!payload) {
      continue
    }

    const target = byId.get(payload.targetEntryId)

    if (!target || !canVoidEntry(target)) {
      continue
    }

    if (!voidedByTarget.has(target.id)) {
      voidedByTarget.set(target.id, voidEntry)
    }
  }

  return voidedByTarget
}
