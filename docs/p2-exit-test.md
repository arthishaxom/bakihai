# P2 exit test: a week with the group's own phones

The P2 exit criterion is human: the group keeps using BakiHai on their own phones for a week and every phone tells the same story about Loans, Returns, Settlements, and Voids. The automated suite rehearses the mechanics — the folds in `packages/shared/test`, and two-phone convergence and the new sheets in `apps/web/e2e` — but only real days catch what a test cannot. Run this after the features in #12–#19 ship.

## Setup

- Everyone opens the app once while online so every phone is on the P2 version.
- Each Member sets their UPI ID once: tap your own name in Members, fill in the UPI ID and payee name, and save.
- Record one Loan of something real (3 eggs, a 1.5 kg bag of rice, a book) and one unpaid Expense with at least two participants. The week's checks close them.
- Pick the phone you carry most as the one-handed phone; the last check walks its thumb through every new sheet.

## Daily checks

- Every phone shows the same Members, Entries, and Balances whenever the app is opened.
- An Entry added on one phone reaches the others within seconds while everyone is online.
- An airplane-mode Entry reaches the others once that phone is back online, with no forwarding or re-adding.
- The sync chip reads Online while connected, Connecting… while it reconnects, and Offline otherwise; nothing hangs or spins.
- The waiting count above Balances matches the Settlements still needing a receiver's confirmation, and clears on every phone once the receiver confirms.
- Voided and Archived lines stay out of the list; Show hidden brings them back, and the Balances never change either way.
- Reopening the app — and restarting a phone — loses nothing.

## End of the week

Run each check once, on two phones unless it says otherwise. If one fails: note the phones, the Entries each shows or misses, the order they were added, and file it on the ticket named with that section.

### Loans and partial Returns (#13)

- Open the Loan you set up. It reads "… lent 3 eggs to … · 3 left". Return 1: type 1 under Quantity returned and tap Record return. Both phones now read "· 2 left".
- Try to return more than remains: type 99 and tap Record return. The form refuses with "Only 2 is left to return" and writes nothing.
- Record the remaining 2. Both phones read "· Settled", and the Loan stops being offered in the Settlement form's Tag picker.
- One-tap Settle with no money: record a second Loan, open it, leave Amount (₹, optional) blank, and tap Settle. A single Return line closes it, no Settlement is written, and the Balances do not move.
- Over-return race: record a Loan of 3 eggs. Put both phones in airplane mode and record a Return of 3 from each. Back online, both phones must read "· over-returned by 3" and agree. Voiding the two Returns afterwards puts the Loan back to "3 left".

### Settlements: claim, confirm, Settle up (#14)

- Claim: on the payer's phone, Add → Settlement → I paid → pick the receiver → amount → Add settlement. Both phones show "… paid … ₹…", the Balances move immediately, and every phone shows "1 Settlement waiting for confirmation" above Balances — only the receiver can clear it.
- Confirm: on the receiver's phone, open that Settlement and tap Confirm settlement. Its detail sheet reads "Confirmed by …" on every phone, the row's "Waiting for …" line and the count above Balances both disappear, and the Balance does not move again.
- Self-confirmed: on the receiver's phone, Add → Settlement → They paid me → pick the payer → amount. It reads "Confirmed by …" in its detail sheet from the start and never enters the waiting count on any phone.
- Offline: put one phone in airplane mode, record a Settlement from it, then bring it back online. Both phones must net it identically, with no other line moving.
- Settle up: on a phone that owes a Balance, tap Settle up. The amount is prefilled with the whole net and the line says who is paying whom. Change it to a smaller amount and record: both phones agree the net fell by exactly that much. The rest can be settled later; partial payments are normal.

### Tags: item states and Settle with money (#15)

- Loan settle with money: record a Loan of something that will end in money (a drill), open it, type an amount in Amount (₹, optional), check the direction pill naming who paid whom, and tap Settle with ₹…. One tap writes the closing Return plus a Settlement tagged to the Loan. Both phones show the Loan Settled, the tagged Settlement line, and a Balance moved by exactly that amount.
- Coverage: open the unpaid Expense. "What each Member owes the payer" lists one line per participant. Tap Settle ₹… on one, record part of that share, and both phones show the Expense as "· ₹… of ₹… repaid" with that participant as "… repaid ₹… of ₹…".
- Record the rest of that share: the participant reads "… Settled". When the last participant is covered, the Expense reads "· Settled".
- Untagged: Add → Settlement → leave Tag on None so the form says it moves only the Balance → record. The Balance moves; no item's coverage changes.
- Voiding a tagged Settlement reopens the item: with Show hidden on, open that Settlement, Void entry, and the item's coverage reopens on both phones while the Balance the Settlement moved comes back.

### Payment addresses and UPI (#16)

- Tap your own name in Members. Set or edit your UPI ID and payee name. The other phones show it next to your name, and an edit replaces the old ID everywhere.
- Pay a real amount: on the payer's phone, Add → Settlement → I paid → pick the receiver → amount and a short note → Add settlement. While it is unconfirmed, open it and tap Pay via UPI. Your UPI app opens with the receiver as payee, the amount, and the note prefilled. Check the payee and amount, then pay (or cancel).
- On the receiver's phone, the same Settlement offers Show QR: the QR carries the same payee and amount, ready for the payer to scan in person.
- A Member with no payment address offers no Pay via UPI and no QR: open a Settlement where they are the payee and check the sheet is just the plain record.

### Void (#12)

- Open an Expense that moved a Balance, one written by another phone. Type a short Reason, tap Void entry, and void it while that phone is in airplane mode. Bring the phone back online: the Balance it moved drops on every phone.
- With Show hidden off, the struck-through line and its Void are both gone from the list. Turn Show hidden on: the line is struck through with "Voided by … — …", and the Void line above it reads "… voided …".
- Open a Void line and check it offers no Void action. A Void never targets another Void, and a Member Entry has no line to open at all.

### Archive and Show hidden (#17)

- Tap the filter chips: All / Expenses / Loans / Payments narrow the list to that kind of line. Pick one, close and reopen the app: the same chip is still lit.
- Show hidden is off when the app opens. Turn it on: Voided lines come back struck through, and Settled items past their deadline reappear with the Returns and tagged Settlements that belong to them. Turn it off: they hide again. The Balances are identical either way.
- An open item never hides, however old it is.
- The 14-day deadline cannot pass inside one week, so to see it, use one phone only: once the day's Entries are done, turn off automatic date & time, move the phone's date 15 days ahead, and close and reopen the app. The Settled item and its Returns and tagged Settlements leave the list until Show hidden is on, and the Balances are unchanged. Set the date back, turn automatic time on, and reopen: the item is in the list again. Do not record anything while the date is ahead, or the Entry will carry a future timestamp.

### Archived Members (#18)

- Use a Member who is no longer taking part, or add a spare phone to the Group for the week and archive it at the end. From any phone, tap Archive on that Member's row.
- On every phone they leave the active Members list and every picker: open Add → Loan and Add → Settlement and check the dropdown.
- Their Entries stay in the book. If they had an open Balance, the row still shows it, marked "· Archived", and Settle up still works with them: record a payment and the net moves as usual.
- Tap Unarchive on the archived row: they return to the active list and every picker, and the marker stays in the book behind Show hidden.
- If that phone was wiped and joins again with the invite link, it arrives as a new Member while the archived one keeps its history and Balances.

### Invite for another Group (#19)

- On a spare phone or in a private browser window, create a second Group and copy its invite link. Open that link on a phone that already has this book: the phone stays in this Group's book and shows a one-line notice naming both Groups, with Dismiss. Dismiss it and check nothing about the book, Members, Balances, or identity changed.
- Open this Group's own invite link on a phone that already has the book: no notice, it just shows the book.

### One-handed pass (#11)

- Hold one phone in one hand and use your thumb only. Walk through: Add in all three modes; open an Entry and use Return, Settle, Confirm, and Void; Settle up from a Balance row; set your Payment address; Pay via UPI; Show QR; the filter chips and Show hidden.
- Check every button is at least a thumb wide, the page never scrolls sideways, the sheets sit above the keyboard, and nothing needs the second hand. Note the phone and anything awkward, and file it on the ticket that owns that sheet.

## The week's result

Report the result on #11: passing closes P2. Any disagreement, hang, or awkward action becomes a bug on the ticket named with that section — or on #11 when it spans several — with the sequence of Entries that produced it, the phones involved, and the rough time.
