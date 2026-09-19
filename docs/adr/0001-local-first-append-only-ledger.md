# Local-first append-only ledger instead of a central database

BakiHai stores its data as an append-only log of immutable Entries, replicated in full on every member's phone, with a relay that only brokers sync and never owns the data. This was chosen over a central CRUD database because members must read and write offline, simultaneous offline edits must merge without silently losing data, and no host or member should be able to rewrite history.

## Considered Options

- **Central CRUD database** — simplest to build, but the server owns the data, offline writes require a queue, and two edits to the same record resolve to last-write-wins (silent data loss).
- **Share-link / file sync only** — correct merge semantics, but every change needs a manual courier and there is no backup.
- **Peer-to-peer sync** — no server, but phones are rarely online simultaneously and mobile browsers suspend background work.

## Consequences

Balances are computed by replaying the log rather than stored, and the log is periodically compacted (see ADR-0005).
