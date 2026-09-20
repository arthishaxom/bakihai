import { exportSigningPublicKey, generateSigningKeyPair } from '../../src/crypto/ed25519'
import {
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
} from '../../src/entry-envelope'
import { type CreateExpenseEntryInput, createExpenseEntry } from '../../src/group/expenses'
import { MEMBER_ENTRY_TYPE, memberEntryPayloadSchema } from '../../src/group/members'
import { uuidv7 } from '../../src/uuidv7'

/** Builds a real signed Entry for tests, with optional field overrides. */
export async function makeEntry(
  note: string,
  overrides: Partial<UnsignedEntryEnvelope> = {},
): Promise<EntryEnvelope> {
  const pair = await generateSigningKeyPair()

  return signEntryEnvelope(
    {
      id: uuidv7(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: uuidv7(),
      signerPublicKey: await exportSigningPublicKey(pair.publicKey),
      occurredAt: '2026-09-20T10:00:00.000Z',
      type: 'expense',
      payload: { note },
      ...overrides,
    },
    pair.privateKey,
  )
}

/** A test Member's device identity, with real keys so Entries verify. */
export interface TestDevice {
  deviceId: string
  signerPublicKey: string
  keyPair: CryptoKeyPair
}

/** Builds a device with a fresh id and signing key pair. */
export async function makeDevice(): Promise<TestDevice> {
  const keyPair = await generateSigningKeyPair()

  return {
    keyPair,
    deviceId: uuidv7(),
    signerPublicKey: await exportSigningPublicKey(keyPair.publicKey),
  }
}

/** Writes an Expense Entry as `device`, defaulting the payer to the device itself. */
export function makeExpenseEntry(
  device: TestDevice,
  payload: Omit<
    CreateExpenseEntryInput,
    'deviceId' | 'signerPublicKey' | 'privateKey' | 'payerDeviceId'
  > & {
    payerDeviceId?: string
  },
): Promise<EntryEnvelope> {
  return createExpenseEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    payerDeviceId: device.deviceId,
    ...payload,
  })
}

let entryClock = 0

/** A fresh Entry id that sorts after every id this helper has minted before. */
function nextEntryId(): string {
  entryClock += 1

  return uuidv7(entryClock)
}

/**
 * Builds a signed Member Entry as `device`. Ids increase with each call, so
 * tests that settle competing claims get a deterministic binding order without
 * waiting on the wall clock.
 */
export function makeMemberEntry(
  device: TestDevice,
  displayName: string,
  occurredAt = '2026-09-20T10:00:00.000Z',
): Promise<EntryEnvelope> {
  return signEntryEnvelope(
    {
      id: nextEntryId(),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: device.deviceId,
      signerPublicKey: device.signerPublicKey,
      occurredAt,
      type: MEMBER_ENTRY_TYPE,
      payload: memberEntryPayloadSchema.parse({ displayName }),
    },
    device.keyPair.privateKey,
  )
}
