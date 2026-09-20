import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/bytes'
import {
  exportSigningPublicKey,
  generateSigningKeyPair,
  importSigningPublicKey,
  signBytes,
  verifyBytes,
} from '../src/crypto/ed25519'

const utf8 = (value: string) => new TextEncoder().encode(value)

describe('device signing keys', () => {
  it('signs a message that verifies with the device public key', async () => {
    const pair = await generateSigningKeyPair()
    const message = utf8('entry bytes')
    const signature = await signBytes(pair.privateKey, message)

    expect(signature).toHaveLength(64)
    await expect(verifyBytes(pair.publicKey, signature, message)).resolves.toBe(true)
  })

  it('rejects a message that changed after signing', async () => {
    const pair = await generateSigningKeyPair()
    const signature = await signBytes(pair.privateKey, utf8('original'))

    await expect(verifyBytes(pair.publicKey, signature, utf8('tampered'))).resolves.toBe(false)
  })

  it('rejects a signature from another device', async () => {
    const [alice, mallory] = await Promise.all([generateSigningKeyPair(), generateSigningKeyPair()])
    const message = utf8('entry bytes')
    const signature = await signBytes(mallory.privateKey, message)

    await expect(verifyBytes(alice.publicKey, signature, message)).resolves.toBe(false)
  })

  it('exports the raw public key as 43 base64url characters', async () => {
    const pair = await generateSigningKeyPair()

    expect(await exportSigningPublicKey(pair.publicKey)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('re-imports an exported public key', async () => {
    const pair = await generateSigningKeyPair()
    const imported = await importSigningPublicKey(await exportSigningPublicKey(pair.publicKey))
    const message = utf8('entry bytes')
    const signature = await signBytes(pair.privateKey, message)

    await expect(verifyBytes(imported, signature, message)).resolves.toBe(true)
  })

  it('rejects a malformed public key', async () => {
    await expect(importSigningPublicKey('not+base64url')).rejects.toThrow()
    await expect(importSigningPublicKey(toBase64Url(new Uint8Array(31)))).rejects.toThrow()
  })
})
