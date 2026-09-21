# A Settlement its receiver authored is already confirmed

A Settlement counts toward Balances the moment it is appended (ADR-0007). Confirmation exists so a receiver can attest to a claim they did not write: a Confirm Entry, authorable only by the receiver's device, marks it confirmed. When the receiver's own device authored the Settlement — "Rohan paid me", written by the receiver — there is nothing left to attest, so it starts confirmed. A Confirm naming a Voided Settlement is moot and ignored.

## Considered Options

- **Always require a separate Confirm** — asks the receiver to confirm a sentence they wrote themselves; an extra Entry that attests to nothing.
- **Only the payer may append a Settlement** — breaks ADR-0007's any-Member-appends and the offline case where the receiver records the payment they just received.
- **No confirmation at all** — rejected in ADR-0007; a disputed payment would be invisible.

## Consequences

The "to confirm" count only ever includes Settlements the receiver did not author. Anyone may still append a Settlement between any two Members, as a claim.
