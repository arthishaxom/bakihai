# BakiHai

BakiHai is a shared book for a small group of friends that tracks who owes what — in money and in borrowed items — with every phone holding the full book.

## Language

**Group**:
The set of members who share one book.
_Avoid_: circle, room, account

**Member**:
A person in a Group, identified on their phone by a device key.
_Avoid_: user, friend, contact

**Entry**:
A single immutable line in the book, recording something that happened.
_Avoid_: transaction, record, row

**Expense**:
An Entry where one member paid and one or more members share the cost.
_Avoid_: bill, split, payment

**Loan**:
An Entry recording that a member took a quantity of an item from another member. It can be partially returned.
_Avoid_: borrow, debt, item expense

**Return**:
An Entry recording that some quantity of a Loan's item was given back.
_Avoid_: repayment, give-back

**Settlement**:
An Entry recording a real-world payment from one member to another, optionally attached to the Expense or Loan it settles.
_Avoid_: payment, transfer, transaction

**Tag**:
The optional reference a Settlement carries to the Expense or Loan it pays off. It powers item coverage and never changes the Balance arithmetic.
_Avoid_: link, label, category

**Confirm**:
An Entry where a Settlement's receiver attests to a payment they did not record themselves.
_Avoid_: approve, accept

**Payment address**:
A member's UPI ID and payee name, claimed by their own device, used to pay them.
_Avoid_: bank details, account

**Balance**:
The net position between two members, computed from all Entries. Never stored.
_Avoid_: dues, debt, outstanding

**Coverage**:
The part of an Expense's shares that tagged payments to the payer have covered; computed, never stored.
_Avoid_: progress, repayment

**Settled**:
An Expense whose every owed share tagged payments cover, or a Loan with nothing left outstanding; a state computed from Entries, never stored.
_Avoid_: closed, completed, done

**Over-returned**:
A Loan whose Returns together exceed its quantity; the fold clamps the remainder at zero and marks how far past it went.
_Avoid_: negative remaining, excess return

**Void**:
An Entry that cancels an earlier Entry while both remain in the book.
_Avoid_: delete, remove, cancel

**Archived**:
Hidden from the active view but still in the book. A Settled Expense or Loan archives 14 days after it became Settled, the deadline computed from the Entries and never stored.
_Avoid_: deleted, cleared, removed
