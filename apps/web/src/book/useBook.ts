import {
  admitEntries,
  type Balance,
  type BookSyncProvider,
  type EntryEnvelope,
  entriesMap,
  foldBalances,
  foldMembers,
  type Member,
  readEntries,
  type SyncStatus,
} from '@bakihai/shared'
import { useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import type { Identity } from '../identity/identity'
import { type ExpenseDraft, getBookSession } from './session'
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

  return {
    entries,
    members,
    balances,
    status,
    error,
    ready: sessionReady && verified.settled,
    writeExpense: session.writeExpense,
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
