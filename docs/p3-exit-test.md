# P3 exit test: a week on one phone

The P3 exit criterion is human: one person keeps the book for a group that never installed the app, and after a week the one-sided story still adds up. The automated suite rehearses the mechanics — the folds in `packages/shared/test`, two-phone convergence and the one-sided sheets in `apps/web/e2e`, and the forging harness — but only real days catch what a test cannot. Run this after the features in #23–#24 ship. The P2 group test cannot run (`docs/p2-exit-test.md` is superseded), so this is the only human test the group's real arrangement allows.

## Setup

- One phone keeps the book. The others never install it; every person you split with is added as a Shadow Member: Members → Add a person without the app.
- Add the two or three people you actually share costs with, under the names you use for them.
- Record one real Expense you paid for someone else, and one item Loan (eggs, rice, a book). The week's checks close them.
- Set your own UPI ID once from your row in Members. Shadow Members have none, by design.
- Pick this as the phone you carry; the last check walks its thumb through every one-sided sheet.

## Daily checks

- The Members list reads each Shadow Member as "No phone · Added by you", and your own row as "(you)".
- Every Expense or Loan you record with them moves a Balance or item state the moment you add it; nothing waits on another phone.
- The waiting count above Balances stays empty: in a one-sided book every Settlement is confirmed by the key that recorded it.
- The sync chip reads Online while connected, Connecting… while it reconnects, and Offline otherwise; nothing hangs or spins.
- Reopening the app — and restarting the phone — loses nothing.
- An Entry recorded in airplane mode reaches the relay once the phone is back online, with no forwarding or re-adding.

## End of the week

Run each check once, on this phone. If one fails: note the Entries involved, the order they were added, and file it on the ticket named with that section.

### Shadow Members and the add flow (#23)

- Add a person: Members → Add a person without the app → type a name → Add person. Their row appears with "No phone · Added by you", and no "Set UPI ID".
- Add a second person with a name already in the Group: the form warns "Someone named … is already in this Group" and adds them anyway when you submit. Archive the duplicate afterwards if it was a mistake.
- Open Add in all three modes: the person is offered in Paid by, in the participant pills, in the Loan form's Member select, and in the Settlement form's Member select.
- Archive them from their row: they leave every picker and group under Archived, while their Entries and any open Balance stay, marked "· Archived", with Settle up still working. Tap Unarchive and they return to every picker.
- With only yourself in the Group, the Loan and Settlement forms say "Add another Member before recording a Loan." / "…before recording a Settlement."

### Attestation by key (#24)

- Record a Settlement to them: Add → Settlement → I paid → pick them → amount. It reads "Confirmed by <your name>" from the start and never enters the waiting count.
- Record a Settlement from them: Add → Settlement → They paid me → pick them → amount. Same: confirmed from the start.
- Open a tagged Settlement to them (see Tags below) and check its detail sheet: no Confirm is offered, because the book already holds the receiver's side.
- A solo book cannot produce a claim another phone recorded, which is the one case that needs a Confirm on their behalf; the automated suite covers it (`shadow-members.spec.ts`, "a claim against a Shadow Member is confirmed by the holder"). What the week proves is the point of the rule: no phantom wait ever appears for a person with no phone.

### Expenses, Balances, and Settle up (#23)

- You paid for them: Add → Expense → amount, leaving them checked as a participant → Add expense. Their Balance shows "… owes You ₹…".
- They paid for you: Add → Expense, set Paid by to them, amount → Add expense. The Balance shows "You owe … ₹…".
- Settle up: from a Balance row, tap Settle up. The amount is prefilled with the whole net and the line says who is paying whom. Record it and the Balance clears; record a partial amount instead and the net falls by exactly that much.
- With you owing them, record "I paid …" from the Settlement form and watch the Balance fall; the row is confirmed on sight.

### Loans and Returns (#23)

- Lent to them: Add → Loan → Lent to → pick them → item → quantity → Add loan. The line reads "… lent 3 eggs to … · 3 left".
- Borrowed from them: the same form with Borrowed from. The line reads "… lent 1.5 kg rice to You · 1.5 kg left", and the Loan's detail sheet offers you the Return and Settle actions.
- Return part: open the Loan, type 1 under Quantity returned, tap Record return. The remainder drops on the line.
- Try to return more than remains: the form refuses and writes nothing.
- Close the rest: the Loan reads "· Settled" and stops being offered in the Settlement form's Tag picker.

### Tags and coverage (#23, #15)

- Open the unpaid Expense you set up: "What each Member owes the payer" lists the shares. Tap Settle ₹… on the Shadow Member's line, record part of the share, and the Expense reads "· ₹… of ₹… repaid".
- Record the rest of that share: the participant reads Settled, and the Expense follows when the last share is covered.
- Untagged: Add → Settlement with Tag left on None, so the form says it moves only the Balance. The Balance moves; no item's coverage changes.
- With Show hidden on, Void a tagged Settlement: the item's coverage reopens and the Balance it moved comes back.

### Void (#12)

- Open an Expense that moved a Balance, type a short Reason, tap Void entry. The Balance drops.
- With Show hidden off the struck-through line and its Void are both gone; turn it on and the line reads struck through with "Voided by … — …".
- Open a Void line and check it offers no Void action. A Member Entry has no line to open at all.

### Archive and Show hidden (#17)

- The filter chips All / Expenses / Loans / Payments narrow the list; pick one, close and reopen the app, and the same chip is still lit.
- Show hidden brings back Voided lines and Settled items past their deadline, with the Returns and tagged Settlements that belong to them. The Balances are identical either way.
- The 14-day deadline cannot pass inside one week; to see it, turn off automatic date & time, move the phone's date 15 days ahead, and close and reopen the app. Set the date back and reopen. Do not record anything while the date is ahead, or the Entry will carry a future timestamp.

### One-handed pass (#22)

- Hold the phone in one hand and use your thumb only: the Add-person sheet, Add in all three modes, Settle up, Return, Settle, Void, Show hidden, the filter chips, and the Members list.
- Check every button is at least a thumb wide, the page never scrolls sideways, and the sheets sit above the keyboard. Note the phone and anything awkward, and file it on the ticket that owns that sheet.

## The week's result

Report the result on #22: passing closes P3. Any disagreement, hang, or awkward action becomes a bug on the ticket named with that section — or on #22 when it spans several — with the Entries that produced it and the rough time.
