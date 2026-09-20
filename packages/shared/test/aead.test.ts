import { describe, expect, it } from 'vitest'
import { AEAD_IV_BYTES, decryptBytes, encryptBytes } from '../src/crypto/aead'

const utf8 = (value: string) => new TextEncoder().encode(value)

function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]) as Promise<CryptoKey>
}

describe('AES-256-GCM envelope encryption', () => {
  it('round-trips arbitrary bytes', async () => {
    const key = await generateAesKey()
    const plaintext = utf8('an entry that should stay private')
    const sealed = await encryptBytes(plaintext, key)

    await expect(decryptBytes(sealed, key)).resolves.toEqual(plaintext)
  })

  it('prefixes a fresh 12-byte IV', async () => {
    const key = await generateAesKey()
    const plaintext = utf8('same plaintext')
    const [first, second] = await Promise.all([
      encryptBytes(plaintext, key),
      encryptBytes(plaintext, key),
    ])

    expect(first).toHaveLength(AEAD_IV_BYTES + plaintext.length + 16)
    expect(second).not.toEqual(first)
    await expect(decryptBytes(first, key)).resolves.toEqual(plaintext)
    await expect(decryptBytes(second, key)).resolves.toEqual(plaintext)
  })

  it('rejects a tampered ciphertext', async () => {
    const key = await generateAesKey()
    const sealed = await encryptBytes(utf8('an entry'), key)
    const tampered = Uint8Array.from(sealed)
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff

    await expect(decryptBytes(tampered, key)).rejects.toThrow()
  })

  it('rejects a tampered IV', async () => {
    const key = await generateAesKey()
    const sealed = await encryptBytes(utf8('an entry'), key)
    const tampered = Uint8Array.from(sealed)
    tampered[0] = (tampered[0] ?? 0) ^ 0xff

    await expect(decryptBytes(tampered, key)).rejects.toThrow()
  })

  it('rejects a different key', async () => {
    const [key, otherKey] = await Promise.all([generateAesKey(), generateAesKey()])
    const sealed = await encryptBytes(utf8('an entry'), key)

    await expect(decryptBytes(sealed, otherKey)).rejects.toThrow()
  })

  it('rejects input shorter than the IV', async () => {
    const key = await generateAesKey()

    await expect(decryptBytes(new Uint8Array(4), key)).rejects.toThrow()
  })
})
