# Fold sums saturate at the exact-integer ceiling

Amounts and quantities are integer paise and hundredths (ADR-0008), and every fold's arithmetic — a pair's net, a participant's tagged payments, a Loan's returned quantity — is exact and order-independent only while its sum stays inside the range JavaScript holds exactly. An Entry's own value is bounded by the schema, but the sum of valid Entries need not be: two crafted Expenses can each claim the largest amount the schema holds. A modified client can therefore hand every phone a sum no formatter can read, and the book screen — which formats fold outputs directly — fails to render instead of showing the book.

The folds saturate at `Number.MAX_SAFE_INTEGER` instead of leaving exact range. A non-negative sum adds with saturation, which is associative, so the same book still folds the same answer in any order; a Balance nets in both directions, where saturating step by step is not associative, so it adds exactly in BigInt and clamps once when it is emitted. An absurd book reads its sums as the ceiling; it never reads a number the app cannot hold, and no fold or screen breaks.

## Considered Options

- **Capping each Entry's amount at a sane maximum** — does not close the hole, because a pile of Entries at the cap still leaves exact range, and any cap is a domain decision the schema should not invent.
- **Making the screens tolerate unsafe numbers** — the fold's documented property is that it stays exact and order-independent; a formatter that guesses a decimal from a float hides that the arithmetic has already stopped being exact.
- **Saturating each addition inside a Balance's net** — saturation is not associative with mixed signs, so the same book could fold different Balances in different orders.

## Consequences

Fold outputs stay safe integers whatever the book holds, so the formatters keep their strict check and the screens keep rendering. A saturated sum is not the true total — an adversarial book is owed a total fold, not a truthful number — and the ceiling is far above any real amount or quantity, so honest books never reach it. This narrows ADR-0008's exactness promise in the adversarial case only: a sum that stays inside exact range is still exact, and one that leaves it reads as the ceiling rather than as a wrong number. New folds that sum amounts or quantities must saturate the same way; `addSaturating` and `clampToExactSum` in `packages/shared/src/group/totals.ts` are the sanctioned arithmetic for a sum.
