import * as Y from 'yjs'
import type { EntryEnvelope } from './entry-envelope'

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

/** Reads every Entry in the book. Map order is not meaningful; callers sort. */
export function readEntries(doc: Y.Doc): EntryEnvelope[] {
  return [...entriesMap(doc).values()]
}
