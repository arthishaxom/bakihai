import {
  BookSyncProvider,
  createBookDoc,
  createMemberEntry,
  fromBase64Url,
  MEMBER_ENTRY_TYPE,
  putEntry,
  readEntries,
} from '@bakihai/shared'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import { type Identity, importDeviceSigningKey } from '../identity/identity'
import { persistBook } from './persistence'

/** One Group's live book: the document, its local copy, and its relay connection. */
export interface BookSession {
  doc: Y.Doc
  persistence: IndexeddbPersistence
  provider: BookSyncProvider
  /** Resolves once this device's own Member Entry is in the local book. */
  ready: Promise<void>
}

let current: { groupId: string; session: BookSession } | null = null

/**
 * The session for this device's Group, created on first use. One module-level
 * session keeps the document and relay connection alive across navigation;
 * opening a different Group tears the old one down.
 */
export function getBookSession(identity: Identity): BookSession {
  if (current?.groupId === identity.groupId) {
    return current.session
  }

  current?.session.provider.destroy()
  current?.session.persistence.destroy()

  const session = createBookSession(identity)

  current = { groupId: identity.groupId, session }

  return session
}

function createBookSession(identity: Identity): BookSession {
  const doc = createBookDoc()
  const persistence = persistBook(doc, identity.groupId)
  const provider = new BookSyncProvider({
    doc,
    groupKey: fromBase64Url(identity.groupKey),
    room: identity.groupId,
    relayUrl: identity.relayUrl,
  })

  return {
    doc,
    persistence,
    provider,
    ready: ensureOwnMemberEntry(doc, persistence, identity),
  }
}

/**
 * Writes this device's Member Entry unless the local book already has one, so
 * a joining device announces itself as soon as its book is loaded and a reload
 * never adds a second membership. The Entry syncs like any other.
 */
async function ensureOwnMemberEntry(
  doc: Y.Doc,
  persistence: IndexeddbPersistence,
  identity: Identity,
): Promise<void> {
  await persistence.whenSynced

  const alreadyJoined = readEntries(doc).some(
    (entry) =>
      entry.type === MEMBER_ENTRY_TYPE &&
      entry.authorDeviceId === identity.deviceId &&
      entry.signerPublicKey === identity.signerPublicKey,
  )

  if (alreadyJoined) {
    return
  }

  const privateKey = await importDeviceSigningKey(identity)
  const entry = await createMemberEntry({
    deviceId: identity.deviceId,
    signerPublicKey: identity.signerPublicKey,
    privateKey,
    displayName: identity.displayName,
  })

  putEntry(doc, entry)
}
