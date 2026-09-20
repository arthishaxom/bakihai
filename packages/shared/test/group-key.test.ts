import { describe, expect, it } from 'vitest'
import { decryptBytes, encryptBytes } from '../src/crypto/aead'
import { deriveGroupSubkey, GROUP_KEY_BYTES, generateGroupKey } from '../src/crypto/group-key'
import { ENTRY_ENVELOPE_SUBKEY_PURPOSE } from '../src/entry-envelope'

const utf8 = (value: string) => new TextEncoder().encode(value)

describe('group key', () => {
  it('generates 32 random bytes', () => {
    const first = generateGroupKey()
    const second = generateGroupKey()

    expect(first).toHaveLength(GROUP_KEY_BYTES)
    expect(first).not.toEqual(second)
  })

  it('derives the same subkey on every device', async () => {
    const groupKey = generateGroupKey()
    const [a, b] = await Promise.all([
      deriveGroupSubkey(groupKey, ENTRY_ENVELOPE_SUBKEY_PURPOSE),
      deriveGroupSubkey(groupKey, ENTRY_ENVELOPE_SUBKEY_PURPOSE),
    ])
    const sealed = await encryptBytes(utf8('shared secret'), a)

    await expect(decryptBytes(sealed, b)).resolves.toEqual(utf8('shared secret'))
  })

  it('separates subkeys by purpose', async () => {
    const groupKey = generateGroupKey()
    const [envelopeKey, otherKey] = await Promise.all([
      deriveGroupSubkey(groupKey, ENTRY_ENVELOPE_SUBKEY_PURPOSE),
      deriveGroupSubkey(groupKey, 'other-purpose/v1'),
    ])
    const sealed = await encryptBytes(utf8('shared secret'), envelopeKey)

    await expect(decryptBytes(sealed, otherKey)).rejects.toThrow()
  })

  it('separates subkeys by group key', async () => {
    const [keyA, keyB] = await Promise.all([
      deriveGroupSubkey(generateGroupKey(), ENTRY_ENVELOPE_SUBKEY_PURPOSE),
      deriveGroupSubkey(generateGroupKey(), ENTRY_ENVELOPE_SUBKEY_PURPOSE),
    ])
    const sealed = await encryptBytes(utf8('shared secret'), keyA)

    await expect(decryptBytes(sealed, keyB)).rejects.toThrow()
  })

  it('rejects a group key of the wrong length', async () => {
    await expect(
      deriveGroupSubkey(new Uint8Array(16), ENTRY_ENVELOPE_SUBKEY_PURPOSE),
    ).rejects.toThrow(TypeError)
  })

  it('rejects an empty purpose', async () => {
    await expect(deriveGroupSubkey(generateGroupKey(), '')).rejects.toThrow(TypeError)
  })
})
