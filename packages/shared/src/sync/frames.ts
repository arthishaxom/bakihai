import { z } from 'zod'
import { type Bytes, toBase64Url } from '../bytes'

/**
 * Largest sealed update the relay accepts, in base64url characters. This
 * bounds what a hostile client can make the relay store per message.
 */
export const MAX_SEALED_UPDATE_CHARS = 8 * 1024 * 1024

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * A wire frame carrying an opaque sealed update. It holds the sealed bytes and
 * nothing else: no room, no type, no Entry fields. The relay can route and
 * store it without ever learning what is inside (ADR-0002).
 */
export const sealedUpdateFrameSchema = z.strictObject({
  t: z.literal('update'),
  d: z
    .string()
    .min(1)
    .max(MAX_SEALED_UPDATE_CHARS)
    .regex(BASE64URL_PATTERN, 'sealed payload must be unpadded base64url'),
})

export type SealedUpdateFrame = z.infer<typeof sealedUpdateFrameSchema>

/**
 * A liveness heartbeat. It carries no book data: the relay stores nothing and
 * echoes it to its sender, which is how a device tells a quiet link from a
 * dead one without acknowledging every update (ADR-0011).
 */
export const heartbeatFrameSchema = z.strictObject({
  t: z.literal('heartbeat'),
})

export type HeartbeatFrame = z.infer<typeof heartbeatFrameSchema>

/** The one heartbeat frame; devices send it and the relay echoes it back. */
export const HEARTBEAT_FRAME: HeartbeatFrame = { t: 'heartbeat' }

/** Any frame that travels between a device and the relay. */
export const relayFrameSchema = z.discriminatedUnion('t', [
  sealedUpdateFrameSchema,
  heartbeatFrameSchema,
])

export type RelayFrame = z.infer<typeof relayFrameSchema>

/** Wraps sealed update bytes as the frame sent over the wire. */
export function frameForSealedUpdate(sealed: Bytes): SealedUpdateFrame {
  return { t: 'update', d: toBase64Url(sealed) }
}

/**
 * Parses an untrusted wire frame, returning null for anything that is not a
 * well-formed update or heartbeat, so a hostile or broken client cannot crash
 * the relay or poison its log.
 */
export function parseRelayFrame(raw: string): RelayFrame | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = relayFrameSchema.safeParse(parsed)

  return result.success ? result.data : null
}

/** Parses a frame that must be a sealed update, returning null for anything else. */
export function parseSealedUpdateFrame(raw: string): SealedUpdateFrame | null {
  const frame = parseRelayFrame(raw)

  return frame?.t === 'update' ? frame : null
}
