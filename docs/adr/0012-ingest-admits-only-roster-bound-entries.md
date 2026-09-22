# Ingest admits an Entry only when the roster binds its author to its signing key

The book is untrusted input: any Member holds the Group key and can write any JSON into the shared Yjs map, whether by bug or by a modified client. Every read therefore passes the book through one ingest before a fold or a screen sees it, in two halves. The shared package owns shape and roster: `readEntries` drops values that are not well-formed Entry envelopes, or that sit under a map key that is not the Entry's own id (which is how one Entry could otherwise be counted twice), and `admitEntries` drops Entries whose `authorDeviceId` is not bound to their `signerPublicKey` by the folded roster — a device's first Member Entry, ordered by Entry id and not by the free-form `occurredAt`, fixes that id to that key, and no later claim can rebind it. The web app owns signatures, because WebCrypto is asynchronous: `useVerifiedEntries` drops envelopes whose signature does not match their contents or their claimed key before the accepted set reaches `admitEntries` or any fold. Rejected Entries are ignored, never misread.

## Considered Options

- **Trust the map and let each fold defend itself** — every fold and screen would need its own validation, and one missed guard either crashes the app or counts a forged Entry.
- **Delete rejected Entries from the book** — a modified client can re-add them, deletion is the kind of rewrite an append-only book avoids, and the churn would sync forever.
- **Latest Member Entry wins the key binding** — a Member could take over another Member's device id by writing a later claim under their own key, silently rewriting who authored history.

## Consequences

A Member Entry whose payload this app version cannot read leaves its device unbound, so that device's Entries stay invisible until a version that understands it arrives — the cost of never misreading. Device clocks order display only: bindings settle by Entry id, and Balances never read `occurredAt`. An unbound device id is not a Member: an Entry that names one stays in the book and reads in the ledger, but the screens leave it out of the Balances and out of the waiting count beside them, because a counterparty the roster does not hold can never confirm a claim. That narrows ADR-0018's place in the count to Members. A determined Member can still backdate a new Entry id to race a device id they have already seen; ADR-0007's social trust covers that, and what cannot happen is a silent rebind or rewrite of an already-bound id.
