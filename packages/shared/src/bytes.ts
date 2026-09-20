/** A byte sequence backed by an ArrayBuffer, the shape WebCrypto requires. */
export type Bytes = Uint8Array<ArrayBuffer>

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const BASE64URL_VALUES = new Map<string, number>(
  Array.from(BASE64URL_ALPHABET, (character, value) => [character, value]),
)

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Encodes bytes as unpadded base64url (RFC 4648 §5). */
export function toBase64Url(bytes: Uint8Array): string {
  let encoded = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]

    encoded += BASE64URL_ALPHABET.charAt(first >> 2)
    encoded += BASE64URL_ALPHABET.charAt(((first & 0x03) << 4) | ((second ?? 0) >> 4))
    if (second !== undefined) {
      encoded += BASE64URL_ALPHABET.charAt(((second & 0x0f) << 2) | ((third ?? 0) >> 6))
    }
    if (third !== undefined) {
      encoded += BASE64URL_ALPHABET.charAt(third & 0x3f)
    }
  }

  return encoded
}

/**
 * Decodes unpadded base64url, rejecting padding, non-alphabet characters, and
 * encodings whose trailing bits are not zero.
 */
export function fromBase64Url(text: string): Bytes {
  if (text.length % 4 === 1) {
    throw new Error('Invalid base64url length')
  }

  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4))
  let buffer = 0
  let bits = 0
  let index = 0

  for (const character of text) {
    const value = BASE64URL_VALUES.get(character)

    if (value === undefined) {
      throw new Error(`Invalid base64url character: ${character}`)
    }

    buffer = (buffer << 6) | value
    bits += 6

    if (bits >= 8) {
      bits -= 8
      bytes[index++] = (buffer >> bits) & 0xff
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error('Invalid base64url encoding')
  }

  return bytes
}

/** Encodes a string as UTF-8 bytes. */
export function utf8Encode(value: string): Bytes {
  return textEncoder.encode(value) as Bytes
}

/** Decodes UTF-8 bytes. */
export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes)
}
