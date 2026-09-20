# Sync updates are sealed before they reach the relay

The relay is a blind append-only mailbox: each device seals every Yjs update with an AES-256-GCM subkey derived from the Group key, sends it as an opaque `{t:'update',d}` frame, and the relay stores and broadcasts frames without ever holding a Group key. This was chosen over y-partyserver's stock Yjs protocol, in which the Durable Object parses and merges plaintext updates, because the relay and whoever hosts it must not be able to read amounts, names, or items (ADR-0002).

## Considered Options

- **Stock `YServer`/`YProvider` protocol** — least code, but the Durable Object would receive and store plaintext Yjs updates, so the relay could read the whole book.
- **Encrypt Entry payloads inside a plaintext Yjs document** — the relay would still see Entry ids, types, timing, and structure, and every local read would need decryption, which breaks the pure, synchronous fold (ADR-0004).
- **Custom encrypted transport over PartyServer's hibernating `Server`** — the chosen option: the relay keeps only opaque frames, while each device keeps a plaintext local book for instant reads and an order-independent fold.

## Consequences

A device publishes its whole book on every connection, so Entries written offline converge on the next connection and a frame lost to a dropped socket heals without an acknowledgement protocol. Yjs updates are idempotent and commutative, so duplicates and reordering are harmless, and a frame a device cannot decrypt is dropped without breaking the book. The relay's log grows by one snapshot per connection; compaction arrives with ADR-0005 in P3. The relay can still see timing, size, and count metadata, as ADR-0002 already states.
