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

**Balance**:
The net position between two members, computed from all Entries. Never stored.
_Avoid_: dues, debt, outstanding

**Settled**:
An Expense or Loan whose cost is fully covered; a state computed from Entries, never stored.
_Avoid_: closed, completed, done

**Void**:
An Entry that cancels an earlier Entry while both remain in the book.
_Avoid_: delete, remove, cancel

**Archived**:
Hidden from the active view but still in the book.
_Avoid_: deleted, cleared
