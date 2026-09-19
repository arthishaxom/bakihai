# Loans close with a one-tap Settle, no close-out taxonomy

A Loan can be partially returned, and whatever remains closes with a single Settle action. Settle records a Return for the remaining quantity; when money changes hands as part of closing, a Settlement tagged to that Loan is written alongside and the item shows Settled. Over-return is rejected. There is deliberately no Forgive / Charge / Lost-broken classification: at this scale the distinction adds Entry variants and screens for something friends settle in conversation rather than in an app.

## Considered Options

- **Close-out reasons (forgive, lost, broken, charge at an agreed price)** — more faithful item history, but multiplies Entry types and UI for no accounting value.
- **Auto-FIFO allocation of payments to items** — rejected in ADR-0004 for guessing wrong.

## Consequences

The closing line does not distinguish a physical return from a write-off, so item history is approximate at the close. Money, when involved, stays exact through the tagged Settlement.
