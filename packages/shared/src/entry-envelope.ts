import { z } from 'zod'
import { type Bytes, fromBase64Url, toBase64Url, utf8Decode } from './bytes'
import { canonicalJsonBytes } from './canonical-json'
import { decryptBytes, encryptBytes } from './crypto/aead'
import {
  importSigningPublicKey,
  SIGNATURE_BYTES,
  SIGNING_PUBLIC_KEY_BYTES,
  signBytes,
  verifyBytes,
} from './crypto/ed25519'

/** Envelope shape version. Envelopes from other versions are rejected, not misread. */
export const ENTRY_SCHEMA_VERSION = 1

/** Purpose string for the subkey that seals Entries for sync. */
export const ENTRY_ENVELOPE_SUBKEY_PURPOSE = 'entry-envelope/v1'

function base64UrlOfByteLength(expectedBytes: number, label: string) {
  return z.string().refine(
    (value) => {
      try {
        return fromBase64Url(value).length === expectedBytes
      } catch {
        return false
      }
    },
    { message: `${label} must be ${expectedBytes} bytes encoded as unpadded base64url` },
  )
}

/**
 * The immutable Envelope around every Entry: id, authorship, timing, type,
 * and payload, all covered by the author's signature. `type` is deliberately
 * an open string rather than an enum: an unknown type is a valid Entry that
 * this app version ignores, so mixed app versions never corrupt the book.
 */
export const entryEnvelopeSchema = z.strictObject({
  id: z.uuidv7(),
  schemaVersion: z.literal(ENTRY_SCHEMA_VERSION),
  authorDeviceId: z.string().min(1),
  signerPublicKey: base64UrlOfByteLength(SIGNING_PUBLIC_KEY_BYTES, 'signerPublicKey'),
  occurredAt: z.iso.datetime(),
  type: z.string().min(1),
  payload: z.json(),
  signature: base64UrlOfByteLength(SIGNATURE_BYTES, 'signature'),
})

export const unsignedEntryEnvelopeSchema = entryEnvelopeSchema.omit({ signature: true })

export type EntryEnvelope = z.infer<typeof entryEnvelopeSchema>
export type UnsignedEntryEnvelope = z.infer<typeof unsignedEntryEnvelopeSchema>

/**
 * Validates a draft and signs its canonical bytes with the author's device
 * key. The draft's `signerPublicKey` must belong to `privateKey`, so an
 * envelope cannot claim a signature from a key that did not produce it.
 */
export async function signEntryEnvelope(
  draft: UnsignedEntryEnvelope,
  privateKey: CryptoKey,
): Promise<EntryEnvelope> {
  const unsigned = unsignedEntryEnvelopeSchema.parse(draft)
  const message = canonicalJsonBytes(unsigned)
  const signature = await signBytes(privateKey, message)
  const publicKey = await importSigningPublicKey(unsigned.signerPublicKey)

  if (!(await verifyBytes(publicKey, signature, message))) {
    throw new Error('signerPublicKey does not match the signing key')
  }

  return { ...unsigned, signature: toBase64Url(signature) }
}

/**
 * Parses and verifies an untrusted envelope, returning it only when its
 * schema is valid and its signature covers the canonical bytes. Tampered,
 * unsigned, or malformed envelopes are rejected.
 *
 * This proves the envelope was signed by the holder of its own
 * `signerPublicKey`. Binding that key to the Entry's `authorDeviceId` needs
 * the Group roster and happens where entries enter the book.
 */
export async function verifyEntryEnvelope(input: unknown): Promise<EntryEnvelope> {
  const entry = entryEnvelopeSchema.parse(input)
  const { signature, ...unsigned } = entry
  const publicKey = await importSigningPublicKey(entry.signerPublicKey)
  const valid = await verifyBytes(publicKey, fromBase64Url(signature), canonicalJsonBytes(unsigned))

  if (!valid) {
    throw new Error('Entry signature does not verify')
  }

  return entry
}

/** Serializes a signed Entry to the canonical bytes that get sealed for sync. */
export function serializeEntryEnvelope(entry: EntryEnvelope): Bytes {
  return canonicalJsonBytes(entryEnvelopeSchema.parse(entry))
}

/** Encrypts a signed Entry for the relay, which only ever holds sealed bytes. */
export async function sealEntryEnvelope(entry: EntryEnvelope, key: CryptoKey): Promise<Bytes> {
  return encryptBytes(serializeEntryEnvelope(entry), key)
}

/** Decrypts sealed bytes, then verifies the Entry signature inside them. */
export async function openEntryEnvelope(sealed: Bytes, key: CryptoKey): Promise<EntryEnvelope> {
  const plaintext = await decryptBytes(sealed, key)

  return verifyEntryEnvelope(JSON.parse(utf8Decode(plaintext)) as unknown)
}
