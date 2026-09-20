import {
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

export interface BookView {
  /** Every Entry in the book, in no particular order. */
  entries: EntryEnvelope[]
  /** The Group roster folded from the book's Member Entries. */
  members: Member[]
  /** Pairwise Balances folded from the book's Expense Entries, zeroes already gone. */
  balances: Balance[]
  status: SyncStatus
  /** Set when this device's identity or book could not be opened. */
  error: unknown
  /** Signs and writes an Expense to the local book. */
  writeExpense(input: ExpenseDraft): Promise<void>
}

/** Reads the local book, re-rendering whenever it changes on this or another device. */
export function useBook(identity: Identity): BookView {
  const session = getBookSession(identity)
  const entries = useEntries(session.doc)
  const status = useSyncStatus(session.provider)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let cancelled = false

    session.ready.catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause)
      }
    })

    return () => {
      cancelled = true
    }
  }, [session])

  const members = useMemo(() => foldMembers(entries), [entries])
  const balances = useMemo(() => foldBalances(entries), [entries])

  return { entries, members, balances, status, error, writeExpense: session.writeExpense }
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
