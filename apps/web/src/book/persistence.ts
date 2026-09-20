import { IndexeddbPersistence } from 'y-indexeddb'
import type * as Y from 'yjs'

const BOOK_DATABASE_PREFIX = 'bakihai/book/'

/**
 * Persists a Group's book in the browser's IndexedDB so a reload or app restart
 * reads the whole book with no network (ADR-0001). The returned handle's
 * `whenSynced` resolves once the stored book has been applied to the document.
 */
export function persistBook(doc: Y.Doc, room: string): IndexeddbPersistence {
  return new IndexeddbPersistence(`${BOOK_DATABASE_PREFIX}${room}`, doc)
}
