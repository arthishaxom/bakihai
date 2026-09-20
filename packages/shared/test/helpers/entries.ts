import { exportSigningPublicKey, generateSigningKeyPair } from '../../src/crypto/ed25519'
import {
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
} from '../../src/entry-envelope'
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
