import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/bytes'
import { exportSigningPublicKey, generateSigningKeyPair, signBytes } from '../src/crypto/ed25519'
import { deriveGroupSubkey, generateGroupKey } from '../src/crypto/group-key'
import {
  ENTRY_ENVELOPE_SUBKEY_PURPOSE,
  ENTRY_SCHEMA_VERSION,
  entryEnvelopeSchema,
  openEntryEnvelope,
  sealEntryEnvelope,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
  unsignedEntryEnvelopeSchema,
  verifyEntryEnvelope,
} from '../src/entry-envelope'
import { uuidv7 } from '../src/uuidv7'

const OCCURRED_AT = '2026-09-20T10:00:00.000Z'

async function makeDevice() {
  const pair = await generateSigningKeyPair()

  return { pair, signerPublicKey: await exportSigningPublicKey(pair.publicKey) }
}

function makeDraft(
  signerPublicKey: string,
  overrides: Partial<UnsignedEntryEnvelope> = {},
): UnsignedEntryEnvelope {
  return {
    id: uuidv7(),
    schemaVersion: ENTRY_SCHEMA_VERSION,
    authorDeviceId: uuidv7(),
    signerPublicKey,
    occurredAt: OCCURRED_AT,
    type: 'expense',
    payload: { amountPaise: 12_000 },
    ...overrides,
  }
}

async function makeSignedEntry(overrides: Partial<UnsignedEntryEnvelope> = {}) {
  const device = await makeDevice()
  const draft = makeDraft(device.signerPublicKey, overrides)

  return { entry: await signEntryEnvelope(draft, device.pair.privateKey), device, draft }
}

function makeEnvelopeKey(): Promise<CryptoKey> {
  return deriveGroupSubkey(generateGroupKey(), ENTRY_ENVELOPE_SUBKEY_PURPOSE)
}

describe('EntryEnvelope schema', () => {
  it('validates a signed envelope and rejects unknown fields', async () => {
    const { entry } = await makeSignedEntry()

    expect(entryEnvelopeSchema.safeParse(entry).success).toBe(true)
    expect(entryEnvelopeSchema.safeParse({ ...entry, extra: true }).success).toBe(false)
  })

  it('accepts an Entry type this app version does not know', async () => {
    const { entry } = await makeSignedEntry({ type: 'loan', payload: { item: 'eggs', taken: 3 } })

    expect(entryEnvelopeSchema.safeParse(entry).success).toBe(true)
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('rejects an unsigned envelope', async () => {
    const { draft } = await makeSignedEntry()

    expect(unsignedEntryEnvelopeSchema.safeParse(draft).success).toBe(true)
    expect(entryEnvelopeSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects malformed fields', async () => {
    const { entry } = await makeSignedEntry()
    const malformed = [
      { ...entry, id: '9f4b1f3a-4f2b-4b3c-8b3d-9f4b1f3a4f2b' },
      { ...entry, schemaVersion: 2 },
      { ...entry, authorDeviceId: '' },
      { ...entry, occurredAt: 'yesterday' },
      { ...entry, type: '' },
      { ...entry, payload: new Date() },
      { ...entry, payload: Number.NaN },
      { ...entry, signerPublicKey: toBase64Url(new Uint8Array(31)) },
      { ...entry, signature: toBase64Url(new Uint8Array(63)) },
    ]

    for (const candidate of malformed) {
      expect(entryEnvelopeSchema.safeParse(candidate).success).toBe(false)
    }
  })
})

describe('signing Entries', () => {
  it('produces an envelope whose signature verifies', async () => {
    const { entry } = await makeSignedEntry()

    expect(entry.signature).toMatch(/^[A-Za-z0-9_-]{86}$/)
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('refuses to sign an invalid draft', async () => {
    const device = await makeDevice()
    const draft = makeDraft(device.signerPublicKey, { id: 'not-a-uuid' })

    await expect(signEntryEnvelope(draft, device.pair.privateKey)).rejects.toThrow()
  })

  it('refuses a signerPublicKey that does not match the signing key', async () => {
    const alice = await makeDevice()
    const mallory = await makeDevice()
    const draft = makeDraft(mallory.signerPublicKey)

    await expect(signEntryEnvelope(draft, alice.pair.privateKey)).rejects.toThrow()
  })

  it('rejects a tampered payload', async () => {
    const { entry } = await makeSignedEntry()

    await expect(verifyEntryEnvelope({ ...entry, payload: { amountPaise: 1 } })).rejects.toThrow()
  })

  it('rejects a tampered author', async () => {
    const { entry } = await makeSignedEntry()

    await expect(verifyEntryEnvelope({ ...entry, authorDeviceId: uuidv7() })).rejects.toThrow()
  })

  it('rejects a signature from another Entry', async () => {
    const { entry } = await makeSignedEntry()
    const other = await makeSignedEntry()

    await expect(
      verifyEntryEnvelope({ ...entry, signature: other.entry.signature }),
    ).rejects.toThrow()
  })

  it('rejects a signerPublicKey that does not match the signature', async () => {
    const { entry } = await makeSignedEntry()
    const mallory = await makeDevice()

    await expect(
      verifyEntryEnvelope({ ...entry, signerPublicKey: mallory.signerPublicKey }),
    ).rejects.toThrow()
  })

  it('rejects a nonsense signature', async () => {
    const { entry } = await makeSignedEntry()
    const device = await makeDevice()
    const signature = await signBytes(device.pair.privateKey, new TextEncoder().encode('nope'))

    await expect(
      verifyEntryEnvelope({ ...entry, signature: toBase64Url(signature) }),
    ).rejects.toThrow()
  })

  it('verifies an envelope whose JSON keys arrived in a different order', async () => {
    const { entry } = await makeSignedEntry({ payload: { a: 1, b: 2 } })
    const reordered = { ...entry, payload: { b: 2, a: 1 } }

    await expect(verifyEntryEnvelope(reordered)).resolves.toEqual(reordered)
  })
})

describe('sealed envelopes', () => {
  it('round-trips a signed Entry through AES-256-GCM', async () => {
    const { entry } = await makeSignedEntry()
    const key = await makeEnvelopeKey()
    const sealed = await sealEntryEnvelope(entry, key)

    await expect(openEntryEnvelope(sealed, key)).resolves.toEqual(entry)
  })

  it('rejects a tampered ciphertext', async () => {
    const { entry } = await makeSignedEntry()
    const key = await makeEnvelopeKey()
    const sealed = await sealEntryEnvelope(entry, key)
    const tampered = Uint8Array.from(sealed)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff

    await expect(openEntryEnvelope(tampered, key)).rejects.toThrow()
  })

  it('rejects an envelope sealed under another group key', async () => {
    const { entry } = await makeSignedEntry()
    const sealed = await sealEntryEnvelope(entry, await makeEnvelopeKey())

    await expect(openEntryEnvelope(sealed, await makeEnvelopeKey())).rejects.toThrow()
  })

  it('rejects a sealed payload whose signature does not verify', async () => {
    const { entry } = await makeSignedEntry()
    const key = await makeEnvelopeKey()
    const sealed = await sealEntryEnvelope({ ...entry, payload: { amountPaise: 1 } }, key)

    await expect(openEntryEnvelope(sealed, key)).rejects.toThrow()
  })

  it('rejects bytes that are not a sealed Entry', async () => {
    const key = await makeEnvelopeKey()
    const garbage = new TextEncoder().encode('not a sealed envelope')

    await expect(openEntryEnvelope(garbage, key)).rejects.toThrow()
  })
})
