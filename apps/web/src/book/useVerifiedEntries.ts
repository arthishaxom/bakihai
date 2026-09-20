import { canonicalJson, type EntryEnvelope, verifyEntryEnvelope } from '@bakihai/shared'
import { useEffect, useMemo, useState } from 'react'

export interface VerifiedEntries {
  /** The Entries whose signatures verify, in the order they were read. */
  entries: EntryEnvelope[]
  /**
   * True once the signature pass for the current Entries has finished. Screens
   * wait for it before showing an empty state, so a reload never flashes
   * "nothing here" while the local book is still arriving.
   */
  settled: boolean
}

/**
 * Keeps only the Entries whose signature verifies. The book arrives from other
 * devices, so a modified client can put anything in it: `readEntries` already
 * dropped values that are not well-formed envelopes, and this drops envelopes
 * whose signature does not match their contents or their claimed key (#8).
 *
 * Verification is asynchronous (WebCrypto), so the hook holds the verified set
 * in state; each envelope is verified once and remembered by its full contents,
 * so a re-render or a repeat write costs nothing while a rewritten payload is
 * checked again.
 */
export function useVerifiedEntries(entries: EntryEnvelope[]): VerifiedEntries {
  const verify = useMemo(createEntryVerifier, [])
  const [verified, setVerified] = useState<ReadonlySet<string>>(() => new Set())
  const [checked, setChecked] = useState<EntryEnvelope[] | null>(null)

  useEffect(() => {
    let cancelled = false

    void Promise.all(entries.map((entry) => verify(entry))).then((results) => {
      if (cancelled) {
        return
      }

      const verifiedKeys = new Set<string>()

      entries.forEach((entry, index) => {
        if (results[index]) {
          verifiedKeys.add(envelopeKey(entry))
        }
      })

      setVerified(verifiedKeys)
      setChecked(entries)
    })

    return () => {
      cancelled = true
    }
  }, [verify, entries])

  const visible = useMemo(
    () => entries.filter((entry) => verified.has(envelopeKey(entry))),
    [entries, verified],
  )

  return { entries: visible, settled: checked === entries }
}

const keyCache = new WeakMap<EntryEnvelope, string>()

/** The whole envelope identifies the exact bytes its signature covers. */
function envelopeKey(entry: EntryEnvelope): string {
  let key = keyCache.get(entry)

  if (key === undefined) {
    key = canonicalJson(entry)
    keyCache.set(entry, key)
  }

  return key
}

/** A signature check per unique envelope, remembered for the life of the page. */
function createEntryVerifier(): (entry: EntryEnvelope) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>()

  return (entry) => {
    const key = envelopeKey(entry)
    let check = cache.get(key)

    if (!check) {
      check = verifyEntryEnvelope(entry).then(
        () => true,
        () => false,
      )
      cache.set(key, check)
    }

    return check
  }
}
