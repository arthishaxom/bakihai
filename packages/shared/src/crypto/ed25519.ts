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

/** A device key pair plus the PKCS8 encoding a device stores to restore it. */
export interface StorableSigningKeyPair {
  publicKey: CryptoKey
  /** The working private key, non-extractable like any other signing key. */
  privateKey: CryptoKey
  /** PKCS8-encoded private key, unpadded base64url, for the device's own storage. */
  privateKeyPkcs8: string
}

/**
 * Generates a device key pair whose private key can be written to the device's
 * own storage as PKCS8 and restored on the next visit. The key returned for
 * signing is re-imported non-extractable, so live code can use it but not read
 * its bytes back out.
 */
export async function generateStorableSigningKeyPair(): Promise<StorableSigningKeyPair> {
  const generated = (await crypto.subtle.generateKey(ED25519, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const exported = await crypto.subtle.exportKey('pkcs8', generated.privateKey)
  const privateKeyPkcs8 = toBase64Url(new Uint8Array(exported as ArrayBuffer))

  return {
    publicKey: generated.publicKey,
    privateKey: await importSigningPrivateKey(privateKeyPkcs8),
    privateKeyPkcs8,
  }
}

/** Imports a stored PKCS8 Ed25519 private key as a non-extractable signing key. */
export async function importSigningPrivateKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', fromBase64Url(encoded), ED25519, false, [
    'sign',
  ]) as Promise<CryptoKey>
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
  const exported = await crypto.subtle.exportKey('raw', publicKey)

  return toBase64Url(new Uint8Array(exported as ArrayBuffer))
}

/** Imports a base64url raw Ed25519 public key for verification. */
export async function importSigningPublicKey(encoded: string): Promise<CryptoKey> {
  const bytes = fromBase64Url(encoded)

  if (bytes.length !== SIGNING_PUBLIC_KEY_BYTES) {
    throw new Error(`Ed25519 public key must be ${SIGNING_PUBLIC_KEY_BYTES} bytes`)
  }

  return crypto.subtle.importKey('raw', bytes, ED25519, true, ['verify'])
}
