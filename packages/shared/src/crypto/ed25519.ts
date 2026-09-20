import { type Bytes, fromBase64Url, toBase64Url } from '../bytes'

const ED25519 = { name: 'Ed25519' } as const

/** Byte length of a raw Ed25519 public key. */
export const SIGNING_PUBLIC_KEY_BYTES = 32

/** Byte length of an Ed25519 signature. */
export const SIGNATURE_BYTES = 64

/**
 * Generates the Ed25519 key pair that signs a Member's Entries. The private
 * key is non-extractable: it can sign, but its bytes never leave the device.
 */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ED25519, false, ['sign', 'verify']) as Promise<CryptoKeyPair>
}

/** Signs bytes with a Member's Ed25519 device key. */
export async function signBytes(privateKey: CryptoKey, message: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.sign(ED25519, privateKey, message))
}

/** Verifies an Ed25519 signature over bytes. */
export function verifyBytes(
  publicKey: CryptoKey,
  signature: Bytes,
  message: Bytes,
): Promise<boolean> {
  return crypto.subtle.verify(ED25519, publicKey, signature, message)
}

/** Exports a public key as 32 bytes of unpadded base64url. */
export async function exportSigningPublicKey(publicKey: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)))
}

/** Imports a base64url raw Ed25519 public key for verification. */
export async function importSigningPublicKey(encoded: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(encoded)

  if (bytes.length !== SIGNING_PUBLIC_KEY_BYTES) {
    throw new Error(`Ed25519 public key must be ${SIGNING_PUBLIC_KEY_BYTES} bytes`)
  }

  return crypto.subtle.importKey('raw', bytes, ED25519, true, ['verify'])
}
