const MAX_TIMESTAMP_MS = 2 ** 48 - 1

/**
 * Generates an RFC 9562 UUIDv7 from the device clock. The first 48 bits hold
 * the millisecond timestamp, so ids sort lexicographically by creation time;
 * the remaining 74 bits are random.
 */
export function uuidv7(now: number = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_TIMESTAMP_MS) {
    throw new RangeError(`Timestamp must be an integer between 0 and ${MAX_TIMESTAMP_MS}`)
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))

  let remaining = now
  for (let index = 5; index >= 0; index--) {
    bytes[index] = remaining % 256
    remaining = Math.floor(remaining / 256)
  }

  // Version 7 in the top nibble of byte 6, RFC 4122 variant in the top bits of byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
