# Item coverage counts tagged Settlements immediately, clamped per share

An Expense's coverage is computed from the live Settlements tagged to it: only a payment from a participant to the payer covers that participant's share, each share is covered up to its own paise, and the Expense reads Settled once every participant who owes the payer is covered. A claim covers from the moment it is appended, exactly as it counts toward the Balance (ADR-0007); a Confirm changes who is named as attesting, not what the item reads. A Voided tagged Settlement reopens the part of the coverage it had paid (ADR-0005), and a Voided Expense leaves the fold with its coverage. Untagged payments, and payments tagged to something else or in the other direction, move the Balance and never touch item state (ADR-0004). A Loan does not need coverage from tags: it is Settled when its Returns zero out its quantity (ADR-0006), and a tagged Settlement written alongside its closing Return records the money that moved.

## Considered Options

- **Coverage waits for the receiver's Confirm** — item state would lag the Balance by a Confirm, so one phone could show money counted while the item still read open; disputes already have a visible path in Void.
- **Over-coverage credits the payer** — an item would need an overpaid marker and a place to carry the excess; the Balance already carries the extra money, and clamping keeps the item's Settled state a boolean.
- **FIFO allocation across items** — rejected in ADR-0004: the app never guesses which item a payment closes.

## Consequences

A tagged payment can read as covering an item while its confirmation is still pending; if it is disputed, Voiding it reopens the item for everyone. Coverage is a pure fold over admitted Entries, so every device computes the same item states in any order, and money paid past a share shows in the Balance rather than in the item.
