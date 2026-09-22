import {
  admitEntries,
  type Balance,
  type BookSyncProvider,
  type EntryEnvelope,
  type ExpenseState,
  entriesMap,
  foldBalances,
  foldExpenses,
  foldLoans,
  foldMembers,
  foldPaymentAddresses,
  foldSettlements,
  foldSettlementsAwaitingConfirmation,
  foldVoids,
  type LoanState,
  type Member,
  type PaymentAddress,
  readEntries,
  type SettlementState,
  type SyncStatus,
} from '@bakihai/shared'
import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import type { Identity } from '../identity/identity'
import {
  type ExpenseDraft,
  getBookSession,
  type LoanDraft,
  type LoanSettleDraft,
  type PaymentAddressDraft,
  type ReturnDraft,
  type SettlementConfirmDraft,
  type SettlementDraft,
  type VoidDraft,
} from './session'
import { useVerifiedEntries } from './useVerifiedEntries'

export interface BookView {
  /**
   * Every Entry this device accepts: well-formed, signed by its author, and
   * bound to the Group roster. Anything else the book contains is ignored.
   */
  entries: EntryEnvelope[]
  /** The Group roster folded from the book's Member Entries. */
  members: Member[]
  /** Pairwise Balances folded from the book's Expense Entries, zeroes already gone. */
  balances: Balance[]
  /** Expense states folded from the book's Expense and tagged Settlement Entries. */
  expenses: ExpenseState[]
  /** Item states folded from the book's Loan and Return Entries, in Entry id order. */
  loans: LoanState[]
  /** Settlement states folded from the book's Settlement and Confirm Entries. */
  settlements: SettlementState[]
  /** The Settlements still waiting for their receiver's confirmation. */
  settlementsAwaitingConfirmation: SettlementState[]
  /**
   * Each Member's Payment address, folded from their latest Payment address
   * Entry. A Member who set none simply has no entry here.
   */
  paymentAddresses: ReadonlyMap<string, PaymentAddress>
  /**
   * The Void Entries that Void something, keyed by the Voided Entry's id. A
   * Void naming a Member Entry or another Void is not here, so this map is
   * exactly what the folds drop.
   */
  voidsByTargetId: ReadonlyMap<string, EntryEnvelope>
  status: SyncStatus
  /** Set when this device's identity or book could not be opened. */
  error: unknown
  /**
   * True once the local book has synced and its Entries have been checked, so
   * empty states wait for it instead of flashing while the book is arriving.
   */
  ready: boolean
  /** Signs and writes an Expense to the local book. */
  writeExpense(input: ExpenseDraft): Promise<void>
  /** Signs and writes a Loan to the local book. */
  writeLoan(input: LoanDraft): Promise<void>
  /** Signs and writes a Return to the local book. */
  writeReturn(input: ReturnDraft): Promise<void>
  /**
   * Signs and writes a Loan's closing Return and, when money changed hands,
   * its tagged Settlement, in one action.
   */
  writeLoanSettle(input: LoanSettleDraft): Promise<void>
  /** Signs and writes a Void to the local book. */
  writeVoid(input: VoidDraft): Promise<void>
  /** Signs and writes a Settlement to the local book. */
  writeSettlement(input: SettlementDraft): Promise<void>
  /** Signs and writes a Confirm of a Settlement to the local book. */
  writeSettlementConfirm(input: SettlementConfirmDraft): Promise<void>
  /** Signs and writes this device's Payment address to the local book. */
  writePaymentAddress(input: PaymentAddressDraft): Promise<void>
}

/** Reads the local book, re-rendering whenever it changes on this or another device. */
export function useBook(identity: Identity): BookView {
  const session = getBookSession(identity)
  const rawEntries = useEntries(session.doc)
  const verified = useVerifiedEntries(rawEntries)
  const status = useSyncStatus(session.provider)
  const [error, setError] = useState<unknown>(null)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    session.ready.then(
      () => {
        if (!cancelled) {
          setSessionReady(true)
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause)
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [session])

  // Ingest verification, in one place: malformed values never left the book
  // (readEntries), signatures were checked above, and admission binds every
  // Entry to the roster. Every fold below sees the same accepted Entries.
  const entries = useMemo(() => admitEntries(verified.entries), [verified.entries])
  const members = useMemo(() => foldMembers(entries), [entries])
  const balances = useMemo(() => foldBalances(entries), [entries])
  const expenses = useMemo(() => foldExpenses(entries), [entries])
  const loans = useMemo(() => foldLoans(entries), [entries])
  const settlements = useMemo(() => foldSettlements(entries), [entries])
  const settlementsAwaitingConfirmation = useMemo(
    () => foldSettlementsAwaitingConfirmation(entries),
    [entries],
  )
  const paymentAddresses = useMemo(() => foldPaymentAddresses(entries), [entries])
  const voidsByTargetId = useMemo(() => foldVoids(entries), [entries])

  return {
    entries,
    members,
    balances,
    expenses,
    loans,
    settlements,
    settlementsAwaitingConfirmation,
    paymentAddresses,
    voidsByTargetId,
    status,
    error,
    ready: sessionReady && verified.settled,
    writeExpense: session.writeExpense,
    writeLoan: session.writeLoan,
    writeReturn: session.writeReturn,
    writeLoanSettle: session.writeLoanSettle,
    writeVoid: session.writeVoid,
    writeSettlement: session.writeSettlement,
    writeSettlementConfirm: session.writeSettlementConfirm,
    writePaymentAddress: session.writePaymentAddress,
  }
}

function useEntries(doc: Y.Doc): EntryEnvelope[] {
  const [entries, setEntries] = useState<EntryEnvelope[]>(() => readEntries(doc))

  useEffect(() => {
    const map = entriesMap(doc)
    const refresh = () => setEntries(readEntries(doc))

    map.observe(refresh)
    refresh()

    return () => map.unobserve(refresh)
  }, [doc])

  return entries
}

function useSyncStatus(provider: BookSyncProvider): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(provider.status)

  useEffect(() => provider.on('status', setStatus), [provider])

  return status
}
