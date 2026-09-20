import { describe, expect, it } from 'vitest'
import { toBase64Url, utf8Encode } from '../src/bytes'
import {
  buildInviteUrl,
  decodeInvite,
  encodeInvite,
  INVITE_VERSION,
  type Invite,
  inviteSchema,
  readInviteFromHash,
} from '../src/group/invite'

const GROUP_KEY = toBase64Url(new Uint8Array(32).fill(7))

function anInvite(overrides: Partial<Invite> = {}): Invite {
  return {
    v: INVITE_VERSION,
    room: '0f9c2a44-8f1b-4c1e-9d3a-7b2e5c9a1f00',
    relay: 'https://relay.bakihai.apothal.dev',
    key: GROUP_KEY,
    name: 'Flat 3B',
    ...overrides,
  }
}

function encodeRaw(value: unknown): string {
  return toBase64Url(utf8Encode(JSON.stringify(value)))
}

describe('invite links', () => {
  it('round-trips an invite through the encoded payload', () => {
    const invite = anInvite()

    expect(decodeInvite(encodeInvite(invite))).toEqual(invite)
  })

  it('builds a link whose fragment carries the Group secret, not the query', () => {
    const invite = anInvite()
    const url = buildInviteUrl('https://bakihai.apothal.dev', invite)
    const parsed = new URL(url)

    expect(parsed.origin).toBe('https://bakihai.apothal.dev')
    expect(parsed.pathname).toBe('/join')
    expect(parsed.search).toBe('')
    expect(parsed.hash).toMatch(/^#invite=[A-Za-z0-9_-]+$/)
    expect(readInviteFromHash(parsed.hash)).toEqual(invite)
  })

  it('reads an invite from a hash that carries other parameters too', () => {
    const invite = anInvite()
    const payload = encodeInvite(invite)

    expect(readInviteFromHash(`#before=1&invite=${payload}`)).toEqual(invite)
    expect(readInviteFromHash(`#invite=${payload}&after=2`)).toEqual(invite)
  })

  it('returns null when there is no invite in the hash', () => {
    expect(readInviteFromHash('')).toBeNull()
    expect(readInviteFromHash('#')).toBeNull()
    expect(readInviteFromHash('#other=abc')).toBeNull()
    expect(readInviteFromHash('#invite=')).toBeNull()
  })

  it('returns null for a malformed invite instead of throwing', () => {
    expect(readInviteFromHash('#invite=%%%not-base64%%%')).toBeNull()
    expect(readInviteFromHash(`#invite=${encodeRaw(anInvite({ v: 2 as 1 }))}`)).toBeNull()
  })

  it('rejects invites from another version', () => {
    const result = inviteSchema.safeParse({ ...anInvite(), v: 2 })

    expect(result.success).toBe(false)
    expect(() => decodeInvite(encodeRaw({ ...anInvite(), v: 2 }))).toThrow()
  })

  it('rejects a Group key that is not 32 bytes', () => {
    const shortKey = toBase64Url(new Uint8Array(31))

    expect(inviteSchema.safeParse(anInvite({ key: shortKey })).success).toBe(false)
    expect(() => decodeInvite(encodeRaw(anInvite({ key: shortKey })))).toThrow()
  })

  it('rejects a relay URL that is not an http(s) URL', () => {
    expect(inviteSchema.safeParse(anInvite({ relay: 'not-a-url' })).success).toBe(false)
    expect(inviteSchema.safeParse(anInvite({ relay: 'javascript:alert(1)' })).success).toBe(false)
  })

  it('rejects unnamed groups and unknown fields', () => {
    expect(inviteSchema.safeParse(anInvite({ name: '   ' })).success).toBe(false)
    expect(inviteSchema.safeParse({ ...anInvite(), extra: true }).success).toBe(false)
  })

  it('rejects payloads that are not a JSON invite', () => {
    expect(() => decodeInvite(encodeRaw('not an object'))).toThrow()
    expect(() => decodeInvite(toBase64Url(utf8Encode('{not json')))).toThrow()
    expect(() => decodeInvite('not+base64url')).toThrow()
  })
})
