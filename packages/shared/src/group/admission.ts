import type { EntryEnvelope } from '../entry-envelope'
import { foldMemberKeys } from './members'

/**
 * The Entries this app admits into its view of the book: each one must be
 * signed by the key its author's device is bound to in the Group roster
 * (ADR-0007, #8). Member Entries establish those bindings; an Entry from a
 * device that never joined, or one that claims a Member's device id under a
 * different key, is left out. Admission is a pure function of the Entries, so
 * every device admits the same book in any order.
 *
 * This is the roster half of ingest verification. The other half — the
 * signature actually matching the envelope — needs WebCrypto and happens
 * before Entries reach this fold (see `verifyEntryEnvelope`).
 */
export function admitEntries(entries: EntryEnvelope[]): EntryEnvelope[] {
  const memberKeys = foldMemberKeys(entries)

  return entries.filter((entry) => memberKeys.get(entry.authorDeviceId) === entry.signerPublicKey)
}
