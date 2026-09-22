import { describe, expect, it } from 'vitest'
import {
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
} from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import { foldBalances } from '../src/group/balances'
import { foldMembers, foldShadowHolders } from '../src/group/members'
import { uuidv7 } from '../src/uuidv7'
import { makeDevice, makeExpenseEntry, makeMemberEntry, type TestDevice } from './helpers/entries'

const JOINED_AT = '2026-09-20T10:00:00.000Z'

/** Signs an Entry as `device`, claiming whichever author the caller passes. */
function entrySignedBy(
  device: TestDevice,
  authorDeviceId: string,
  type: string,
  payload: UnsignedEntryEnvelope['payload'],
  occurredAt = JOINED_AT,
): Promise<EntryEnvelope> {
  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId,
      signerPublicKey: device.signerPublicKey,
      occurredAt,
      type,
      payload,
    },
    device.keyPair.privateKey,
  )
}

describe('admitEntries', () => {
  it('admits Member Entries and Entries from devices bound to their key', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [mira.deviceId],
      }),
      await entrySignedBy(rohan, rohan.deviceId, 'mystery', { note: 'ignored by this version' }),
    ]

    expect(admitEntries(entries)).toEqual(entries)
  })

  it('drops Entries from a device that never joined the Group', async () => {
    const rohan = await makeDevice()
    const stranger = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeExpenseEntry(stranger, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId],
      }),
    ]

    expect(admitEntries(entries)).toEqual([entries[0]])
    expect(foldBalances(admitEntries(entries))).toEqual([])
  })

  it('drops an Entry that writes as a Member under another key', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const mallory = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      // Mallory signs an Expense claiming to be Mira's, charging Rohan.
      await entrySignedBy(mallory, mira.deviceId, 'expense', {
        amountPaise: 90_000,
        payerDeviceId: mira.deviceId,
        participantDeviceIds: [rohan.deviceId],
      }),
    ]

    expect(admitEntries(entries)).toEqual(entries.slice(0, 2))
    expect(foldBalances(admitEntries(entries))).toEqual([])
  })

  it('drops a Member Entry that tries to rebind another device id', async () => {
    const rohan = await makeDevice()
    const mallory = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      // A later claim on Rohan's device id, signed by Mallory's key.
      await makeMemberEntry({ ...mallory, deviceId: rohan.deviceId }, 'Not Rohan'),
    ]

    expect(admitEntries(entries)).toEqual([entries[0]])
    expect(foldMembers(entries)).toEqual([
      {
        deviceId: rohan.deviceId,
        displayName: 'Rohan',
        signerPublicKey: rohan.signerPublicKey,
        joinedAt: JOINED_AT,
      },
    ])
  })

  it('admits the same Entries whatever order they arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await makeExpenseEntry(mira, { amountPaise: 3000, participantDeviceIds: [rohan.deviceId] }),
      await makeExpenseEntry(rohan, { amountPaise: 90_000, participantDeviceIds: [mira.deviceId] }),
    ]
    const expected = admitEntries(entries)

    const idsOf = (admitted: EntryEnvelope[]) =>
      admitted.map((entry) => entry.id).sort((left, right) => left.localeCompare(right))

    expect(idsOf(admitEntries([...entries].reverse()))).toEqual(idsOf(expected))
    expect(
      idsOf(admitEntries([entries[2], entries[0], entries[3], entries[1]] as EntryEnvelope[])),
    ).toEqual(idsOf(expected))
  })

  it('is unmoved by Entries that claim an absurd clock', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const mallory = await makeDevice()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan', '2026-09-20T10:00:00.000Z'),
      await makeMemberEntry(mira, 'Mira', '2026-09-20T10:00:00.000Z'),
      // Mallory backdates their claim on Mira's device id to before she ever
      // joined; the binding still follows Entry ids, not the claimed clock.
      await makeMemberEntry(
        { ...mallory, deviceId: mira.deviceId },
        'Not Mira',
        '1970-01-01T00:00:00.000Z',
      ),
      await entrySignedBy(mallory, mira.deviceId, 'expense', {
        amountPaise: 90_000,
        payerDeviceId: mira.deviceId,
        participantDeviceIds: [rohan.deviceId],
      }),
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId],
        occurredAt: '2999-12-31T23:59:59.000Z',
      }),
    ]
    const admitted = admitEntries(entries)

    expect(admitted).toEqual([entries[0], entries[1], entries[4]])
    expect(
      foldMembers(admitted)
        .map((member) => member.displayName)
        .sort(),
    ).toEqual(['Mira', 'Rohan'])
    expect(foldBalances(admitted)).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 45_000 },
    ])
  })

  it('admits nothing from a book with no readable Member Entries', async () => {
    const rohan = await makeDevice()
    const expense = await makeExpenseEntry(rohan, {
      amountPaise: 5000,
      participantDeviceIds: [rohan.deviceId],
    })

    expect(admitEntries([expense])).toEqual([])
  })

  it('admits the Member Entry a device signs for a person with no phone', async () => {
    const rohan = await makeDevice()
    const rohitId = uuidv7()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
    ]

    expect(admitEntries(entries)).toEqual(entries)
    expect(foldShadowHolders(admitEntries(entries))).toEqual(new Map([[rohitId, rohan.deviceId]]))
  })

  it('drops an Entry written as a person with no phone under the wrong key', async () => {
    const rohan = await makeDevice()
    const mallory = await makeDevice()
    const rohitId = uuidv7()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
      // Mallory signs an Expense claiming to be Rohan's person with no phone.
      await entrySignedBy(mallory, rohitId, 'expense', {
        amountPaise: 90_000,
        payerDeviceId: rohitId,
        participantDeviceIds: [rohan.deviceId],
      }),
    ]

    expect(admitEntries(entries)).toEqual(entries.slice(0, 2))
  })

  it('drops a Member Entry that tries to rebind a person with no phone', async () => {
    const rohan = await makeDevice()
    const mallory = await makeDevice()
    const rohitId = uuidv7()
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
      await makeMemberEntry(
        { ...mallory, deviceId: rohitId },
        'Not Rohit',
        '2026-09-21T10:00:00.000Z',
      ),
    ]

    expect(admitEntries(entries)).toEqual(entries.slice(0, 2))
    expect(
      foldMembers(admitEntries(entries))
        .map((member) => member.displayName)
        .sort(),
    ).toEqual(['Rohan', 'Rohit'])
  })

  it('drops an Entry written for a device id no readable Member Entry bound', async () => {
    const rohan = await makeDevice()
    const unboundId = uuidv7()
    // A Member can write as a device id they hold, but this id has no claim at
    // all; writing under it is writing as a person the Group does not hold.
    const writtenAsUnbound = await entrySignedBy(rohan, unboundId, 'expense', {
      amountPaise: 90_000,
      payerDeviceId: unboundId,
      participantDeviceIds: [rohan.deviceId],
    })
    // A claim this version cannot read binds nothing either, so the Entry it
    // names has no key to write under.
    const unreadableClaim = await entrySignedBy(rohan, unboundId, 'member', {
      displayName: 'x'.repeat(100),
    })
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      unreadableClaim,
      writtenAsUnbound,
      await entrySignedBy(rohan, unboundId, 'expense', {
        amountPaise: 100,
        payerDeviceId: unboundId,
        participantDeviceIds: [rohan.deviceId],
      }),
    ]

    expect(admitEntries(entries)).toEqual([entries[0]])
    expect(foldBalances(admitEntries(entries))).toEqual([])
  })

  it('drops everything a forger writes as a Shadow Member they tried to rebind', async () => {
    const rohan = await makeDevice()
    const mallory = await makeDevice()
    const rohitId = uuidv7()
    // Both Expenses name the same pair, so only the holder's arithmetic shows.
    const asRohit = (amountPaise: number) => ({
      amountPaise,
      payerDeviceId: rohitId,
      participantDeviceIds: [rohan.deviceId],
    })
    const entries = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
      // Mallory claims Rohit's id under their own key, then writes as Rohit
      // with that same key. The binding pass drops the claim, so the write is
      // a stranger's Entry like any other.
      await makeMemberEntry({ ...mallory, deviceId: rohitId }, 'Not Rohit', JOINED_AT),
      await entrySignedBy(mallory, rohitId, 'expense', asRohit(999_900)),
      // The holder's key is what the id is bound to, so an Entry it writes as
      // the shadow is admitted, exactly as the id's own key would be.
      await entrySignedBy(rohan, rohitId, 'expense', asRohit(90_000)),
    ]
    const admitted = admitEntries(entries)
    const idsOf = (admittedEntries: EntryEnvelope[]) =>
      admittedEntries.map((entry) => entry.id).sort((left, right) => left.localeCompare(right))

    expect(admitted).toEqual([entries[0], entries[1], entries[4]])
    expect(idsOf(admitEntries([...entries].reverse()))).toEqual(idsOf(admitted))
    expect(foldBalances(admitted)).toEqual([
      { debtorDeviceId: rohan.deviceId, creditorDeviceId: rohitId, amountPaise: 90_000 },
    ])
  })
})
