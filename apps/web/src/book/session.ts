import {
  BookSyncProvider,
  createBookDoc,
  createExpenseEntry,
  createMemberEntry,
  fromBase64Url,
  MEMBER_ENTRY_TYPE,
  putEntry,
  readEntries,
  verifyEntryEnvelope,
} from '@bakihai/shared'
import type { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'
import { type Identity, importDeviceSigningKey } from '../identity/identity'
import { persistBook } from './persistence'

/** The fields an Add Expense form decides; the session signs and writes the Entry. */
export interface ExpenseDraft {
  amountPaise: number
  payerDeviceId: string
  participantDeviceIds: string[]
}

/** One Group's live book: the document, its local copy, and its relay connection. */
export interface BookSession {
  doc: Y.Doc
  persistence: IndexeddbPersistence
  provider: BookSyncProvider
  /** Resolves once this device's own Member Entry is in the local book. */
  ready: Promise<void>
  /** Signs and writes an Expense to the local book; it syncs like any other Entry. */
  writeExpense(input: ExpenseDraft): Promise<void>
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
  const deviceKey = memoizedDeviceKey(identity)

  return {
    doc,
    persistence,
    provider,
    ready: ensureOwnMemberEntry(doc, persistence, identity, deviceKey),
    async writeExpense(input) {
      const privateKey = await deviceKey()
      const entry = await createExpenseEntry({
        deviceId: identity.deviceId,
        signerPublicKey: identity.signerPublicKey,
        privateKey,
        ...input,
      })

      putEntry(doc, entry)
    },
  }
}

/** Imports this device's signing key once per session, however many Entries it writes. */
function memoizedDeviceKey(identity: Identity): () => Promise<CryptoKey> {
  let deviceKey: Promise<CryptoKey> | null = null

  return () => {
    deviceKey ??= importDeviceSigningKey(identity)

    return deviceKey
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
  deviceKey: () => Promise<CryptoKey>,
): Promise<void> {
  await persistence.whenSynced

  if (await hasOwnMemberEntry(doc, identity)) {
    return
  }

  const privateKey = await deviceKey()
  const entry = await createMemberEntry({
    deviceId: identity.deviceId,
    signerPublicKey: identity.signerPublicKey,
    privateKey,
    displayName: identity.displayName,
  })

  putEntry(doc, entry)
}

/**
 * Whether this device's own Member Entry is in the book. A well-formed claim
 * on our device id only counts when it carries a signature by our key: a
 * forged Entry must not stop the real device from announcing itself (#8).
 */
async function hasOwnMemberEntry(doc: Y.Doc, identity: Identity): Promise<boolean> {
  for (const entry of readEntries(doc)) {
    if (
      entry.type !== MEMBER_ENTRY_TYPE ||
      entry.authorDeviceId !== identity.deviceId ||
      entry.signerPublicKey !== identity.signerPublicKey
    ) {
      continue
    }

    try {
      await verifyEntryEnvelope(entry)

      return true
    } catch {
      // Not signed by this device; keep looking.
    }
  }

  return false
}
