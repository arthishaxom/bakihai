import type { Bytes } from '../bytes'

/** Length of the AES-GCM initialization vector prefixed to every sealed payload. */
export const AEAD_IV_BYTES = 12

const GCM_TAG_BYTES = 16

/**
 * Encrypts bytes with AES-256-GCM, returning `iv || ciphertext || tag`. A fresh
 * random IV is generated for every call; never reuse an IV with the same key.
 */
export async function encryptBytes(plaintext: Bytes, key: CryptoKey): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(AEAD_IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
  )

  const sealed = new Uint8Array(iv.length + ciphertext.length)
  sealed.set(iv)
  sealed.set(ciphertext, iv.length)

  return sealed
}

/** Decrypts bytes produced by {@link encryptBytes}, rejecting anything tampered with. */
export async function decryptBytes(sealed: Bytes, key: CryptoKey): Promise<Bytes> {
  if (sealed.length < AEAD_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error('Sealed payload is too short to hold an IV, ciphertext, and tag')
  }

  const iv = sealed.subarray(0, AEAD_IV_BYTES)
  const ciphertext = sealed.subarray(AEAD_IV_BYTES)

  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext))
}
