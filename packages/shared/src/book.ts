import * as Y from 'yjs'
import { type EntryEnvelope, entryEnvelopeSchema } from './entry-envelope'

/** Name of the Y.Map that holds a Group's Entries inside its book document. */
export const BOOK_ENTRIES_MAP = 'entries'

/**
 * Creates the Yjs document that holds one Group's book: every Entry as a plain
 * JSON value in a map keyed by Entry id. No domain data lives in Yjs-native
 * types, so the book survives swapping the sync library (ADR-0001).
 */
export function createBookDoc(): Y.Doc {
  return new Y.Doc()
}

/** The map of Entries keyed by Entry id. */
export function entriesMap(doc: Y.Doc): Y.Map<EntryEnvelope> {
  return doc.getMap<EntryEnvelope>(BOOK_ENTRIES_MAP)
}

/**
 * Writes an Entry under its own id. Entries are immutable: on this device the
 * first write for an id wins and re-writing the same Entry changes nothing at
 * all. Concurrent writes to one id from different devices still converge by
 * Yjs's deterministic conflict resolution, so ingest verification against the
 * Group roster is what actually keeps history unrewritable (#5, #8).
 */
export function putEntry(doc: Y.Doc, entry: EntryEnvelope): void {
  const map = entriesMap(doc)

  if (map.has(entry.id)) {
    return
  }

  map.set(entry.id, entry)
}

/**
 * Reads every well-formed Entry in the book, at most one per Entry id. The
 * book is untrusted input: a peer with the Group key can write anything into
 * the shared map, so values that are not Entries this app version understands
 * — or that sit under a key that is not the Entry's own id, which is how one
 * Entry could otherwise be counted twice — are left out here rather than
 * reaching a fold or a screen (#8). Map order is not meaningful; callers sort.
 */
export function readEntries(doc: Y.Doc): EntryEnvelope[] {
  const entries: EntryEnvelope[] = []

  for (const [key, value] of entriesMap(doc).entries()) {
    const parsed = entryEnvelopeSchema.safeParse(value)

    if (parsed.success && parsed.data.id === key) {
      entries.push(parsed.data)
    }
  }

  return entries
}
