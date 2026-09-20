import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/bytes'
import {
  exportSigningPublicKey,
  generateSigningKeyPair,
  generateStorableSigningKeyPair,
  importSigningPrivateKey,
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

describe('stored device keys', () => {
  it('restores a stored private key that still signs for the same public key', async () => {
    const storable = await generateStorableSigningKeyPair()
    const restored = await importSigningPrivateKey(storable.privateKeyPkcs8)
    const message = utf8('entry bytes')
    const signature = await signBytes(restored, message)

    await expect(verifyBytes(storable.publicKey, signature, message)).resolves.toBe(true)
  })

  it('keeps the working private key non-extractable', async () => {
    const storable = await generateStorableSigningKeyPair()

    await expect(crypto.subtle.exportKey('pkcs8', storable.privateKey)).rejects.toThrow()
    await expect(
      importSigningPrivateKey(storable.privateKeyPkcs8).then((key) =>
        crypto.subtle.exportKey('pkcs8', key),
      ),
    ).rejects.toThrow()
  })

  it('rejects a malformed stored private key', async () => {
    await expect(importSigningPrivateKey('not+base64url')).rejects.toThrow()
    await expect(importSigningPrivateKey(toBase64Url(new Uint8Array(8)))).rejects.toThrow()
  })
})
