# Money is integer paise, one currency (INR) per Group

All amounts are stored as integer paise, never as rupees or floats: floating point cannot represent decimals exactly and long sums drift, while integer minor units keep Balances exact and equal splits deterministic — a ₹100 split three ways is 3333 + 3333 + 3334 paise. The UI accepts and displays rupees with up to two decimals; paise are never typed. Splits distribute any remainder largest-first with a stable tie-break, so every device folds identical numbers. One currency per Group, INR for now.

## Considered Options

- **Decimal strings with a decimal library** — exact too, but drags a math dependency through every reducer and serialisation path.
- **Floats** — silent drift; rejected outright.
- **Multi-currency Entries now** — real complexity (rates, grouping) with no user yet.

## Consequences

Supporting a currency with a different number of decimals later needs a per-Group currency and minor-unit scale. UPI amounts map 1:1 onto paise. Long sums stay exact while they fit JavaScript's exact-integer range; a book that leaves it saturates at the ceiling rather than folding a wrong number (ADR-0019).
