import type { ExpenseState } from './expenses'
import type { LoanState } from './loans'
import type { SettlementState } from './settlements'

/** How many days a Settled item stays in the active list before it archives (ADR-0005). */
export const SETTLED_ARCHIVE_AFTER_DAYS = 14

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Whether a Settled item has left the active list by `now`: 14 days after the
 * instant it became Settled, and never before. An item with no settled instant
 * — one that is still open — never archives, at any age. The deadline is
 * computed on every device and never stored, and it takes `now` explicitly so
 * that every device agrees and tests can move the clock (ADR-0005). An
 * unreadable clock reading on the Entry never hides a line either: an Entry
 * with a broken `occurredAt` stays visible rather than disappearing on a guess.
 */
export function hasArchived(settledAt: string | undefined, now: Date): boolean {
  if (settledAt === undefined) {
    return false
  }

  const settled = Date.parse(settledAt)

  return (
    Number.isFinite(settled) &&
    now.getTime() - settled >= SETTLED_ARCHIVE_AFTER_DAYS * MILLISECONDS_PER_DAY
  )
}

/** The folds the archive decision reads, and the instant it decides at. */
export interface ArchiveView {
  expenses: ExpenseState[]
  loans: LoanState[]
  settlements: SettlementState[]
  now: Date
}

/**
 * The Entry ids the active Entries list hides as Archived: every Settled Expense
 * or Loan past its deadline, and the lines that belong to it. A Return belongs
 * to its Loan, a Settlement tagged to an item belongs to that item, and a
 * Confirm belongs to the Settlement it attests to — so each leaves the active
 * list with the item it is part of, and none of them is ever deleted (ADR-0005).
 *
 * A Settlement with no tag belongs to no item and never archives on its own: an
 * untagged Settlement is a self-contained record of money that moved, and it
 * keeps counting toward Balances whether or not anything around it is hidden. A
 * Void pair is hidden by the Void rule, not this one, and Balances never read
 * this set at all — hiding changes what the book shows, never what it says.
 */
export function archivedEntryIds(view: ArchiveView): Set<string> {
  const archivedExpenses = new Set(
    view.expenses
      .filter((expense) => hasArchived(expense.settledAt, view.now))
      .map((expense) => expense.expenseEntryId),
  )
  const archivedLoans = new Set(
    view.loans
      .filter((loan) => hasArchived(loan.settledAt, view.now))
      .map((loan) => loan.loanEntryId),
  )
  const archived = new Set([...archivedExpenses, ...archivedLoans])

  for (const loan of view.loans) {
    if (!archivedLoans.has(loan.loanEntryId)) {
      continue
    }

    for (const returned of loan.returns) {
      archived.add(returned.entry.id)
    }
  }

  for (const settlement of view.settlements) {
    const tag = settlement.tag

    if (tag === undefined) {
      continue
    }

    const itemArchived =
      tag.kind === 'expense' ? archivedExpenses.has(tag.entryId) : archivedLoans.has(tag.entryId)

    if (!itemArchived) {
      continue
    }

    archived.add(settlement.settlementEntryId)

    if (settlement.confirmation !== undefined) {
      archived.add(settlement.confirmation.id)
    }
  }

  return archived
}
