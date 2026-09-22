import {
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  LOAN_ENTRY_TYPE,
  RETURN_ENTRY_TYPE,
  SETTLEMENT_CONFIRM_ENTRY_TYPE,
  SETTLEMENT_ENTRY_TYPE,
  VOID_ENTRY_TYPE,
} from '@bakihai/shared'

/** The Entries list's filter chips, in the order they read. */
export const LEDGER_FILTERS = ['all', 'expenses', 'loans', 'payments'] as const

export type LedgerFilter = (typeof LEDGER_FILTERS)[number]

/** The label each chip carries. */
export const LEDGER_FILTER_LABELS: Record<LedgerFilter, string> = {
  all: 'All',
  expenses: 'Expenses',
  loans: 'Loans',
  payments: 'Payments',
}

/**
 * The Entry types each chip narrows to. A Return reads under Loans and a
 * Confirm under Payments, because that is the kind of line each is. A Void is
 * none of the three, so it reads under All alone — though its stub is never
 * visible without Show hidden anyway.
 */
const ENTRY_TYPES_BY_FILTER: Record<Exclude<LedgerFilter, 'all'>, readonly string[]> = {
  expenses: [EXPENSE_ENTRY_TYPE],
  loans: [LOAN_ENTRY_TYPE, RETURN_ENTRY_TYPE],
  payments: [SETTLEMENT_ENTRY_TYPE, SETTLEMENT_CONFIRM_ENTRY_TYPE],
}

/** Storage key of the chosen chip; the chips survive a reload. */
const LEDGER_FILTER_STORAGE_KEY = 'bakihai/ledger-filter'

function isLedgerFilter(value: unknown): value is LedgerFilter {
  return typeof value === 'string' && (LEDGER_FILTERS as readonly string[]).includes(value)
}

/** Reads the chip this device last chose, falling back to All when unreadable. */
export function loadLedgerFilter(): LedgerFilter {
  try {
    const raw = window.localStorage.getItem(LEDGER_FILTER_STORAGE_KEY)

    return isLedgerFilter(raw) ? raw : 'all'
  } catch {
    return 'all'
  }
}

/** Remembers the chosen chip across reloads. A browser without storage just forgets it. */
export function saveLedgerFilter(filter: LedgerFilter): void {
  try {
    window.localStorage.setItem(LEDGER_FILTER_STORAGE_KEY, filter)
  } catch {
    // Storage being unavailable only costs the chip its persistence.
  }
}

/** Whether an Entry reads under the chosen chip. */
export function matchesLedgerFilter(entry: EntryEnvelope, filter: LedgerFilter): boolean {
  return filter === 'all' || ENTRY_TYPES_BY_FILTER[filter].includes(entry.type)
}

/**
 * Whether the active Entries list hides this Entry. Two things go quiet until
 * Show hidden is on: a Void together with the Entry it Voided, so a correction
 * reads as one act rather than a lone annotation; and an Archived line — a
 * Settled Expense or Loan past its deadline, with the Returns and tagged
 * Settlements that belong to it (ADR-0005). A Void is never itself Voided, so
 * its own line is hidden by its type.
 */
function isHiddenEntry(
  entry: EntryEnvelope,
  voidsByTargetId: ReadonlyMap<string, EntryEnvelope>,
  archivedEntryIds: ReadonlySet<string>,
): boolean {
  return (
    entry.type === VOID_ENTRY_TYPE ||
    voidsByTargetId.has(entry.id) ||
    archivedEntryIds.has(entry.id)
  )
}

/**
 * What the Entries list shows: the chosen chip's cut of the book, minus the
 * lines that are hidden unless Show hidden is on. Showing or hiding changes
 * nothing but this list — the Balances and item states above read the whole
 * book, hidden lines included (ADR-0005).
 */
export function visibleLedgerEntries(input: {
  /** The ledger's Entries, already newest first. */
  entries: EntryEnvelope[]
  voidsByTargetId: ReadonlyMap<string, EntryEnvelope>
  archivedEntryIds: ReadonlySet<string>
  filter: LedgerFilter
  showHidden: boolean
}): EntryEnvelope[] {
  return input.entries.filter((entry) => {
    if (!matchesLedgerFilter(entry, input.filter)) {
      return false
    }

    if (input.showHidden) {
      return true
    }

    return !isHiddenEntry(entry, input.voidsByTargetId, input.archivedEntryIds)
  })
}
