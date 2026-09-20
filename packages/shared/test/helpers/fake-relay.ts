import { parseRelayFrame } from '../../src/sync/frames'
import type { SyncSocket, SyncSocketFactory } from '../../src/sync/provider'

/**
 * An in-memory stand-in for the relay and a browser WebSocket, for provider
 * tests. It mirrors the BookRoom: sealed updates are appended to a log and
 * fanned out to the other sockets, heartbeats are echoed to their sender, and
 * a new socket can be handed the backlog. It does not decrypt anything.
 */
export class FakeSocket implements SyncSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  readonly sent: string[] = []

  readonly #onSend: (frame: string) => void

  constructor(onSend: (frame: string) => void) {
    this.#onSend = onSend
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  receive(frame: string): void {
    if (this.readyState !== 1) {
      return
    }

    this.onmessage?.({ data: frame })
  }

  send(data: string): void {
    if (this.readyState !== 1) {
      throw new Error('Cannot send on a socket that is not open')
    }

    this.sent.push(data)
    this.#onSend(data)
  }

  close(): void {
    if (this.readyState === 3) {
      return
    }

    this.readyState = 3
    this.onclose?.()
  }
}

export interface FakeRelay {
  /** Pass to `BookSyncProvider` as `createSocket`. */
  createSocket: SyncSocketFactory
  /** Every sealed update clients sent, in arrival order. Heartbeats are echoed, never logged. */
  log: string[]
  /** Every socket the provider opened, in order. */
  sockets: FakeSocket[]
  /** Sends a frame to every open socket without appending to the log. */
  deliver(frame: string): void
  /**
   * Makes a socket look open while silently dropping every frame that would
   * cross it, like a phone link that died without closing. The provider cannot
   * see the loss except through its heartbeat watchdog (ADR-0011).
   */
  silence(socket: SyncSocket): void
}

export function createFakeRelay(): FakeRelay {
  const sockets: FakeSocket[] = []
  const log: string[] = []
  const silenced = new Set<SyncSocket>()

  return {
    log,
    sockets,
    silence: (socket) => {
      silenced.add(socket)
    },
    createSocket: () => {
      const socket = new FakeSocket((frame) => {
        if (silenced.has(socket)) {
          return
        }

        if (parseRelayFrame(frame)?.t === 'heartbeat') {
          // A real echo comes back a round trip later, not inside send().
          queueMicrotask(() => socket.receive(frame))
          return
        }

        log.push(frame)

        for (const other of sockets) {
          if (other !== socket && !silenced.has(other)) {
            other.receive(frame)
          }
        }
      })

      sockets.push(socket)
      queueMicrotask(() => socket.open())

      return socket
    },
    deliver: (frame) => {
      for (const socket of sockets) {
        if (!silenced.has(socket)) {
          socket.receive(frame)
        }
      }
    },
  }
}
