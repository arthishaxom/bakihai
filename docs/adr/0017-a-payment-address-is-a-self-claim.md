# A Payment address is a self-claim; the latest Entry by Entry id wins

A Payment address — a Member's UPI ID and payee name — is written as an Entry that names no Member: the address belongs to its author, folded from the Entry's `authorDeviceId`. One device therefore cannot set another Member's address, even by writing a payload that names them, because there is no field that could name them. Editing writes a new Entry rather than rewriting the old one (ADR-0005), and the fold keeps the latest live Entry by Entry id, so an edit replaces the address on every device while the history stays in the book. A Voided address Entry drops out, standing aside for the address it replaced, if any.

## Considered Options

- **A payload that names the owning Member, guarded at fold time** — the Settlement pattern, but it invents a way to name someone else in a claim that is only ever about yourself; attribution by author makes the guarantee structural.
- **Latest by `occurredAt`** — a device clock a modified client controls would decide whose address everyone pays; Entry ids come from the roster-bound author and settle the same way on every device (ADR-0012).
- **Addresses in a separate synced store** — another structure to encrypt, verify, and version, for a handful of strings the Entry envelope already carries.

## Consequences

A Member who never set an address simply has none, and the payer's device offers no Pay via UPI action for them. The `upi://pay` deep link and the QR come from one pure string (`buildUpiIntent`), so the QR always renders exactly the intent the link would have opened. On a Settlement, Pay via UPI is offered only to the payer's device — the receiver already has the money — while either party can show the same intent as a QR for an in-person scan, and both disappear once the receiver has confirmed the Settlement. The intent's payee is always the Settlement's receiver, whose folded address supplies `pa` and `pn`.
