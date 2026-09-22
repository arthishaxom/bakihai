# The receiver's key attests, not the receiver's device id

A Settlement counts from the moment it is appended (ADR-0007), and ADR-0015 confirmed one "its receiver authored": the fold compared the author's device id with the Settlement's receiver. A Shadow Member (ADR-0020) has no device, and its key is held by the Member who added it, so under the id rule a Settlement to a shadow could never be confirmed by anyone and would sit in the waiting count forever. Attestation is therefore by the key the receiver's id is bound to: a Settlement is confirmed when authored by that key, and a Confirm Entry counts when authored by that key. For a Member whose own phone holds its key nothing changes; for a shadow the holder attests, because the holder is who signs.

## Considered Options

- **Keep the id rule** — leaves a claim no one can ever attest to, and the waiting count carries every payment the holder records to their own shadow for good.
- **Write Confirm Entries as the shadow** — satisfies the id rule by setting the author to the shadow's id, but the book then says a device that does not exist confirmed, where the truth is that the holder signed.
- **Attestation by the receiver's key** — chosen.

## Consequences

- The Confirm action belongs to the Member whose key binds the receiver's id; a Settlement the holder records to their own shadow starts confirmed.
- No phantom wait: a Settlement naming a shadow is never presented as the shadow's to confirm.
- If the holder's phone is wiped, attestation for their shadow ends with it: Settlements to the shadow still count toward the Balance, but stay unconfirmed. Recovery belongs to the deferred handover work (ADR-0020).
- A Member can attest only for their own id and the ids they added; their key binds nothing else.
