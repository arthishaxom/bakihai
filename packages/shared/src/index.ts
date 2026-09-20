// Entry envelopes, envelope crypto, and Balance computation live here (ADR-0001, ADR-0002, ADR-0004).
export { type Bytes, fromBase64Url, toBase64Url } from './bytes'
export { canonicalJson, canonicalJsonBytes } from './canonical-json'
export { AEAD_IV_BYTES, decryptBytes, encryptBytes } from './crypto/aead'
export {
  exportSigningPublicKey,
  generateSigningKeyPair,
  importSigningPublicKey,
  SIGNATURE_BYTES,
  SIGNING_PUBLIC_KEY_BYTES,
  signBytes,
  verifyBytes,
} from './crypto/ed25519'
export {
  deriveGroupSubkey,
  GROUP_KEY_BYTES,
  type GroupKey,
  generateGroupKey,
} from './crypto/group-key'
export {
  ENTRY_ENVELOPE_SUBKEY_PURPOSE,
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  entryEnvelopeSchema,
  openEntryEnvelope,
  sealEntryEnvelope,
  serializeEntryEnvelope,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
  unsignedEntryEnvelopeSchema,
  verifyEntryEnvelope,
} from './entry-envelope'
export { uuidv7 } from './uuidv7'
