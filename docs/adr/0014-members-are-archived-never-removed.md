# A Member whose device is gone is archived, never removed

A Member whose device is gone — cleared site data, lost phone — is marked by an Archived Member Entry (`member-archived`) that any Member may append. The Roster hides the Member from the active list and every picker, but their Entries and Balances stay exactly as they were: a nonzero Balance remains visible, marked archived, and remains settleable. The marker is itself Voidable if it was written by mistake. Member Entries are never Voided: the roster's device-to-key binding is the device's first Member Entry by Entry id (ADR-0012), so making Member Entries voidable would let a later key rebind a device id whose claim was voided — an identity takeover. Rejoining after a wipe creates a new device id; the old one stays frozen.

## Considered Options

- **Void the Member Entry** — removes the ghost, but unfreezes the device id for rebinding; a cleanup becomes an impersonation path.
- **Remove the Member from the roster without an Entry** — the roster is a pure fold of the Entries (ADR-0001); device-local removal diverges every phone.
- **Do nothing; document the rejoin** — ghosts accumulate, names collide, and the group cannot say "that phone is gone".
- **Succession: a new device inherits the old identity** — needs the old private key or accounts; both are out of scope.

## Consequences

Two Members can share a display name until the old one is archived. Archiving changes visibility only: history, Balances, and the ability to settle them are untouched. Key rotation and member removal stay Later work.
