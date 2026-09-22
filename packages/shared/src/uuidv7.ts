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

/**
 * The millisecond timestamp a UUIDv7 carries in its first 48 bits: the sort
 * key that entry id order reads (ADR-0012, ADR-0020).
 */
export function uuidv7Timestamp(id: string): number {
  const timestamp = Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16)

  if (!Number.isSafeInteger(timestamp)) {
    throw new RangeError(`Not a UUIDv7: ${id}`)
  }

  return timestamp
}

/**
 * Mints a UUIDv7 that sorts after `id` whatever the clock says. For an Entry
 * that must outrank another by id order, not by when it was actually minted:
 * a Shadow Member's Entry after the Entry that binds its holder (ADR-0020).
 */
export function uuidv7After(id: string, now: number = Date.now()): string {
  return uuidv7(Math.max(now, uuidv7Timestamp(id) + 1))
}
