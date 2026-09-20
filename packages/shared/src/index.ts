// Entry envelopes, envelope crypto, and Balance computation live here (ADR-0001, ADR-0002, ADR-0004).

export {
  BOOK_ENTRIES_MAP,
  createBookDoc,
  entriesMap,
  putEntry,
  readEntries,
} from './book'
export {
  type Bytes,
  fromBase64Url,
  isBase64UrlOfByteLength,
  toBase64Url,
} from './bytes'
export { canonicalJson, canonicalJsonBytes } from './canonical-json'
export { AEAD_IV_BYTES, decryptBytes, encryptBytes } from './crypto/aead'
export {
  exportSigningPublicKey,
  generateSigningKeyPair,
  generateStorableSigningKeyPair,
  importSigningPrivateKey,
  importSigningPublicKey,
  SIGNATURE_BYTES,
  SIGNING_PUBLIC_KEY_BYTES,
  type StorableSigningKeyPair,
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
export {
  buildInviteUrl,
  decodeInvite,
  encodeInvite,
  GROUP_NAME_MAX_LENGTH,
  INVITE_VERSION,
  type Invite,
  inviteSchema,
  readInviteFromHash,
} from './group/invite'
export {
  type CreateMemberEntryInput,
  createMemberEntry,
  foldMembers,
  MEMBER_DISPLAY_NAME_MAX_LENGTH,
  MEMBER_ENTRY_TYPE,
  type Member,
  type MemberEntryPayload,
  memberEntryPayloadSchema,
} from './group/members'
export {
  frameForSealedUpdate,
  MAX_SEALED_UPDATE_CHARS,
  parseSealedUpdateFrame,
  type SealedUpdateFrame,
  sealedUpdateFrameSchema,
} from './sync/frames'
export {
  BOOK_ROOM_PARTY,
  BookSyncProvider,
  type BookSyncProviderOptions,
  relaySocketUrl,
  type SyncSocket,
  type SyncSocketFactory,
  type SyncStatus,
} from './sync/provider'
export {
  BOOK_UPDATE_SUBKEY_PURPOSE,
  deriveBookUpdateKey,
  openBookUpdate,
  sealBookUpdate,
} from './sync/update-crypto'
export { uuidv7 } from './uuidv7'
