import { z } from 'zod'
import {
  fromBase64Url,
  isBase64UrlOfByteLength,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../bytes'
import { GROUP_KEY_BYTES } from '../crypto/group-key'

/** Invite payload version. Invites from other versions are rejected, not misread. */
export const INVITE_VERSION = 1

/** Longest Group name the app accepts. */
export const GROUP_NAME_MAX_LENGTH = 60

/** Path of the web app that opens an invite. Must match the router's join route. */
const JOIN_PATH = '/join'

/** Fragment key that carries the encoded invite: `#invite=<payload>`. */
const INVITE_HASH_KEY = 'invite'

function base64UrlOfByteLength(expectedBytes: number, label: string) {
  return z.string().refine((value) => isBase64UrlOfByteLength(value, expectedBytes), {
    message: `${label} must be ${expectedBytes} bytes encoded as unpadded base64url`,
  })
}

/** A relay is reachable over http(s) so the app can derive a WebSocket URL from it. */
function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol

    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Everything a second device needs to join the Group: the Group secret, the
 * relay room, and the relay URL (ADR-0002). The Group name rides along so the
 * join screen can name the book before any sync has happened.
 */
export const inviteSchema = z.strictObject({
  v: z.literal(INVITE_VERSION),
  room: z.string().min(1).max(128),
  relay: z.url().refine(isHttpUrl, { message: 'relay must be an http(s) URL' }),
  key: base64UrlOfByteLength(GROUP_KEY_BYTES, 'key'),
  name: z.string().trim().min(1).max(GROUP_NAME_MAX_LENGTH),
})

export type Invite = z.infer<typeof inviteSchema>

/** Encodes an invite as unpadded base64url so it can live in a URL fragment. */
export function encodeInvite(invite: Invite): string {
  return toBase64Url(utf8Encode(JSON.stringify(inviteSchema.parse(invite))))
}

/** Decodes an invite payload, throwing on anything malformed or from another version. */
export function decodeInvite(encoded: string): Invite {
  const parsed: unknown = JSON.parse(utf8Decode(fromBase64Url(encoded)))

  return inviteSchema.parse(parsed)
}

/**
 * Builds the link a Member shares: `/join#invite=<payload>`. The payload stays
 * in the fragment, which browsers never send to the host, so the Group key
 * does not reach the web server or anything in between.
 */
export function buildInviteUrl(origin: string, invite: Invite): string {
  return `${origin}${JOIN_PATH}#${INVITE_HASH_KEY}=${encodeInvite(invite)}`
}

/**
 * Reads an invite from a location hash, returning null when the hash holds no
 * invite or holds one this app version cannot read, so a bad link shows a
 * message instead of breaking the page.
 */
export function readInviteFromHash(hash: string): Invite | null {
  const encoded = new URLSearchParams(hash.replace(/^#/, '')).get(INVITE_HASH_KEY)

  if (!encoded) {
    return null
  }

  try {
    return decodeInvite(encoded)
  } catch {
    return null
  }
}
