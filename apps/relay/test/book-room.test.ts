import type { Connection } from 'partyserver'
import { describe, expect, it, vi } from 'vitest'
import { BookRoom } from '../src/book-room'

interface SealedRow {
  seq: number
  sealed: string
}

function createSql() {
  const rows: SealedRow[] = []
  let nextSeq = 1

  return {
    rows,
    exec(query: string, ...values: unknown[]): SealedRow[] {
      const statement = query.replace(/\s+/g, ' ').trim().toUpperCase()

      if (statement.startsWith('CREATE TABLE')) {
        return []
      }

      if (statement.startsWith('INSERT')) {
        rows.push({ seq: nextSeq++, sealed: String(values[0]) })
        return []
      }

      if (statement.startsWith('SELECT')) {
        return [...rows]
      }

      throw new Error(`Unexpected SQL in test: ${query}`)
    },
  }
}

function createRoom() {
  const sql = createSql()
  const room = new BookRoom(
    {
      id: { name: 'group-1' },
      storage: { sql },
      getWebSockets: () => [],
    } as unknown as DurableObjectState,
    {} as never,
  )

  const broadcast = vi.fn()
  room.broadcast = broadcast

  return { room, sql, broadcast }
}

function createConnection(id: string) {
  const send = vi.fn()

  return { connection: { id, send } as unknown as Connection, send }
}

function frameFor(character: string): string {
  return JSON.stringify({ t: 'update', d: character.repeat(16) })
}

describe('BookRoom', () => {
  it('appends a valid frame and fans it out to the other connections', async () => {
    const { room, sql, broadcast } = createRoom()
    await room.onStart()
    const { connection } = createConnection('connection-a')
    const frame = frameFor('A')

    room.onMessage(connection, frame)

    expect(sql.rows).toEqual([{ seq: 1, sealed: 'A'.repeat(16) }])
    expect(broadcast).toHaveBeenCalledWith(frame, ['connection-a'])
  })

  it('replays the log in order to a connection as it arrives', async () => {
    const { room } = createRoom()
    await room.onStart()
    const { connection: author } = createConnection('author')

    room.onMessage(author, frameFor('A'))
    room.onMessage(author, frameFor('B'))

    const { connection: reader, send } = createConnection('reader')
    room.onConnect(reader)

    expect(send.mock.calls.map(([frame]) => frame)).toEqual([frameFor('A'), frameFor('B')])
  })

  it('echoes a heartbeat to its sender without storing or broadcasting it', async () => {
    const { room, sql, broadcast } = createRoom()
    await room.onStart()
    const { connection, send } = createConnection('connection-a')
    const heartbeat = JSON.stringify({ t: 'heartbeat' })

    room.onMessage(connection, heartbeat)

    expect(send.mock.calls.map(([frame]) => frame)).toEqual([heartbeat])
    expect(sql.rows).toEqual([])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('drops malformed, binary, and hostile frames without storing them', async () => {
    const { room, sql, broadcast } = createRoom()
    await room.onStart()
    const { connection } = createConnection('connection-a')
    const binary = new TextEncoder().encode(frameFor('A'))

    const hostile = [
      'not json at all',
      JSON.stringify({ t: 'nope', d: 'A'.repeat(16) }),
      JSON.stringify({ t: 'update' }),
      JSON.stringify({ t: 'update', d: 'A'.repeat(16), entry: 'dinner' }),
      JSON.stringify({ t: 'update', d: 'not base64url!' }),
      JSON.stringify({ t: 'update', d: '' }),
      JSON.stringify({ t: 'heartbeat', d: 'A'.repeat(16) }),
      JSON.stringify({ t: 'heartbeat', entry: 'dinner' }),
      binary,
    ]

    for (const message of hostile) {
      room.onMessage(connection, message)
    }

    expect(sql.rows).toEqual([])
    expect(broadcast).not.toHaveBeenCalled()
  })
})
