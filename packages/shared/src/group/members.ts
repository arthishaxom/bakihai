import { z } from 'zod'
import { compareText } from '../compare'
import { ENTRY_SCHEMA_VERSION, type EntryEnvelope, signEntryEnvelope } from '../entry-envelope'
import { uuidv7 } from '../uuidv7'

/** Entry type that records a Member joining the Group. */
export const MEMBER_ENTRY_TYPE = 'member'

/** Longest display name the app accepts for a Member. */
export const MEMBER_DISPLAY_NAME_MAX_LENGTH = 40

/**
 * The payload of a Member Entry: who this device says it is. The device id and
 * device key live in the envelope around it, where the Member's signature
 * covers them.
 */
export const memberEntryPayloadSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(MEMBER_DISPLAY_NAME_MAX_LENGTH),
})

export type MemberEntryPayload = z.infer<typeof memberEntryPayloadSchema>

/** A person in the Group, folded from the book's Member Entries. */
export interface Member {
  deviceId: string
  displayName: string
  signerPublicKey: string
  /** When the Member's latest Entry was written, on their device clock. */
  joinedAt: string
}

/** What a device needs to write its own Member Entry. */
export interface CreateMemberEntryInput {
  deviceId: string
  signerPublicKey: string
  privateKey: CryptoKey
  displayName: string
  /** Device clock; display ordering only. Defaults to now. */
  occurredAt?: string
}

/**
 * Writes this device's Member Entry: a signed record of joining the Group.
 * Membership is append-only like any other Entry, so nobody can quietly
 * rewrite whose key belongs to whom (#5, #8).
 */
export async function createMemberEntry(input: CreateMemberEntryInput): Promise<EntryEnvelope> {
  const payload = memberEntryPayloadSchema.parse({ displayName: input.displayName })

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: input.deviceId,
      signerPublicKey: input.signerPublicKey,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      type: MEMBER_ENTRY_TYPE,
      payload,
    },
    input.privateKey,
  )
}

interface FoldedMember extends Member {
  entryId: string
}

function compareEntries(left: FoldedMember, right: FoldedMember): number {
  return compareText(left.joinedAt, right.joinedAt) || compareText(left.entryId, right.entryId)
}

/**
 * Folds the book's Member Entries into the Group roster, one entry per device:
 * the roster is a pure function of the Entries, so every device that holds the
 * same book shows the same Members (ADR-0001). A device that wrote more than
 * once (a rejoin) counts by its latest Entry, and Entries whose payload this
 * app version cannot read are ignored rather than misread.
 */
export function foldMembers(entries: EntryEnvelope[]): Member[] {
  const latestByDevice = new Map<string, FoldedMember>()

  for (const entry of entries) {
    if (entry.type !== MEMBER_ENTRY_TYPE) {
      continue
    }

    const payload = memberEntryPayloadSchema.safeParse(entry.payload)

    if (!payload.success) {
      continue
    }

    const candidate: FoldedMember = {
      deviceId: entry.authorDeviceId,
      displayName: payload.data.displayName,
      signerPublicKey: entry.signerPublicKey,
      joinedAt: entry.occurredAt,
      entryId: entry.id,
    }
    const existing = latestByDevice.get(entry.authorDeviceId)

    if (!existing || compareEntries(existing, candidate) < 0) {
      latestByDevice.set(entry.authorDeviceId, candidate)
    }
  }

  return [...latestByDevice.values()]
    .sort(
      (left, right) =>
        compareText(left.joinedAt, right.joinedAt) || compareText(left.deviceId, right.deviceId),
    )
    .map((folded) => ({
      deviceId: folded.deviceId,
      displayName: folded.displayName,
      signerPublicKey: folded.signerPublicKey,
      joinedAt: folded.joinedAt,
    }))
}
