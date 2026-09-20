import { describe, expect, it } from 'vitest'
import * as shared from '../src/index'

const exportedNames = [
  'AEAD_IV_BYTES',
  'BOOK_ENTRIES_MAP',
  'BOOK_ROOM_PARTY',
  'BOOK_UPDATE_SUBKEY_PURPOSE',
  'BookSyncProvider',
  'ENTRY_ENVELOPE_SUBKEY_PURPOSE',
  'ENTRY_SCHEMA_VERSION',
  'EXPENSE_ENTRY_TYPE',
  'GROUP_KEY_BYTES',
  'GROUP_NAME_MAX_LENGTH',
  'HEARTBEAT_FRAME',
  'INVITE_VERSION',
  'MAX_SEALED_UPDATE_CHARS',
  'MEMBER_DISPLAY_NAME_MAX_LENGTH',
  'MEMBER_ENTRY_TYPE',
  'SIGNATURE_BYTES',
  'SIGNING_PUBLIC_KEY_BYTES',
  'admitEntries',
  'buildInviteUrl',
  'canonicalJson',
  'canonicalJsonBytes',
  'createBookDoc',
  'createExpenseEntry',
  'createMemberEntry',
  'decryptBytes',
  'decodeInvite',
  'deriveBookUpdateKey',
  'deriveGroupSubkey',
  'encodeInvite',
  'encryptBytes',
  'entriesMap',
  'entryEnvelopeSchema',
  'expenseEntryPayloadSchema',
  'exportSigningPublicKey',
  'foldBalances',
  'foldMemberKeys',
  'foldMembers',
  'formatPaiseAsRupees',
  'frameForSealedUpdate',
  'fromBase64Url',
  'generateGroupKey',
  'generateSigningKeyPair',
  'generateStorableSigningKeyPair',
  'heartbeatFrameSchema',
  'importSigningPrivateKey',
  'importSigningPublicKey',
  'inviteSchema',
  'isBase64UrlOfByteLength',
  'memberEntryPayloadSchema',
  'openBookUpdate',
  'openEntryEnvelope',
  'parseRelayFrame',
  'parseRupeesToPaise',
  'parseSealedUpdateFrame',
  'putEntry',
  'readEntries',
  'readInviteFromHash',
  'relayFrameSchema',
  'relaySocketUrl',
  'sealBookUpdate',
  'sealEntryEnvelope',
  'sealedUpdateFrameSchema',
  'serializeEntryEnvelope',
  'signBytes',
  'signEntryEnvelope',
  'splitExpense',
  'toBase64Url',
  'unsignedEntryEnvelopeSchema',
  'uuidv7',
  'verifyBytes',
  'verifyEntryEnvelope',
]

describe('@bakihai/shared', () => {
  it('exports the Entry envelope primitives from the package entry point', () => {
    expect(Object.keys(shared).sort()).toEqual([...exportedNames].sort())
  })

  it('exposes the schema and crypto functions as callables', () => {
    expect(shared.entryEnvelopeSchema.safeParse).toBeTypeOf('function')
    expect(shared.verifyEntryEnvelope).toBeTypeOf('function')
    expect(shared.sealEntryEnvelope).toBeTypeOf('function')
    expect(shared.deriveGroupSubkey).toBeTypeOf('function')
  })
})
