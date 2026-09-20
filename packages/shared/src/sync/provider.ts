import * as Y from 'yjs'
import { type Bytes, fromBase64Url } from '../bytes'
import type { GroupKey } from '../crypto/group-key'
import { frameForSealedUpdate, MAX_SEALED_UPDATE_CHARS, parseSealedUpdateFrame } from './frames'
import { deriveBookUpdateKey, openBookUpdate, sealBookUpdate } from './update-crypto'

/** PartyServer party that serves sealed book rooms: `/parties/book-room/:room`. */
export const BOOK_ROOM_PARTY = 'book-room'

/** Connection state of the provider, for UI that wants to say "not synced yet". */
export type SyncStatus = 'disconnected' | 'connecting' | 'connected'

/**
 * The slice of the WebSocket API the provider uses. Tests and other hosts can
 * supply their own implementation instead of a browser WebSocket.
 */
export interface SyncSocket {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((error: unknown) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type SyncSocketFactory = (url: string) => SyncSocket

export interface BookSyncProviderOptions {
  /** The Group's book document. Every update is sealed with the Group key. */
  doc: Y.Doc
  /** Shared Group secret from which the sync subkey is derived. */
  groupKey: GroupKey
  /** Relay room for the Group — the Group id in the app. */
  room: string
  /** Relay origin, e.g. `https://relay.bakihai.apothal.dev` or `http://localhost:8787`. */
  relayUrl: string
  /** Whether to open the connection immediately. Defaults to true. */
  connect?: boolean
  /** Socket implementation; defaults to the global WebSocket. */
  createSocket?: SyncSocketFactory
  /** Ceiling for reconnect backoff, in milliseconds. */
  maxBackoffMs?: number
}

type StatusListener = (status: SyncStatus) => void
type ErrorListener = (error: unknown) => void

const SOCKET_OPEN = 1
const INITIAL_BACKOFF_MS = 500
const DEFAULT_MAX_BACKOFF_MS = 10_000

/** Builds the relay WebSocket URL for a room, keeping the relay origin's scheme. */
export function relaySocketUrl(relayUrl: string, room: string): string {
  const url = new URL(
    `/parties/${encodeURIComponent(BOOK_ROOM_PARTY)}/${encodeURIComponent(room)}`,
    relayUrl,
  )

  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }

  return url.toString()
}

function defaultSocketFactory(url: string): SyncSocket {
  return new WebSocket(url) as unknown as SyncSocket
}

/**
 * Keeps one Group's book in sync through a relay that cannot read it.
 *
 * Every Yjs update is sealed with the Group key before it touches the wire;
 * the relay stores and broadcasts opaque frames. On connect the provider
 * publishes the whole local book, so Entries written while offline — or on a
 * device that never managed to send them — reach everyone on the next
 * connection. Yjs updates are idempotent and commutative, so replays,
 * duplicates, and reordering all converge.
 */
export class BookSyncProvider {
  readonly #doc: Y.Doc
  readonly #room: string
  readonly #relayUrl: string
  readonly #createSocket: SyncSocketFactory
  readonly #maxBackoffMs: number
  readonly #keyPromise: Promise<CryptoKey>
  readonly #statusListeners = new Set<StatusListener>()
  readonly #errorListeners = new Set<ErrorListener>()

  #shouldConnect = false
  #destroyed = false
  #socket: SyncSocket | null = null
  #retryDelayMs = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #status: SyncStatus = 'disconnected'

  constructor(options: BookSyncProviderOptions) {
    this.#doc = options.doc
    this.#room = options.room
    this.#relayUrl = options.relayUrl
    this.#createSocket = options.createSocket ?? defaultSocketFactory
    this.#maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.#keyPromise = deriveBookUpdateKey(options.groupKey)

    this.#doc.on('update', this.#handleDocUpdate)

    if (options.connect !== false) {
      this.connect()
    }
  }

  get status(): SyncStatus {
    return this.#status
  }

  connect(): void {
    if (this.#destroyed || this.#shouldConnect) {
      return
    }

    this.#shouldConnect = true
    this.#retryDelayMs = 0
    this.#openSocket()
  }

  disconnect(): void {
    this.#shouldConnect = false
    this.#clearRetryTimer()
    this.#closeSocket()
    this.#setStatus('disconnected')
  }

  destroy(): void {
    this.#destroyed = true
    this.#doc.off('update', this.#handleDocUpdate)
    this.disconnect()
    this.#statusListeners.clear()
    this.#errorListeners.clear()
  }

  on(event: 'status', listener: StatusListener): () => void
  on(event: 'error', listener: ErrorListener): () => void
  on(event: 'status' | 'error', listener: StatusListener | ErrorListener): () => void {
    if (event === 'status') {
      const statusListener = listener as StatusListener

      this.#statusListeners.add(statusListener)

      return () => {
        this.#statusListeners.delete(statusListener)
      }
    }

    const errorListener = listener as ErrorListener

    this.#errorListeners.add(errorListener)

    return () => {
      this.#errorListeners.delete(errorListener)
    }
  }

  readonly #handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) {
      return
    }

    // With no open socket the update is not queued in memory: the next
    // connection publishes the whole local book, which includes it.
    if (this.#socket?.readyState !== SOCKET_OPEN) {
      return
    }

    void this.#sendUpdate(update as Bytes)
  }

  #openSocket(): void {
    if (this.#destroyed || !this.#shouldConnect) {
      return
    }

    this.#setStatus('connecting')

    let socket: SyncSocket

    try {
      socket = this.#createSocket(relaySocketUrl(this.#relayUrl, this.#room))
    } catch (error) {
      this.#emitError(error)
      this.#scheduleReconnect()
      return
    }

    this.#socket = socket

    socket.onopen = () => {
      if (this.#socket !== socket || !this.#shouldConnect) {
        return
      }

      this.#retryDelayMs = 0
      this.#setStatus('connected')
      void this.#publishState(socket)
    }

    socket.onmessage = (event) => {
      if (this.#socket !== socket) {
        return
      }

      void this.#receive(socket, event.data)
    }

    socket.onclose = () => {
      if (this.#socket !== socket) {
        return
      }

      this.#socket = null
      this.#setStatus('disconnected')
      this.#scheduleReconnect()
    }

    socket.onerror = (error) => {
      this.#emitError(error)
    }
  }

  #closeSocket(): void {
    const socket = this.#socket

    this.#socket = null

    if (!socket) {
      return
    }

    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null

    try {
      socket.close(1000, 'client disconnected')
    } catch {
      // The socket may already be closed; nothing left to do.
    }
  }

  async #publishState(socket: SyncSocket): Promise<void> {
    try {
      const key = await this.#keyPromise
      const sealed = await sealBookUpdate(key, Y.encodeStateAsUpdate(this.#doc) as Bytes)

      this.#sendSealed(socket, sealed)
    } catch (error) {
      this.#emitError(error)
    }
  }

  async #sendUpdate(update: Bytes): Promise<void> {
    const socket = this.#socket

    if (!socket) {
      return
    }

    try {
      const key = await this.#keyPromise
      const sealed = await sealBookUpdate(key, update)

      this.#sendSealed(socket, sealed)
    } catch (error) {
      this.#emitError(error)
    }
  }

  #sendSealed(socket: SyncSocket, sealed: Bytes): void {
    if (this.#socket !== socket || socket.readyState !== SOCKET_OPEN) {
      return
    }

    const frame = frameForSealedUpdate(sealed)

    if (frame.d.length > MAX_SEALED_UPDATE_CHARS) {
      this.#emitError(
        new Error('Book update is too large for the relay; nothing was sent to the Group'),
      )
      return
    }

    socket.send(JSON.stringify(frame))
  }

  async #receive(socket: SyncSocket, data: unknown): Promise<void> {
    if (typeof data !== 'string') {
      this.#emitError(new Error('Relay sent a frame that is not text'))
      return
    }

    const frame = parseSealedUpdateFrame(data)

    if (!frame) {
      this.#emitError(new Error('Relay sent a malformed frame'))
      return
    }

    if (this.#socket !== socket) {
      return
    }

    try {
      const key = await this.#keyPromise
      const update = await openBookUpdate(key, fromBase64Url(frame.d))

      Y.applyUpdate(this.#doc, update, this)
    } catch (error) {
      this.#emitError(error)
    }
  }

  #scheduleReconnect(): void {
    if (this.#destroyed || !this.#shouldConnect || this.#retryTimer !== null) {
      return
    }

    this.#retryDelayMs =
      this.#retryDelayMs === 0
        ? INITIAL_BACKOFF_MS
        : Math.min(this.#retryDelayMs * 2, this.#maxBackoffMs)

    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null
      this.#openSocket()
    }, this.#retryDelayMs)
  }

  #clearRetryTimer(): void {
    if (this.#retryTimer !== null) {
      clearTimeout(this.#retryTimer)
      this.#retryTimer = null
    }
  }

  #setStatus(status: SyncStatus): void {
    if (this.#status === status) {
      return
    }

    this.#status = status

    for (const listener of this.#statusListeners) {
      listener(status)
    }
  }

  #emitError(error: unknown): void {
    for (const listener of this.#errorListeners) {
      listener(error)
    }
  }
}
