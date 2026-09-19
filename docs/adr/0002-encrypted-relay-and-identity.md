# Relay is a blind mailbox; identity is an invite link plus device keys

Sync runs through a small relay on Cloudflare Workers + Durable Objects (free plan) that holds only encrypted blobs and never sees Entry contents, and identity is an invite link carrying the group secret plus a per-device keypair that signs each Entry. There are no accounts, passwords, or emails.

## Considered Options

- **Self-hosted VPS** — the same relay, but a monthly cost with no added capability.
- **Managed sync vendors (InstantDB, Firebase, Supabase)** — less code to write, but data sits readable in a vendor's cloud and creates lock-in.
- **Password / OTP accounts** — more build work and more attack surface for a closed friend group.

## Consequences

The relay sees timing, size, and count metadata but not contents. A removed member can still read envelopes they already downloaded; key rotation only protects Entries created after the rotation.
