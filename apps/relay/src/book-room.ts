import { parseSealedUpdateFrame, type SealedUpdateFrame } from '@bakihai/shared'
import { type Connection, Server, type WSMessage } from 'partyserver'

interface SealedUpdateRow extends Record<string, SqlStorageValue> {
  sealed: string
}

/**
 * One Group's blind mailbox.
 *
 * The room is an append-only log of sealed Yjs updates stored in the Durable
 * Object's own SQLite database. It replays the log to every connection as it
 * arrives, appends every valid frame it receives, and fans those frames out to
 * the other connections. It never holds a Group key, so it cannot read an
 * Entry, an amount, or a name: an invalid or hostile frame is simply dropped
 * (ADR-0002).
 *
 * Hibernation is on, so the room costs nothing while nobody is connected.
 */
export class BookRoom extends Server {
  static override options = { hibernate: true }

  override async onStart(): Promise<void> {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS sealed_updates (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        sealed TEXT NOT NULL
      )
    `)
  }

  override onConnect(connection: Connection): void {
    for (const frame of this.#backlog()) {
      connection.send(JSON.stringify(frame))
    }
  }

  override onMessage(connection: Connection, message: WSMessage): void {
    if (typeof message !== 'string') {
      return
    }

    const frame = parseSealedUpdateFrame(message)

    if (!frame) {
      return
    }

    this.ctx.storage.sql.exec('INSERT INTO sealed_updates (sealed) VALUES (?)', frame.d)
    this.broadcast(JSON.stringify(frame), [connection.id])
  }

  #backlog(): SealedUpdateFrame[] {
    const rows = this.ctx.storage.sql.exec<SealedUpdateRow>(
      'SELECT sealed FROM sealed_updates ORDER BY seq',
    )

    return [...rows].map((row) => ({ t: 'update', d: row.sealed }))
  }
}
