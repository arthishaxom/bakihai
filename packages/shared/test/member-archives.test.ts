import { describe, expect, it } from 'vitest'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import { foldBalances } from '../src/group/balances'
import {
  createMemberArchivedEntry,
  foldMemberArchives,
  MEMBER_ARCHIVED_ENTRY_TYPE,
  memberArchivedEntryPayloadSchema,
  readMemberArchivedPayload,
} from '../src/group/member-archives'
import { foldMemberKeys, foldMembers } from '../src/group/members'
import { canVoidEntry, createVoidEntry, foldVoids } from '../src/group/voids'
import {
  makeDevice,
  makeEntry,
  makeExpenseEntry,
  makeMemberEntry,
  type TestDevice,
} from './helpers/entries'

const ARCHIVED_AT = '2026-09-21T10:00:00.000Z'
const LATER = '2026-09-22T10:00:00.000Z'

/** Writes an archive marker as `device`, naming the Member whose phone is gone. */
function archive(device: TestDevice, memberDeviceId: string, occurredAt = ARCHIVED_AT) {
  return createMemberArchivedEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    memberDeviceId,
    occurredAt,
  })
}

/** Writes a Void of `targetEntryId` as `device`. */
function voidEntry(device: TestDevice, targetEntryId: string) {
  return createVoidEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    targetEntryId,
  })
}

describe('createMemberArchivedEntry', () => {
  it('writes a signed marker naming the Member whose device is gone', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const marker = await archive(rohan, mira.deviceId)

    expect(marker.type).toBe(MEMBER_ARCHIVED_ENTRY_TYPE)
    expect(marker.authorDeviceId).toBe(rohan.deviceId)
    expect(marker.occurredAt).toBe(ARCHIVED_AT)
    expect(readMemberArchivedPayload(marker)).toEqual({ memberDeviceId: mira.deviceId })
    await expect(verifyEntryEnvelope(marker)).resolves.toEqual(marker)
  })

  it('refuses a marker that names no Member', () => {
    expect(() => memberArchivedEntryPayloadSchema.parse({ memberDeviceId: '' })).toThrow()
    expect(() => memberArchivedEntryPayloadSchema.parse({})).toThrow()
  })

  it('is Voidable, which is how an archive is undone', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const marker = await archive(rohan, mira.deviceId)

    expect(canVoidEntry(marker)).toBe(true)
  })
})

describe('foldMemberArchives', () => {
  it('folds a marker written by any Member onto the Member it names', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const marker = await archive(mira, rohan.deviceId)

    const archives = foldMemberArchives([await makeMemberEntry(rohan, 'Rohan'), marker])

    expect([...archives.keys()]).toEqual([rohan.deviceId])
    expect(archives.get(rohan.deviceId)).toBe(marker)
  })

  it('drops a Voided marker, restoring the Member to the active list', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const marker = await archive(rohan, mira.deviceId)
    const undo = await voidEntry(mira, marker.id)

    expect(foldVoids([marker, undo]).get(marker.id)).toBe(undo)
    expect(foldMemberArchives([marker, undo]).size).toBe(0)
  })

  it('picks one marker deterministically when two name the same Member', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const first = await archive(rohan, mira.deviceId)
    const second = await archive(kabir, mira.deviceId)

    const archives = foldMemberArchives([first, second])
    const reversed = foldMemberArchives([second, first])
    const chosen = archives.get(mira.deviceId)

    expect([first, second]).toContain(chosen)
    expect(chosen).toBe(reversed.get(mira.deviceId))
  })

  it('ignores markers it cannot read and Entries that are not markers', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const legacy = await makeEntry('legacy archive', {
      type: MEMBER_ARCHIVED_ENTRY_TYPE,
      payload: { deviceId: mira.deviceId },
    })
    const extra = await makeEntry('extra field', {
      type: MEMBER_ARCHIVED_ENTRY_TYPE,
      payload: { memberDeviceId: mira.deviceId, extra: true },
    })
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })

    expect(foldMemberArchives([legacy, extra, dinner]).size).toBe(0)
  })

  it('yields the same archives whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await archive(rohan, mira.deviceId),
    ]
    const expected = foldMemberArchives(entries)

    expect(foldMemberArchives([...entries].reverse())).toEqual(expected)
  })

  it('is empty for a book with no markers', async () => {
    const rohan = await makeDevice()

    expect(foldMemberArchives([await makeMemberEntry(rohan, 'Rohan')]).size).toBe(0)
  })
})

describe('Archived Members and the rest of the book', () => {
  it('keeps the archived Member in the roster, with their Entries and Balances untouched', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const marker = await archive(rohan, mira.deviceId)

    expect(foldMembers([...roster, marker])).toEqual(foldMembers(roster))
    expect(foldMemberKeys([...roster, marker])).toEqual(foldMemberKeys(roster))
    expect(foldBalances([dinner, marker])).toEqual(foldBalances([dinner]))
    expect(foldBalances([dinner, marker])).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 90_000 },
    ])
  })

  it('stays frozen through a rejoin, and a Member Entry can never be Voided', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const rejoined = await makeDevice()
    const miraEntry = await makeMemberEntry(mira, 'Mira')
    const rejoinedEntry = await makeMemberEntry(rejoined, 'Mira', LATER)
    const marker = await archive(rohan, mira.deviceId)
    // A Void aimed at the old Member Entry must change nothing: the binding is
    // the device's first Member Entry, and unfreezing it would allow a takeover.
    const attack = await voidEntry(rohan, miraEntry.id)

    expect(foldVoids([miraEntry, attack]).size).toBe(0)
    expect(
      foldMembers([miraEntry, rejoinedEntry, marker]).map((member) => member.deviceId),
    ).toEqual([mira.deviceId, rejoined.deviceId])
    expect(foldMemberKeys([miraEntry, rejoinedEntry])).toEqual(
      new Map([
        [mira.deviceId, mira.signerPublicKey],
        [rejoined.deviceId, rejoined.signerPublicKey],
      ]),
    )
    expect([...foldMemberArchives([miraEntry, rejoinedEntry, marker]).keys()]).toEqual([
      mira.deviceId,
    ])
  })

  it('rides the roster-bound admission path like any Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const stranger = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const marker = await archive(rohan, mira.deviceId)
    const forged = await archive(stranger, mira.deviceId)

    const admitted = admitEntries([...roster, marker, forged])

    expect(admitted).toContain(marker)
    expect(admitted).not.toContain(forged)
    expect(foldMemberArchives(admitted).get(mira.deviceId)).toBe(marker)
  })
})
