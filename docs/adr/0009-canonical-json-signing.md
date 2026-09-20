# Signatures cover a canonical JSON serialization

An Entry's Ed25519 signature commits to a canonical byte form of its unsigned envelope fields, not to the JSON text as built in memory: object keys sorted by UTF-16 code unit at every depth, array order preserved, strings and numbers serialized as `JSON.stringify` does. Values JSON cannot represent — `undefined`, functions, symbols, bigints, non-finite numbers, non-plain objects, sparse arrays — are rejected rather than silently dropped, so the bytes signed are always exactly the values the caller sees.

## Considered Options

- **Sign a handwritten field order** — smaller to start, but every new Entry type and payload field must be threaded through the signer; a forgotten field signs an Entry that is not what it claims.
- **JCS (RFC 8785)** — a standard canonical form, but its number-normalization rules buy nothing here: no peer implementation exists outside our own devices, and the relay never re-serializes Entries.
- **Sign the raw JSON text** — depends on property order and whitespace, which different devices and transports do not preserve.

## Consequences

The canonical form is frozen for `schemaVersion` 1: changing key sorting or number formatting would invalidate every stored signature and needs a version bump. The signature covers `id`, `schemaVersion`, `authorDeviceId`, `signerPublicKey`, `occurredAt`, `type`, and `payload`, but not the key-to-device binding; that check needs the Group roster.
