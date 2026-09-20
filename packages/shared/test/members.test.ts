import { describe, expect, it } from 'vitest'
import { exportSigningPublicKey, generateSigningKeyPair } from '../src/crypto/ed25519'
import { type EntryEnvelope, verifyEntryEnvelope } from '../src/entry-envelope'
import {
  createMemberEntry,
  foldMembers,
  MEMBER_DISPLAY_NAME_MAX_LENGTH,
  MEMBER_ENTRY_TYPE,
  type Member,
} from '../src/group/members'
import { uuidv7 } from '../src/uuidv7'
import { makeEntry } from './helpers/entries'

const JOINED_AT = '2026-09-20T10:00:00.000Z'
const LATER = '2026-09-21T10:00:00.000Z'

interface TestDevice {
  deviceId: string
  signerPublicKey: string
  pair: CryptoKeyPair
}

async function makeDevice(): Promise<TestDevice> {
  const pair = await generateSigningKeyPair()

  return {
    pair,
    deviceId: uuidv7(),
    signerPublicKey: await exportSigningPublicKey(pair.publicKey),
  }
}

function memberEntry(
  device: TestDevice,
  displayName: string,
  occurredAt = JOINED_AT,
): Promise<EntryEnvelope> {
  return createMemberEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.pair.privateKey,
    displayName,
    occurredAt,
  })
}

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
    const entry = await memberEntry(device, '  Rohan  ')

    expect(entry.type).toBe(MEMBER_ENTRY_TYPE)
    expect(entry.authorDeviceId).toBe(device.deviceId)
    expect(entry.signerPublicKey).toBe(device.signerPublicKey)
    expect(entry.occurredAt).toBe(JOINED_AT)
    expect(entry.payload).toEqual({ displayName: 'Rohan' })
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('refuses an empty or oversized display name', async () => {
    const device = await makeDevice()

    await expect(memberEntry(device, '   ')).rejects.toThrow()
    await expect(
      memberEntry(device, 'x'.repeat(MEMBER_DISPLAY_NAME_MAX_LENGTH + 1)),
    ).rejects.toThrow()
  })
})

describe('foldMembers', () => {
  it('folds Member Entries into the Group roster', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await memberEntry(mira, 'Mira', LATER),
      await memberEntry(rohan, 'Rohan', JOINED_AT),
    ]

    expect(foldMembers(entries)).toEqual([
      memberOf(rohan, 'Rohan', JOINED_AT),
      memberOf(mira, 'Mira', LATER),
    ])
  })

  it('yields the same roster whatever order the Entries arrive in', async () => {
    const devices = await Promise.all([makeDevice(), makeDevice(), makeDevice()])
    const entries = await Promise.all([
      memberEntry(devices[0] as TestDevice, 'Rohan', JOINED_AT),
      memberEntry(devices[1] as TestDevice, 'Mira', LATER),
      memberEntry(devices[2] as TestDevice, 'Dev', '2026-09-22T10:00:00.000Z'),
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
      await memberEntry(device, 'Mira'),
    ]

    expect(foldMembers(entries)).toEqual([memberOf(device, 'Mira')])
  })

  it('keeps one Member per device, latest Entry winning', async () => {
    const device = await makeDevice()

    expect(
      foldMembers([
        await memberEntry(device, 'Old', JOINED_AT),
        await memberEntry(device, 'New', LATER),
      ]),
    ).toEqual([memberOf(device, 'New', LATER)])
  })

  it('is empty for a book with no Member Entries', async () => {
    expect(foldMembers([])).toEqual([])
    expect(foldMembers([await makeEntry('dinner')])).toEqual([])
  })
})
