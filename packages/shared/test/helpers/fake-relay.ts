import type { SyncSocket, SyncSocketFactory } from '../../src/sync/provider'

/**
 * An in-memory stand-in for the relay and a browser WebSocket, for provider
 * tests. It mirrors the BookRoom: every frame a client sends is appended to a
 * log and fanned out to the other sockets; a new socket can be handed the
 * backlog. It does not decrypt anything.
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
  /** Every frame clients sent, in arrival order. */
  log: string[]
  /** Every socket the provider opened, in order. */
  sockets: FakeSocket[]
  /** Sends a frame to every open socket without appending to the log. */
  deliver(frame: string): void
}

export function createFakeRelay(): FakeRelay {
  const sockets: FakeSocket[] = []
  const log: string[] = []

  return {
    log,
    sockets,
    createSocket: () => {
      const socket = new FakeSocket((frame) => {
        log.push(frame)

        for (const other of sockets) {
          if (other !== socket) {
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
        socket.receive(frame)
      }
    },
  }
}
