import { z } from 'zod'
import { type Bytes, toBase64Url } from '../bytes'

/**
 * Largest sealed update the relay accepts, in base64url characters. This
 * bounds what a hostile client can make the relay store per message.
 */
export const MAX_SEALED_UPDATE_CHARS = 8 * 1024 * 1024

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

/**
 * The wire frame between a device and the relay. It carries an opaque sealed
 * update and nothing else: no room, no type, no Entry fields. The relay can
 * route and store it without ever learning what is inside (ADR-0002).
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

/** Wraps sealed update bytes as the frame sent over the wire. */
export function frameForSealedUpdate(sealed: Bytes): SealedUpdateFrame {
  return { t: 'update', d: toBase64Url(sealed) }
}

/**
 * Parses an untrusted wire frame, returning null for anything that is not a
 * well-formed sealed update, so a hostile or broken client cannot crash the
 * relay or poison its log.
 */
export function parseSealedUpdateFrame(raw: string): SealedUpdateFrame | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = sealedUpdateFrameSchema.safeParse(parsed)

  return result.success ? result.data : null
}
