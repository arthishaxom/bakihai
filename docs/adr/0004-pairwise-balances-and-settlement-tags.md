# Balances are pairwise; Settlements carry an optional tag

Balances are computed pairwise between members and shown without debt simplification. A Settlement may optionally reference the Expense or Loan it pays off; that tag powers the per-item "Settled" display but never changes the arithmetic — Balance remains the sum of all Entries.

## Considered Options

- **Net balance only** — less code, but the app cannot show "groceries cleared, chai still open".
- **Auto-FIFO allocation** — the app guesses oldest-first, which closes the wrong item and surprises users.
- **Debt simplification** — deliberately deferred: paying one member instead of another obscures who actually owed whom.

## Consequences

Item-level "Settled" status exists only for tagged Settlements; untagged payments reduce the Balance without changing item status.
