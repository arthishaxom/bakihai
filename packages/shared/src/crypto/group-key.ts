import { type Bytes, utf8Encode } from '../bytes'

/** Byte length of a Group key: 256 bits of shared secret. */
export const GROUP_KEY_BYTES = 32

/** The shared secret from which every Group subkey is derived. Never leaves the Group. */
export type GroupKey = Bytes

const HKDF_SALT = utf8Encode('bakihai/v1/group-key')
const SUBKEY_BITS = 256

/** Generates a new Group key on the device that creates the Group. */
export function generateGroupKey(): GroupKey {
  return crypto.getRandomValues(new Uint8Array(GROUP_KEY_BYTES))
}

/**
 * Derives an AES-256-GCM subkey from the Group key with HKDF-SHA256. The
 * purpose string separates subkeys, so key material for one use never doubles
 * as key material for another. Derivation is deterministic: every device in
 * the Group derives the same subkey from the same Group key and purpose.
 */
export async function deriveGroupSubkey(groupKey: GroupKey, purpose: string): Promise<CryptoKey> {
  if (groupKey.length !== GROUP_KEY_BYTES) {
    throw new TypeError(`Group key must be ${GROUP_KEY_BYTES} bytes`)
  }

  if (purpose.length === 0) {
    throw new TypeError('Subkey purpose must be a non-empty string')
  }

  const material = await crypto.subtle.importKey('raw', groupKey, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: utf8Encode(purpose) },
    material,
    SUBKEY_BITS,
  )

  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
