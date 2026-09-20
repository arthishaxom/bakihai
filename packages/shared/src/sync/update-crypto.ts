import type { Bytes } from '../bytes'
import { decryptBytes, encryptBytes } from '../crypto/aead'
import { deriveGroupSubkey, type GroupKey } from '../crypto/group-key'

/**
 * Purpose string for the subkey that seals Yjs updates on their way through
 * the relay. It is separate from the Entry envelope subkey so key material for
 * one use never doubles as key material for another (ADR-0002).
 */
export const BOOK_UPDATE_SUBKEY_PURPOSE = 'book-update/v1'

/** Derives the AES-256-GCM key that seals this Group's sync updates. */
export function deriveBookUpdateKey(groupKey: GroupKey): Promise<CryptoKey> {
  return deriveGroupSubkey(groupKey, BOOK_UPDATE_SUBKEY_PURPOSE)
}

/** Seals a Yjs update so the relay only ever holds ciphertext. */
export function sealBookUpdate(key: CryptoKey, update: Bytes): Promise<Bytes> {
  return encryptBytes(update, key)
}

/** Opens a sealed Yjs update, rejecting anything not sealed under this key. */
export function openBookUpdate(key: CryptoKey, sealed: Bytes): Promise<Bytes> {
  return decryptBytes(sealed, key)
}
