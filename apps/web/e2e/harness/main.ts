import {
  BookSyncProvider,
  createBookDoc,
  createMemberEntry,
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  entriesMap,
  exportSigningPublicKey,
  fromBase64Url,
  generateSigningKeyPair,
  putEntry,
  readEntries,
  signEntryEnvelope,
  type UnsignedEntryEnvelope,
  uuidv7,
} from '@bakihai/shared'
import { persistBook } from '../../src/book/persistence'

interface HarnessEntry {
  id: string
  type: string
  note: string | undefined
  amountPaise: number | undefined
}

interface HarnessApi {
  addEntry(input: { note: string; amountPaise: number }): Promise<string>
  /** Signs an Entry of any type as this harness device and writes it. */
  addSignedEntry(input: {
    type: string
    payload: UnsignedEntryEnvelope['payload']
  }): Promise<string>
  /** This harness device's id, for payloads that name a Member. */
  deviceId(): string
  /** Announces this harness device as a Member, so the app admits its Entries. */
  joinAs(displayName: string): Promise<string>
  /** Writes arbitrary JSON into the book at `key`, as a modified client would. */
  injectRaw(key: string, value: unknown): void
  /** Signs an Entry as `authorDeviceId` with a fresh key, forging authorship. */
  addForgedEntry(input: {
    authorDeviceId: string
    type: string
    payload: UnsignedEntryEnvelope['payload']
  }): Promise<string>
  /** Every raw value in the book, including anything malformed. */
  entryValues(): unknown[]
  /** A fresh Entry id, for tests that mint an envelope outside `putEntry`. */
  newId(): string
  entries(): HarnessEntry[]
  errors(): string[]
  status(): string
  /** Every status the provider has reported, in order; the sync chip's history. */
  statusLog(): string[]
  connect(): void
  disconnect(): void
  reconnect(): void
}

declare global {
  interface Window {
    harness: HarnessApi
  }
}

const params = new URLSearchParams(window.location.search)

function required(name: string): string {
  const value = params.get(name)

  if (!value) {
    throw new Error(`Harness URL is missing ?${name}`)
  }

  return value
}

function optionalNumber(name: string): number | undefined {
  const value = params.get(name)

  if (value === null) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Harness URL has an invalid ?${name}`)
  }

  return parsed
}

const room = required('room')
const groupKey = fromBase64Url(required('key'))
const relayUrl = params.get('relay') ?? 'http://localhost:8790'
const autoconnect = params.get('autoconnect') !== '0'
const heartbeatIntervalMs = optionalNumber('heartbeatInterval')
const heartbeatTimeoutMs = optionalNumber('heartbeatTimeout')

const doc = createBookDoc()
const persistence = persistBook(doc, room)
await persistence.whenSynced

const deviceId = uuidv7()
const deviceKeys = await generateSigningKeyPair()
const signerPublicKey = await exportSigningPublicKey(deviceKeys.publicKey)

const provider = new BookSyncProvider({
  doc,
  groupKey,
  room,
  relayUrl,
  connect: autoconnect,
  // Tests compress the cadence to fit many idle windows into a CI-sized wait.
  ...(heartbeatIntervalMs === undefined ? {} : { heartbeatIntervalMs }),
  ...(heartbeatTimeoutMs === undefined ? {} : { heartbeatTimeoutMs }),
})

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)

  if (!element) {
    throw new Error(`Harness page is missing ${selector}`)
  }

  return element
}

const statusElement = requireElement('#status')
const errorsElement = requireElement('#errors')
const entriesElement = requireElement('#entries')

const errors: string[] = []
const statusLog: string[] = []

function entries(): HarnessEntry[] {
  return readEntries(doc).map((entry) => {
    const payload = entry.payload as { note?: string; amountPaise?: number }

    return {
      id: entry.id,
      type: entry.type,
      note: payload.note,
      amountPaise: payload.amountPaise,
    }
  })
}

function render(): void {
  statusElement.dataset.status = provider.status
  statusElement.textContent = provider.status
  errorsElement.textContent = String(errors.length)
  entriesElement.replaceChildren(
    ...entries().map((entry) => {
      const item = document.createElement('li')

      item.dataset.entryId = entry.id
      item.textContent = `${entry.note ?? entry.id} (${entry.amountPaise ?? 0} paise)`

      return item
    }),
  )
}

provider.on('status', (status) => {
  statusLog.push(status)
  render()
})
provider.on('error', (error) => {
  errors.push(error instanceof Error ? error.message : String(error))
  render()
})

// The book is the source of truth: re-render whenever it changes, whether the
// Entry was written on this device or arrived from the relay.
entriesMap(doc).observe(() => render())

window.harness = {
  async addEntry(input) {
    const entry = await signEntryEnvelope(
      {
        id: uuidv7(),
        schemaVersion: ENTRY_SCHEMA_VERSION,
        authorDeviceId: deviceId,
        signerPublicKey,
        occurredAt: new Date().toISOString(),
        type: 'expense',
        payload: { note: input.note, amountPaise: input.amountPaise },
      },
      deviceKeys.privateKey,
    )

    putEntry(doc, entry)
    render()

    return entry.id
  },
  async joinAs(displayName) {
    const entry = await createMemberEntry({
      deviceId,
      signerPublicKey,
      privateKey: deviceKeys.privateKey,
      displayName,
    })

    putEntry(doc, entry)
    render()

    return entry.id
  },
  async addSignedEntry(input) {
    // The harness is a Member, so its Entries pass admission; the payload is
    // whatever the test asks for, valid or absurd, exactly like a modified
    // client's.
    const entry = await signEntryEnvelope(
      {
        id: uuidv7(),
        schemaVersion: ENTRY_SCHEMA_VERSION,
        authorDeviceId: deviceId,
        signerPublicKey,
        occurredAt: new Date().toISOString(),
        type: input.type,
        payload: input.payload,
      },
      deviceKeys.privateKey,
    )

    putEntry(doc, entry)
    render()

    return entry.id
  },
  deviceId: () => deviceId,
  injectRaw(key, value) {
    entriesMap(doc).set(key, value as EntryEnvelope)
    render()
  },
  async addForgedEntry(input) {
    // A fresh key signs an Entry that claims someone else's device id; the
    // signature itself is real, so only roster binding can reject it.
    const forgedKeys = await generateSigningKeyPair()
    const entry = await signEntryEnvelope(
      {
        id: uuidv7(),
        schemaVersion: ENTRY_SCHEMA_VERSION,
        authorDeviceId: input.authorDeviceId,
        signerPublicKey: await exportSigningPublicKey(forgedKeys.publicKey),
        occurredAt: new Date().toISOString(),
        type: input.type,
        payload: input.payload,
      },
      forgedKeys.privateKey,
    )

    putEntry(doc, entry)
    render()

    return entry.id
  },
  entryValues: () => [...entriesMap(doc).values()] as unknown[],
  newId: () => uuidv7(),
  entries,
  errors: () => [...errors],
  status: () => provider.status,
  statusLog: () => [...statusLog],
  connect: () => provider.connect(),
  disconnect: () => provider.disconnect(),
  reconnect: () => {
    provider.disconnect()
    provider.connect()
  },
}

render()
document.documentElement.dataset.ready = 'true'
