import { describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/bytes'
import {
  frameForSealedUpdate,
  MAX_SEALED_UPDATE_CHARS,
  parseSealedUpdateFrame,
  sealedUpdateFrameSchema,
} from '../src/sync/frames'

describe('sealed update frames', () => {
  it('encodes sealed bytes as an opaque update frame', () => {
    const frame = frameForSealedUpdate(new Uint8Array([1, 2, 3]))

    expect(frame).toEqual({ t: 'update', d: 'AQID' })
    expect(parseSealedUpdateFrame(JSON.stringify(frame))).toEqual(frame)
  })

  it('returns null for anything that is not a valid frame', () => {
    const candidates: unknown[] = [
      'not json',
      null,
      [],
      JSON.stringify({ t: 'update' }),
      JSON.stringify({ t: 'other', d: 'AQID' }),
      JSON.stringify({ t: 'update', d: '' }),
      JSON.stringify({ t: 'update', d: 'not base64url!' }),
      JSON.stringify({ t: 'update', d: 'AQID', extra: true }),
    ]

    for (const candidate of candidates) {
      const raw = typeof candidate === 'string' ? candidate : JSON.stringify(candidate)
      expect(parseSealedUpdateFrame(raw)).toBeNull()
    }
  })

  it('rejects payloads larger than the relay accepts', () => {
    const oversized = 'A'.repeat(MAX_SEALED_UPDATE_CHARS + 1)

    expect(sealedUpdateFrameSchema.safeParse({ t: 'update', d: oversized }).success).toBe(false)
    expect(
      sealedUpdateFrameSchema.safeParse({ t: 'update', d: toBase64Url(new Uint8Array(32)) })
        .success,
    ).toBe(true)
  })
})
