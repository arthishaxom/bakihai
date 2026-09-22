import { z } from 'zod'
import { compareText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'
import { foldVoids } from './voids'

/**
 * Entry type that records a Member as Archived: their phone is gone, wiped or
 * lost, so the Group stops offering them in pickers. Any Member may write one,
 * and it names the Member's device id rather than one of their Member Entries,
 * so a rename never slips out from under the marker. It changes visibility
 * only: the Member's Entries, history, and Balances stay exactly as they are,
 * and their device-key binding stays frozen (ADR-0014).
 */
export const MEMBER_ARCHIVED_ENTRY_TYPE = 'member-archived'

/**
 * The payload of a Member-archive Entry: the device id of the Member whose
 * phone is gone. It is a device id like every other reference to a Member in
 * the book, never an Entry id, so archiving is about the identity, not about
 * one of its claims.
 */
export const memberArchivedEntryPayloadSchema = z.strictObject({
  memberDeviceId: z.string().min(1),
})

export type MemberArchivedEntryPayload = z.infer<typeof memberArchivedEntryPayloadSchema>

/**
 * Reads a Member-archive payload, or undefined when the Entry is not one or its
 * payload is not one this app version understands.
 */
export function readMemberArchivedPayload(
  entry: EntryEnvelope,
): MemberArchivedEntryPayload | undefined {
  if (entry.type !== MEMBER_ARCHIVED_ENTRY_TYPE) {
    return undefined
  }

  const parsed = memberArchivedEntryPayloadSchema.safeParse(entry.payload)

  return parsed.success ? parsed.data : undefined
}

/** What a device needs to write a Member-archive Entry. */
export interface CreateMemberArchivedEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  /** The device id of the Member being archived. */
  memberDeviceId: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes a Member-archive Entry: a signed record that a Member's phone is gone.
 * Any Member may write one (ADR-0014), so this writes what it is asked to and
 * never touches the Member Entry itself; the marker is Voidable if it was
 * written by mistake, which is how an archive is undone.
 */
export async function createMemberArchivedEntry(
  input: CreateMemberArchivedEntryInput,
): Promise<EntryEnvelope> {
  const payload = memberArchivedEntryPayloadSchema.parse({
    memberDeviceId: input.memberDeviceId,
  })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: MEMBER_ARCHIVED_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

/**
 * Folds the book's Member-archive Entries into the marker in force for each
 * Archived Member, keyed by their device id. A Voided marker drops out, which
 * is how a mistaken archive is undone and the Member restored to the active
 * list (ADR-0014). When two live markers name one Member, the earliest by Entry
 * id wins, so every device reports the same marker and a Void of it only
 * restores the Member once every marker is undone. A marker naming a device id
 * the roster does not hold is folded like any other: the fold is total, and the
 * screens simply have no Member to mark. The result is a pure function of the
 * Entries — the same book folds the same archives in any order — and Entries
 * this version cannot read are ignored rather than misread.
 */
export function foldMemberArchives(entries: EntryEnvelope[]): Map<string, EntryEnvelope> {
  const voidedByTarget = foldVoids(entries)
  const markers = entries
    .filter((entry) => entry.type === MEMBER_ARCHIVED_ENTRY_TYPE && !voidedByTarget.has(entry.id))
    .sort((left, right) => compareText(left.id, right.id))
  const byMemberDeviceId = new Map<string, EntryEnvelope>()

  for (const marker of markers) {
    const payload = readMemberArchivedPayload(marker)

    if (payload && !byMemberDeviceId.has(payload.memberDeviceId)) {
      byMemberDeviceId.set(payload.memberDeviceId, marker)
    }
  }

  return byMemberDeviceId
}
