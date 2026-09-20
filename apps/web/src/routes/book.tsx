import {
  buildInviteUrl,
  type EntryEnvelope,
  MEMBER_ENTRY_TYPE,
  type SyncStatus,
} from '@bakihai/shared'
import { useState } from 'react'
import { useBook } from '../book/useBook'
import { type Identity, inviteForIdentity, loadIdentity } from '../identity/identity'

const SYNC_LABELS: Record<SyncStatus, string> = {
  connected: 'Online',
  connecting: 'Connecting…',
  disconnected: 'Offline',
}

function formatOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt)

  if (Number.isNaN(date.getTime())) {
    return occurredAt
  }

  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * The book of the Group this device belongs to: its Members, its Entries, and
 * the invite action. Entries are read from the local copy, so the screen is
 * instant with no network (ADR-0001).
 */
export function BookPage() {
  const [identity] = useState(loadIdentity)

  if (!identity) {
    return null
  }

  return <BookScreen identity={identity} />
}

function BookScreen({ identity }: { identity: Identity }) {
  const { entries, members, status, error } = useBook(identity)
  const inviteUrl = buildInviteUrl(window.location.origin, inviteForIdentity(identity))
  const [copied, setCopied] = useState(false)
  // The book arrives from other devices, so treat it as untrusted: show only
  // Entries this app version knows how to render (#8 hardens ingest).
  const ledgerEntries = entries
    .filter(
      (entry: EntryEnvelope) =>
        entry.type !== MEMBER_ENTRY_TYPE && typeof entry.occurredAt === 'string',
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <h1 className="font-semibold text-2xl tracking-tight">{identity.groupName}</h1>
        <span
          data-testid="sync-status"
          data-status={status}
          className="mt-1 shrink-0 text-muted-foreground text-sm"
        >
          {SYNC_LABELS[status]}
        </span>
      </header>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          This device&apos;s book could not be opened. {error instanceof Error ? error.message : ''}
        </p>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="members-heading">
        <h2 id="members-heading" className="font-semibold text-lg">
          Members
        </h2>
        <ul data-testid="member-list" className="flex flex-col gap-1">
          {members.map((member) => (
            <li key={member.deviceId} data-member-name={member.displayName}>
              {member.displayName}
              {member.deviceId === identity.deviceId ? (
                <span className="text-muted-foreground"> (you)</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="font-semibold text-lg">
          Entries
        </h2>
        {ledgerEntries.length === 0 ? (
          <p className="text-muted-foreground">No entries yet.</p>
        ) : (
          <ul data-testid="entry-list" className="flex flex-col gap-1">
            {ledgerEntries.map((entry) => (
              <li key={entry.id} data-entry-id={entry.id} data-entry-type={entry.type}>
                <span className="font-medium capitalize">{entry.type}</span>
                <span className="text-muted-foreground">
                  {' · '}
                  {formatOccurredAt(entry.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="invite-heading">
        <h2 id="invite-heading" className="font-semibold text-lg">
          Invite
        </h2>
        <p className="text-muted-foreground text-sm">
          Send this link to anyone in the group; they join by typing a name.
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            aria-label="Invite link"
            data-testid="invite-link"
            value={inviteUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={copyInvite}
            className="shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </section>
    </main>
  )
}
