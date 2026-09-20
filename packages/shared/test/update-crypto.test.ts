import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/bytes'
import { deriveGroupSubkey, generateGroupKey } from '../src/crypto/group-key'
import {
  BOOK_UPDATE_SUBKEY_PURPOSE,
  deriveBookUpdateKey,
  openBookUpdate,
  sealBookUpdate,
} from '../src/sync/update-crypto'

function updateBytes(fill = 7): Uint8Array<ArrayBuffer> {
  return new Uint8Array(64).fill(fill)
}

describe('sync update crypto', () => {
  it('round-trips a Yjs update under the Group sync subkey', async () => {
    const key = await deriveBookUpdateKey(generateGroupKey())
    const update = updateBytes(7)

    const sealed = await sealBookUpdate(key, update)

    expect(sealed).not.toEqual(update)
    await expect(openBookUpdate(key, sealed)).resolves.toEqual(update)
  })

  it('rejects a sealed update opened with another Group key', async () => {
    const key = await deriveBookUpdateKey(generateGroupKey())
    const otherKey = await deriveBookUpdateKey(generateGroupKey())
    const sealed = await sealBookUpdate(key, updateBytes())

    await expect(openBookUpdate(otherKey, sealed)).rejects.toThrow()
  })

  it('rejects a tampered sealed update', async () => {
    const key = await deriveBookUpdateKey(generateGroupKey())
    const sealed = await sealBookUpdate(key, updateBytes())
    const tampered = new Uint8Array(sealed)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff

    await expect(openBookUpdate(key, tampered)).rejects.toThrow()
  })

  it('derives a sync subkey separate from the Entry envelope subkey', async () => {
    const groupKey = generateGroupKey()
    const syncKey = await deriveBookUpdateKey(groupKey)
    const envelopeKey = await deriveGroupSubkey(groupKey, 'entry-envelope/v1')
    const sealed = await sealBookUpdate(syncKey, updateBytes())

    expect(BOOK_UPDATE_SUBKEY_PURPOSE).toBe('book-update/v1')
    await expect(openBookUpdate(envelopeKey, sealed)).rejects.toThrow()
    expect(toBase64Url(groupKey)).not.toBe('')
  })
})
