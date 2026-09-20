# The device signing key lives in IndexedDB as a non-extractable CryptoKey

A device's Ed25519 signing key is generated as a `CryptoKey`, kept in IndexedDB, and used directly to sign Entries, so its bytes never exist at rest on the device: a script that reads local storage finds no private key to copy. The identity record in `localStorage` keeps only what is needed to find the Group and the key. Installs made before this change stored the key as PKCS8; the first use imports it, writes the live key to IndexedDB, and drops the PKCS8 field from the stored identity.

## Considered Options

- **PKCS8 in `localStorage`** — simplest, but any script on the origin can copy the key out and sign Entries as this Member forever, and the copy outlives the device.
- **Passphrase-wrapped key** — real protection for a copied blob, at the cost of a secret the group must manage; out of scope for a friends' book with no accounts (ADR-0002).
- **Non-extractable key in IndexedDB** — the key can sign but cannot be exported, and IndexedDB is origin-scoped and cleared with site data, so the device itself is the credential.

## Consequences

`indexedDB` must be usable to create or join a Group; a browser without it falls back to the old PKCS8 storage so the app still works, and a legacy key is migrated the first time the device signs. Clearing site data loses the key, and the device rejoins from an invite link as a new Member.
