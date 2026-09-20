import { type Bytes, utf8Encode } from './bytes'

/**
 * Serializes a JSON value into bytes deterministically: object keys are sorted
 * by UTF-16 code unit at every depth and array order is preserved. Signatures
 * are computed over these bytes, so the same value always produces the same
 * bytes on every device.
 *
 * Values JSON cannot represent (undefined, functions, symbols, bigints,
 * non-finite numbers, Date/Map/class instances) are rejected rather than
 * silently dropped, because dropping them would sign different content than
 * the caller sees.
 */
export function canonicalJsonBytes(value: unknown): Bytes {
  return utf8Encode(canonicalJson(value))
}

/** The string form of {@link canonicalJsonBytes}. */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  switch (typeof value) {
    case 'boolean': {
      return JSON.stringify(value)
    }
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new TypeError('Cannot canonicalize a non-finite number')
      }
      return JSON.stringify(value)
    }
    case 'string': {
      return JSON.stringify(value)
    }
    case 'object': {
      return canonicalObject(value as Record<string, unknown>)
    }
    default: {
      throw new TypeError(`Cannot canonicalize a ${typeof value}`)
    }
  }
}

function canonicalObject(value: Record<string, unknown>): string {
  if (Array.isArray(value)) {
    return canonicalArray(value)
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Cannot canonicalize a non-plain object')
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError('Cannot canonicalize symbol keys')
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)

  return `{${entries.join(',')}}`
}

function canonicalArray(value: unknown[]): string {
  const items: string[] = []

  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) {
      throw new TypeError('Cannot canonicalize a sparse array')
    }
    items.push(canonicalJson(value[index]))
  }

  return `[${items.join(',')}]`
}
