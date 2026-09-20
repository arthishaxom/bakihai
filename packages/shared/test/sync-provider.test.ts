import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createBookDoc, putEntry, readEntries } from '../src/book'
import { fromBase64Url, toBase64Url } from '../src/bytes'
import { type GroupKey, generateGroupKey } from '../src/crypto/group-key'
import type { EntryEnvelope } from '../src/entry-envelope'
import { frameForSealedUpdate, parseSealedUpdateFrame } from '../src/sync/frames'
import { BookSyncProvider, relaySocketUrl, type SyncStatus } from '../src/sync/provider'
import { deriveBookUpdateKey, openBookUpdate, sealBookUpdate } from '../src/sync/update-crypto'
import { makeEntry } from './helpers/entries'
import { createFakeRelay } from './helpers/fake-relay'

/** Opens every frame with the Group key and folds them into one replica. */
async function collectEntries(frames: string[], groupKey: GroupKey): Promise<EntryEnvelope[]> {
  const key = await deriveBookUpdateKey(groupKey)
  const doc = createBookDoc()

  for (const frame of frames) {
    const parsed = parseSealedUpdateFrame(frame)

    if (!parsed) {
      throw new Error(`Frame did not parse: ${frame}`)
    }

    Y.applyUpdate(doc, await openBookUpdate(key, fromBase64Url(parsed.d)))
  }

  return readEntries(doc)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('relaySocketUrl', () => {
  it('builds the PartyServer room URL and keeps the relay origin scheme', () => {
    expect(relaySocketUrl('http://localhost:8787', 'group 1')).toBe(
      'ws://localhost:8787/parties/book-room/group%201',
    )
    expect(relaySocketUrl('https://relay.example', 'g1')).toBe(
      'wss://relay.example/parties/book-room/g1',
    )
  })
})

describe('BookSyncProvider', () => {
  it('publishes the whole local book when it connects', async () => {
    const relay = createFakeRelay()
    const groupKey = generateGroupKey()
    const doc = createBookDoc()
    const entry = await makeEntry('dinner')
    putEntry(doc, entry)

    const provider = new BookSyncProvider({
      doc,
      groupKey,
      room: 'room-1',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })

    await vi.waitFor(() => expect(relay.log).toHaveLength(1))
    expect((await collectEntries(relay.log, groupKey)).map((item) => item.id)).toEqual([entry.id])

    provider.destroy()
  })

  it('converges two books in the same room without echoing remote updates', async () => {
    const relay = createFakeRelay()
    const groupKey = generateGroupKey()
    const docA = createBookDoc()
    const docB = createBookDoc()
    const providerA = new BookSyncProvider({
      doc: docA,
      groupKey,
      room: 'room-2',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })
    const providerB = new BookSyncProvider({
      doc: docB,
      groupKey,
      room: 'room-2',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })

    await vi.waitFor(() => expect(relay.log).toHaveLength(2))

    const entry = await makeEntry('dinner')
    putEntry(docA, entry)

    await vi.waitFor(() => expect(readEntries(docB).map((item) => item.id)).toEqual([entry.id]))

    const framesAfterConverging = relay.log.length
    await sleep(20)
    expect(relay.log).toHaveLength(framesAfterConverging)

    providerA.destroy()
    providerB.destroy()
  })

  it('delivers an Entry written while offline on the next connection', async () => {
    const relay = createFakeRelay()
    const groupKey = generateGroupKey()
    const doc = createBookDoc()
    const provider = new BookSyncProvider({
      doc,
      groupKey,
      room: 'room-3',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })

    await vi.waitFor(() => expect(relay.log).toHaveLength(1))
    provider.disconnect()

    const offlineEntry = await makeEntry('offline chai')
    putEntry(doc, offlineEntry)
    await sleep(20)
    expect(relay.log).toHaveLength(1)

    provider.connect()

    await vi.waitFor(() => expect(relay.log).toHaveLength(2))
    const entries = await collectEntries(relay.log, groupKey)
    expect(entries.map((item) => item.id)).toContain(offlineEntry.id)

    provider.destroy()
  })

  it('reports status changes and reconnects after a dropped socket', async () => {
    const relay = createFakeRelay()
    const groupKey = generateGroupKey()
    const statuses: SyncStatus[] = []
    const provider = new BookSyncProvider({
      doc: createBookDoc(),
      groupKey,
      room: 'room-4',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
      connect: false,
    })
    provider.on('status', (status) => statuses.push(status))
    provider.connect()

    await vi.waitFor(() => expect(provider.status).toBe('connected'))
    expect(statuses).toContain('connecting')

    relay.sockets[0]?.close()

    await vi.waitFor(() => expect(provider.status).toBe('connected'))
    expect(relay.sockets).toHaveLength(2)

    provider.destroy()
    expect(provider.status).toBe('disconnected')
  })

  it('ignores malformed, tampered, and wrong-key frames without touching the book', async () => {
    const relay = createFakeRelay()
    const groupKey = generateGroupKey()
    const doc = createBookDoc()
    const errors: unknown[] = []
    const provider = new BookSyncProvider({
      doc,
      groupKey,
      room: 'room-5',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })
    provider.on('error', (error) => errors.push(error))

    await vi.waitFor(() => expect(provider.status).toBe('connected'))

    const garbage = toBase64Url(new Uint8Array(48).fill(9))
    const strangerKey = await deriveBookUpdateKey(generateGroupKey())
    const strangerFrame = frameForSealedUpdate(
      await sealBookUpdate(
        strangerKey,
        Y.encodeStateAsUpdate(createBookDoc()) as Uint8Array<ArrayBuffer>,
      ),
    )

    relay.deliver('not json at all')
    relay.deliver(JSON.stringify({ t: 'update', d: '!' }))
    relay.deliver(JSON.stringify({ t: 'update', d: garbage }))
    relay.deliver(JSON.stringify(strangerFrame))

    await vi.waitFor(() => expect(errors).toHaveLength(4))
    expect(readEntries(doc)).toEqual([])

    provider.destroy()
  })

  it('reports an update too large for the relay instead of dropping it silently', async () => {
    const relay = createFakeRelay()
    const doc = createBookDoc()
    const errors: unknown[] = []
    const entry = await makeEntry('x'.repeat(9 * 1024 * 1024))
    putEntry(doc, entry)

    const provider = new BookSyncProvider({
      doc,
      groupKey: generateGroupKey(),
      room: 'room-6',
      relayUrl: 'http://relay.test',
      createSocket: relay.createSocket,
      maxBackoffMs: 1,
    })
    provider.on('error', (error) => errors.push(error))

    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0))
    expect(relay.log).toHaveLength(0)

    provider.destroy()
  })
})
