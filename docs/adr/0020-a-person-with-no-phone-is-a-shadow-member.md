# A person with no phone is a Shadow Member whose key another Member holds

A Member may keep the book for people who never install the app. The roster already binds each device id to the signing key of its first Member Entry (ADR-0012), and that key does not have to belong to the device the Entry names: an Entry for a fresh device id, signed with the adder's own key, binds the id to the adder and is admitted like any other. So a person with no phone is a **Shadow Member**: an ordinary `member` Entry, no new type and no payload marker, which any Member may append (ADR-0007). A shadow is found by folding the roster and seeing whose key the Member's id is bound to; the distinction is computed, never stored, so an older client reads the same Entry as a normal Member. The shadow's id is bound to the adder's key for good: only that phone can attest for it (ADR-0021), and that phone could also author Entries as the shadow — the UI never does.

## Considered Options

- **A marker in the Member payload or a new Entry type** — the payload schema is strict, so an older client would drop the Entry and hide the person, and every Balance naming them, until it updated; the marker is also self-reported, where the key the Entry is signed with already says who holds it.
- **A counterparty outside the roster** — a new Entry type recording a name for a non-roster device id, with `pairInRoster` and every picker widened to admit it. That contradicts ADR-0012's consequence that a counterparty the roster does not hold stays out of Balances, because no one can ever confirm a claim for them, and it invents a second identity path for names.
- **Only some Member may add one** — the model has no roles, and every Entry already rests on social trust (ADR-0007).

## Consequences

- Who is a shadow, and who holds its key, is a pure fold of the Entries: every device computes the same answer in any order.
- Duplicate display names are already allowed (ADR-0014); the adder's name on the row and the "No phone" marker disambiguate in the Members list.
- A shadow is archived and unarchived by the existing marker with ADR-0014's semantics: hidden from pickers, its Balance kept and settleable.
- The later-join story is deliberately deferred. A real phone cannot claim the shadow's id without a key handover, and a handover would be the first exception to ADR-0012's no-rebind. When the person installs the app, they join as a new Member and the shadow stays as its own history, to be settled and archived. Link, merge, and handover are Later work.
- If the adder's phone is wiped, no one can attest for the shadow again (ADR-0021). Its Entries, Balances, and the ability to settle them do not depend on that key.
