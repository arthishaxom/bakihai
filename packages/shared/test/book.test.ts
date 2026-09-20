import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createBookDoc, entriesMap, putEntry, readEntries } from '../src/book'
import { uuidv7 } from '../src/uuidv7'
import { makeEntry } from './helpers/entries'

describe('book document', () => {
  it('holds Entries as plain JSON values in a map keyed by Entry id', async () => {
    const doc = createBookDoc()
    const entry = await makeEntry('dinner')

    putEntry(doc, entry)

    expect(entriesMap(doc).get(entry.id)).toEqual(entry)
    expect(readEntries(doc)).toEqual([entry])
  })

  it('writing the same Entry twice changes nothing', async () => {
    const doc = createBookDoc()
    const entry = await makeEntry('chai')

    putEntry(doc, entry)
    const updates: Uint8Array[] = []
    doc.on('update', (update) => updates.push(update))
    putEntry(doc, entry)

    expect(readEntries(doc)).toEqual([entry])
    expect(updates).toHaveLength(0)
  })

  it('survives a Yjs update round-trip with the map intact', async () => {
    const source = createBookDoc()
    const first = await makeEntry('dinner')
    const second = await makeEntry('cab')
    putEntry(source, first)
    putEntry(source, second)

    const replica = createBookDoc()
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(source))

    expect(
      readEntries(replica)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([first.id, second.id].sort())
  })

  it('converges concurrent writes to one Entry id on every replica', async () => {
    // Yjs resolves the conflict deterministically, but it is still a rewrite of
    // an existing id. Ingest verification against the Group roster is the gate
    // that rejects such a conflict before it enters the book (#5, #8).
    const id = uuidv7()
    const fromA = await makeEntry('from A', { id })
    const fromB = await makeEntry('from B', { id })
    const docA = createBookDoc()
    const docB = createBookDoc()
    putEntry(docA, fromA)
    putEntry(docB, fromB)

    const updateA = Y.encodeStateAsUpdate(docA)
    const updateB = Y.encodeStateAsUpdate(docB)
    Y.applyUpdate(docA, updateB)
    Y.applyUpdate(docB, updateA)

    expect(readEntries(docA)).toHaveLength(1)
    expect(readEntries(docB)).toEqual(readEntries(docA))
  })
})
