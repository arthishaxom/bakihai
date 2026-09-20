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
  'GROUP_KEY_BYTES',
  'MAX_SEALED_UPDATE_CHARS',
  'SIGNATURE_BYTES',
  'SIGNING_PUBLIC_KEY_BYTES',
  'canonicalJson',
  'canonicalJsonBytes',
  'createBookDoc',
  'decryptBytes',
  'deriveBookUpdateKey',
  'deriveGroupSubkey',
  'encryptBytes',
  'entriesMap',
  'entryEnvelopeSchema',
  'exportSigningPublicKey',
  'frameForSealedUpdate',
  'fromBase64Url',
  'generateGroupKey',
  'generateSigningKeyPair',
  'importSigningPublicKey',
  'openBookUpdate',
  'openEntryEnvelope',
  'parseSealedUpdateFrame',
  'putEntry',
  'readEntries',
  'relaySocketUrl',
  'sealBookUpdate',
  'sealEntryEnvelope',
  'sealedUpdateFrameSchema',
  'serializeEntryEnvelope',
  'signBytes',
  'signEntryEnvelope',
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
