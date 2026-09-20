import * as Y from 'yjs'
import { type Bytes, fromBase64Url } from '../bytes'
import type { GroupKey } from '../crypto/group-key'
import {
  frameForSealedUpdate,
  HEARTBEAT_FRAME,
  MAX_SEALED_UPDATE_CHARS,
  parseRelayFrame,
} from './frames'
import { deriveBookUpdateKey, openBookUpdate, sealBookUpdate } from './update-crypto'

/** PartyServer party that serves sealed book rooms: `/parties/book-room/:room`. */
export const BOOK_ROOM_PARTY = 'book-room'

/**
 * Connection state of the provider, for UI that wants to say "not synced yet".
 * A socket that is merely open is still `connecting`: the provider only says
 * `connected` once the relay has answered a heartbeat on it (ADR-0011).
 */
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

/**
 * The browser signals that mean a socket may have died without saying so: the
 * network came back, or a phone that slept is awake again. The provider starts
 * a fresh connection on either, because the browser knows about the change
 * before the next heartbeat would.
 */
export interface PresenceSignals {
  /** Whether the page is visible; the heartbeat watchdog pauses while hidden. */
  isVisible(): boolean
  /** Subscribes to the browser regaining connectivity; returns an unsubscribe. */
  onOnline(listener: () => void): () => void
  /** Subscribes to the page becoming visible again; returns an unsubscribe. */
  onVisible(listener: () => void): () => void
}

export interface BookSyncProviderOptions {
  /** The Group's book document. Every update is sealed with the Group key. */
  doc: Y.Doc
  /** Shared Group secret from which the sync subkey is derived. */
  groupKey: GroupKey
  /** Relay room for the Group — the Group id in the app. */
  room: string
  /** Relay origin, e.g. `https://relay.bakihai.apothal.dev` or `http://localhost:8790`. */
  relayUrl: string
  /** Whether to open the connection immediately. Defaults to true. */
  connect?: boolean
  /** Socket implementation; defaults to the global WebSocket. */
  createSocket?: SyncSocketFactory
  /** Ceiling for reconnect backoff, in milliseconds. */
  maxBackoffMs?: number
  /** How often to prove the link is alive, in milliseconds. */
  heartbeatIntervalMs?: number
  /**
   * How long a heartbeat may go unanswered before the link is declared dead,
   * in milliseconds. Keep it above `heartbeatIntervalMs` so at least one
   * heartbeat is sent before the watchdog can conclude.
   */
  heartbeatTimeoutMs?: number
  /** Browser signals to watch; defaults to the real page, `null` disables them. */
  presence?: PresenceSignals | null
}

type StatusListener = (status: SyncStatus) => void
type ErrorListener = (error: unknown) => void

const SOCKET_OPEN = 1
const INITIAL_BACKOFF_MS = 500
const DEFAULT_MAX_BACKOFF_MS = 10_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 2_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 4_000

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
 * The slice of the browsing context the provider listens to. It is read off
 * `globalThis` so this package typechecks without the DOM library (the relay
 * imports it too) and no-ops in hosts that have no page.
 */
interface BrowserWindow {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  document?: {
    visibilityState: string
    addEventListener(type: string, listener: () => void): void
    removeEventListener(type: string, listener: () => void): void
  }
}

/** The real page events behind `PresenceSignals`, or null where there is no page. */
function browserPresenceSignals(): PresenceSignals | null {
  const page = (globalThis as { window?: BrowserWindow }).window

  if (!page?.document) {
    return null
  }

  const pageDocument = page.document

  return {
    isVisible: () => pageDocument.visibilityState === 'visible',
    onOnline(listener) {
      page.addEventListener('online', listener)

      return () => page.removeEventListener('online', listener)
    },
    onVisible(listener) {
      const onVisibilityChange = (): void => {
        if (pageDocument.visibilityState === 'visible') {
          listener()
        }
      }

      pageDocument.addEventListener('visibilitychange', onVisibilityChange)

      return () => pageDocument.removeEventListener('visibilitychange', onVisibilityChange)
    },
  }
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
 *
 * A socket can die without saying so: the browser keeps reporting it open
 * while nothing crosses it. The provider sends a heartbeat the relay echoes;
 * an open socket reads as `connecting` until one comes back, and a heartbeat
 * that goes unanswered for longer than `heartbeatTimeoutMs` declares the link
 * dead and starts a fresh connection. Because the frame that was lost may
 * have carried the whole book, the provider publishes it again once the link
 * proves itself alive. Connectivity and visibility changes force the same
 * fresh start (ADR-0011).
 */
export class BookSyncProvider {
  readonly #doc: Y.Doc
  readonly #room: string
  readonly #relayUrl: string
  readonly #createSocket: SyncSocketFactory
  readonly #maxBackoffMs: number
  readonly #heartbeatIntervalMs: number
  readonly #heartbeatTimeoutMs: number
  readonly #presence: PresenceSignals | null
  readonly #keyPromise: Promise<CryptoKey>
  readonly #statusListeners = new Set<StatusListener>()
  readonly #errorListeners = new Set<ErrorListener>()
  readonly #presenceUnsubscribers: Array<() => void> = []

  #shouldConnect = false
  #destroyed = false
  #socket: SyncSocket | null = null
  #retryDelayMs = 0
  #retryTimer: ReturnType<typeof setTimeout> | null = null
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null
  #heartbeatSentAt: number | null = null
  #republishPending = false
  #status: SyncStatus = 'disconnected'

  constructor(options: BookSyncProviderOptions) {
    this.#doc = options.doc
    this.#room = options.room
    this.#relayUrl = options.relayUrl
    this.#createSocket = options.createSocket ?? defaultSocketFactory
    this.#maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    this.#heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS
    this.#presence = options.presence === undefined ? browserPresenceSignals() : options.presence
    this.#keyPromise = deriveBookUpdateKey(options.groupKey)

    this.#doc.on('update', this.#handleDocUpdate)

    if (this.#presence) {
      this.#presenceUnsubscribers.push(
        this.#presence.onOnline(this.#handlePresenceChange),
        this.#presence.onVisible(this.#handlePresenceChange),
      )
    }

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
    this.#republishPending = false
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

    for (const unsubscribe of this.#presenceUnsubscribers) {
      unsubscribe()
    }

    this.#presenceUnsubscribers.length = 0
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
      // The status stays "connecting" until the relay proves it can hear this
      // device by echoing a heartbeat (ADR-0011).
      this.#startHeartbeat()
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
      this.#stopHeartbeat()
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
    this.#stopHeartbeat()

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

    const frame = parseRelayFrame(data)

    if (!frame) {
      this.#emitError(new Error('Relay sent a malformed frame'))
      return
    }

    if (this.#socket !== socket) {
      return
    }

    if (frame.t === 'heartbeat') {
      this.#healLink(socket)
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

  /**
   * A heartbeat echo proves the link is carrying frames. The device is online
   * again, and if the watchdog had declared the link dead, the whole book may
   * have been published into a link that was no longer listening, so publish
   * it again now that the link is proven.
   */
  #healLink(socket: SyncSocket): void {
    this.#heartbeatSentAt = null
    this.#setStatus('connected')

    if (!this.#republishPending) {
      return
    }

    this.#republishPending = false
    void this.#publishState(socket)
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat()
    this.#heartbeatTimer = setInterval(this.#heartbeatTick, this.#heartbeatIntervalMs)
    // Prove the link immediately, so "connected" means answered instead of
    // open, and a republish after a declared death does not wait a full
    // interval.
    this.#heartbeatTick()
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = null
    }

    this.#heartbeatSentAt = null
  }

  readonly #heartbeatTick = (): void => {
    const socket = this.#socket

    if (!socket || socket.readyState !== SOCKET_OPEN) {
      return
    }

    // A hidden page has its timers throttled and its link may be suspended by
    // the OS, so silence while hidden proves nothing. Becoming visible forces
    // a fresh connection anyway.
    if (this.#presence && !this.#presence.isVisible()) {
      return
    }

    if (this.#heartbeatSentAt !== null) {
      // One heartbeat is outstanding; give it the whole timeout to come back.
      if (Date.now() - this.#heartbeatSentAt >= this.#heartbeatTimeoutMs) {
        this.#concludeDeadLink()
      }

      return
    }

    this.#heartbeatSentAt = Date.now()

    try {
      socket.send(JSON.stringify(HEARTBEAT_FRAME))
    } catch (error) {
      this.#emitError(error)
      this.#concludeDeadLink()
    }
  }

  /** The socket looks open but heartbeats stopped crossing it (ADR-0011). */
  #concludeDeadLink(): void {
    this.#republishPending = true
    this.#forceReconnect()
  }

  readonly #handlePresenceChange = (): void => {
    this.#forceReconnect()
  }

  /** Drops the socket and dials again at once, skipping any reconnect backoff. */
  #forceReconnect(): void {
    if (this.#destroyed || !this.#shouldConnect) {
      return
    }

    this.#clearRetryTimer()
    this.#retryDelayMs = 0
    this.#closeSocket()
    this.#setStatus('disconnected')
    this.#openSocket()
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
