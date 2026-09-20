import { describe, expect, it } from 'vitest'
import { type EntryEnvelope, verifyEntryEnvelope } from '../src/entry-envelope'
import {
  createMemberEntry,
  foldMemberKeys,
  foldMembers,
  MEMBER_DISPLAY_NAME_MAX_LENGTH,
  MEMBER_ENTRY_TYPE,
  type Member,
} from '../src/group/members'
import { makeDevice, makeEntry, makeMemberEntry, type TestDevice } from './helpers/entries'

const JOINED_AT = '2026-09-20T10:00:00.000Z'
const LATER = '2026-09-21T10:00:00.000Z'

function memberOf(device: TestDevice, displayName: string, joinedAt = JOINED_AT): Member {
  return {
    deviceId: device.deviceId,
    displayName,
    signerPublicKey: device.signerPublicKey,
    joinedAt,
  }
}

describe('Member Entries', () => {
  it('creates a signed Member Entry that verifies', async () => {
    const device = await makeDevice()
    const entry = await createMemberEntry({
      deviceId: device.deviceId,
      signerPublicKey: device.signerPublicKey,
      privateKey: device.keyPair.privateKey,
      displayName: '  Rohan  ',
      occurredAt: JOINED_AT,
    })

    expect(entry.type).toBe(MEMBER_ENTRY_TYPE)
    expect(entry.authorDeviceId).toBe(device.deviceId)
    expect(entry.signerPublicKey).toBe(device.signerPublicKey)
    expect(entry.occurredAt).toBe(JOINED_AT)
    expect(entry.payload).toEqual({ displayName: 'Rohan' })
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('refuses an empty or oversized display name', async () => {
    const device = await makeDevice()
    const draft = (displayName: string) =>
      createMemberEntry({
        deviceId: device.deviceId,
        signerPublicKey: device.signerPublicKey,
        privateKey: device.keyPair.privateKey,
        displayName,
      })

    await expect(draft('   ')).rejects.toThrow()
    await expect(draft('x'.repeat(MEMBER_DISPLAY_NAME_MAX_LENGTH + 1))).rejects.toThrow()
  })
})

describe('foldMembers', () => {
  it('folds Member Entries into the Group roster', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeMemberEntry(mira, 'Mira', LATER),
      await makeMemberEntry(rohan, 'Rohan', JOINED_AT),
    ]

    expect(foldMembers(entries)).toEqual([
      memberOf(rohan, 'Rohan', JOINED_AT),
      memberOf(mira, 'Mira', LATER),
    ])
  })

  it('yields the same roster whatever order the Entries arrive in', async () => {
    const devices = await Promise.all([makeDevice(), makeDevice(), makeDevice()])
    const entries = await Promise.all([
      makeMemberEntry(devices[0] as TestDevice, 'Rohan', JOINED_AT),
      makeMemberEntry(devices[1] as TestDevice, 'Mira', LATER),
      makeMemberEntry(devices[2] as TestDevice, 'Dev', '2026-09-22T10:00:00.000Z'),
    ])
    const expected = foldMembers(entries)

    expect(foldMembers([...entries].reverse())).toEqual(expected)
    expect(
      foldMembers([
        entries[1] as EntryEnvelope,
        entries[2] as EntryEnvelope,
        entries[0] as EntryEnvelope,
      ]),
    ).toEqual(expected)
  })

  it('ignores Entries that are not Members and member payloads it cannot read', async () => {
    const device = await makeDevice()
    const entries = [
      await makeEntry('dinner', { type: 'expense', payload: { amountPaise: 90_000 } }),
      await makeEntry('odd member', { type: MEMBER_ENTRY_TYPE, payload: { displayName: '' } }),
      await makeEntry('extra field', {
        type: MEMBER_ENTRY_TYPE,
        payload: { displayName: 'Rohan', extra: true },
      }),
      await makeMemberEntry(device, 'Mira'),
    ]

    expect(foldMembers(entries)).toEqual([memberOf(device, 'Mira')])
  })

  it('keeps one Member per device, latest Entry winning', async () => {
    const device = await makeDevice()

    expect(
      foldMembers([
        await makeMemberEntry(device, 'Old', JOINED_AT),
        await makeMemberEntry(device, 'New', LATER),
      ]),
    ).toEqual([memberOf(device, 'New', LATER)])
  })

  it('ignores a later claim on a bound device id under another key', async () => {
    const rohan = await makeDevice()
    const mallory = await makeDevice()
    const joined = await makeMemberEntry(rohan, 'Rohan')
    const claim = await makeMemberEntry(
      { ...mallory, deviceId: rohan.deviceId },
      'Not Rohan',
      LATER,
    )

    expect(foldMembers([joined, claim])).toEqual([memberOf(rohan, 'Rohan')])
    expect(foldMembers([claim, joined])).toEqual([memberOf(rohan, 'Rohan')])
    expect(foldMemberKeys([joined, claim])).toEqual(
      new Map([[rohan.deviceId, rohan.signerPublicKey]]),
    )
  })

  it('ignores a backdated claim on a bound device id', async () => {
    const mira = await makeDevice()
    const mallory = await makeDevice()
    const joined = await makeMemberEntry(mira, 'Mira')
    // The claim is minted after Mira's Entry but claims to predate it, so only
    // a fold that trusts the device clock would let it win.
    const backdated = await makeMemberEntry(
      { ...mallory, deviceId: mira.deviceId },
      'Not Mira',
      '1970-01-01T00:00:00.000Z',
    )

    expect(foldMembers([backdated, joined])).toEqual([memberOf(mira, 'Mira')])
    expect(foldMemberKeys([backdated, joined])).toEqual(
      new Map([[mira.deviceId, mira.signerPublicKey]]),
    )
  })

  it('is empty for a book with no Member Entries', async () => {
    expect(foldMembers([])).toEqual([])
    expect(foldMembers([await makeEntry('dinner')])).toEqual([])
  })
})
