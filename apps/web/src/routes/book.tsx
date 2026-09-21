import {
  type Balance,
  buildInviteUrl,
  type EntryEnvelope,
  LOAN_ENTRY_TYPE,
  MEMBER_ENTRY_TYPE,
  RETURN_ENTRY_TYPE,
  readReturnPayload,
  readSettlementConfirmPayload,
  readVoidPayload,
  type SyncStatus,
} from '@bakihai/shared'
import { useMemo, useState } from 'react'
import { AddEntrySheet } from '../book/AddEntrySheet'
import { EntryDetailSheet } from '../book/EntryDetailSheet'
import { SettleUpSheet } from '../book/SettleUpSheet'
import {
  describeBalance,
  describeEntry,
  describeSettlementStatus,
  describeVoidedBy,
  type EntryNarrative,
  formatOccurredAt,
} from '../book/summaries'
import { useBook } from '../book/useBook'
import { type Identity, inviteForIdentity, loadIdentity } from '../identity/identity'

const SYNC_LABELS: Record<SyncStatus, string> = {
  connected: 'Online',
  connecting: 'Connecting…',
  disconnected: 'Offline',
}

function compareTextDesc(left: string, right: string): number {
  if (left < right) {
    return 1
  }

  return left > right ? -1 : 0
}

/**
 * The book of the Group this device belongs to: its Members, its Balances, the
 * Add bottom sheet, its Entries newest first, and the invite action. Everything
 * is read from the local copy, so the screen is instant with no network
 * (ADR-0001) and Balances are folded, never stored (ADR-0004).
 */
export function BookPage() {
  const [identity] = useState(loadIdentity)

  if (!identity) {
    return null
  }

  return <BookScreen identity={identity} />
}

function BookScreen({ identity }: { identity: Identity }) {
  const {
    entries,
    members,
    balances,
    loans,
    settlements,
    settlementsAwaitingConfirmation,
    voidsByTargetId,
    status,
    error,
    ready,
    writeExpense,
    writeLoan,
    writeReturn,
    writeVoid,
    writeSettlement,
    writeSettlementConfirm,
  } = useBook(identity)
  const inviteUrl = buildInviteUrl(window.location.origin, inviteForIdentity(identity))
  const [copied, setCopied] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [settlingBalance, setSettlingBalance] = useState<Balance | null>(null)
  // useBook hands over only accepted Entries, so the ledger just leaves out
  // the Member Entries that announce the roster itself and orders the rest
  // newest first.
  const ledgerEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.type !== MEMBER_ENTRY_TYPE)
        .sort(
          (left, right) =>
            compareTextDesc(left.occurredAt, right.occurredAt) ||
            compareTextDesc(left.id, right.id),
        ),
    [entries],
  )
  const memberIds = useMemo(() => new Set(members.map((member) => member.deviceId)), [members])
  // Balances are between Members: an accepted Entry can still name someone who
  // is not in the roster, and a Balance with them is not this Group's business.
  const visibleBalances = balances.filter(
    (balance) => memberIds.has(balance.debtorDeviceId) && memberIds.has(balance.creditorDeviceId),
  )
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  // What each row needs beyond its own Entry: the Loan a Loan or Return
  // belongs to, and for a Void or Confirm the target's own narrative, so a Void
  // of a Loan names the item and a Confirm names the Settlement it attests to
  // rather than the type. A Voided Loan is no longer in the fold, so its line is
  // read from its own Entry instead.
  const narratives = useMemo(() => {
    const byEntryId = new Map<string, EntryNarrative>()
    const liveLoans = new Map(loans.map((loan) => [loan.loanEntryId, loan]))
    const loanEntries = new Map(
      entries
        .filter((entry) => entry.type === LOAN_ENTRY_TYPE)
        .map((entry) => [entry.id, entry] as const),
    )

    for (const [entryId, entry] of loanEntries) {
      const live = liveLoans.get(entryId)

      byEntryId.set(entryId, live ? { loan: live } : { loanEntry: entry })
    }

    for (const entry of entries) {
      if (entry.type !== RETURN_ENTRY_TYPE) {
        continue
      }

      const payload = readReturnPayload(entry)

      if (!payload) {
        continue
      }

      const live = liveLoans.get(payload.loanEntryId)
      const loanEntry = loanEntries.get(payload.loanEntryId)

      byEntryId.set(entry.id, {
        returned: { entry, quantityHundredths: payload.quantityHundredths },
        ...(live === undefined ? {} : { loan: live }),
        ...(loanEntry === undefined ? {} : { loanEntry }),
      })
    }

    for (const settlement of settlements) {
      byEntryId.set(settlement.settlementEntryId, { settlement })
    }

    for (const entry of entries) {
      const targetId = readSettlementConfirmPayload(entry)?.settlementEntryId

      if (targetId === undefined) {
        continue
      }

      const confirmTarget = entriesById.get(targetId)
      const confirmTargetNarrative = byEntryId.get(targetId)

      byEntryId.set(entry.id, {
        ...(byEntryId.get(entry.id) ?? {}),
        ...(confirmTarget === undefined ? {} : { confirmTarget }),
        ...(confirmTargetNarrative === undefined ? {} : { confirmTargetNarrative }),
      })
    }

    for (const entry of entries) {
      const targetId = readVoidPayload(entry)?.targetEntryId

      if (targetId === undefined) {
        continue
      }

      const voidTarget = entriesById.get(targetId)
      const voidTargetNarrative = byEntryId.get(targetId)

      byEntryId.set(entry.id, {
        ...(byEntryId.get(entry.id) ?? {}),
        ...(voidTarget === undefined ? {} : { voidTarget }),
        ...(voidTargetNarrative === undefined ? {} : { voidTargetNarrative }),
      })
    }

    return byEntryId
  }, [entries, entriesById, loans, settlements])
  const selectedEntry = selectedEntryId === null ? undefined : entriesById.get(selectedEntryId)
  const selectedNarrative =
    selectedEntry === undefined ? undefined : narratives.get(selectedEntry.id)
  const selectedVoid =
    selectedEntry === undefined ? undefined : voidsByTargetId.get(selectedEntry.id)

  function openEntry(entry: EntryEnvelope): void {
    setSelectedEntryId(entry.id)
  }

  async function copyInvite(): Promise<void> {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-8 p-6 pb-24">
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
          {ready && members.length === 0 ? (
            <li className="text-muted-foreground">No members yet.</li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="balances-heading">
        <h2 id="balances-heading" className="font-semibold text-lg">
          Balances
        </h2>
        {settlementsAwaitingConfirmation.length > 0 ? (
          <p data-testid="waiting-count" className="text-muted-foreground text-sm">
            {settlementsAwaitingConfirmation.length === 1
              ? '1 Settlement waiting for confirmation'
              : `${settlementsAwaitingConfirmation.length} Settlements waiting for confirmation`}
          </p>
        ) : null}
        {visibleBalances.length > 0 ? (
          <ul data-testid="balance-list" className="flex flex-col gap-1">
            {visibleBalances.map((balance) => (
              <li
                key={`${balance.debtorDeviceId}/${balance.creditorDeviceId}`}
                data-balance-debtor={balance.debtorDeviceId}
                data-balance-creditor={balance.creditorDeviceId}
                className="flex min-h-11 items-center justify-between gap-2"
              >
                <span data-balance-text>
                  {describeBalance(balance, members, identity.deviceId)}
                </span>
                <button
                  type="button"
                  data-testid="settle-up"
                  onClick={() => setSettlingBalance(balance)}
                  className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
                >
                  Settle up
                </button>
              </li>
            ))}
          </ul>
        ) : ready ? (
          <p data-testid="no-balances" className="text-muted-foreground">
            No balances yet.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="font-semibold text-lg">
          Entries
        </h2>
        {ledgerEntries.length > 0 ? (
          <ul data-testid="entry-list" className="flex flex-col gap-1">
            {ledgerEntries.map((entry) => {
              const voidEntry = voidsByTargetId.get(entry.id)
              const settlement = narratives.get(entry.id)?.settlement

              return (
                <li
                  key={entry.id}
                  data-entry-id={entry.id}
                  data-entry-type={entry.type}
                  data-voided={voidEntry ? 'true' : undefined}
                >
                  <button
                    type="button"
                    onClick={() => openEntry(entry)}
                    className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <span className={voidEntry ? 'line-through' : 'font-medium'}>
                      {describeEntry(entry, members, narratives.get(entry.id))}
                    </span>
                    {voidEntry ? (
                      <span className="text-muted-foreground text-sm">
                        {describeVoidedBy(voidEntry, members)}
                      </span>
                    ) : null}
                    {settlement && !settlement.confirmed ? (
                      <span className="text-muted-foreground text-sm">
                        {describeSettlementStatus(settlement, members)}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground text-sm">
                      {formatOccurredAt(entry.occurredAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : ready ? (
          <p className="text-muted-foreground">No entries yet. Add the first one above.</p>
        ) : null}
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

      <button
        type="button"
        data-testid="add-entry"
        onClick={() => setAddOpen(true)}
        className="fixed right-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-10 min-h-11 rounded-full bg-foreground px-5 py-3 font-medium text-background shadow-lg"
      >
        Add
      </button>

      {addOpen ? (
        <AddEntrySheet
          members={members}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          onExpense={writeExpense}
          onLoan={writeLoan}
          onSettlement={writeSettlement}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      {settlingBalance ? (
        <SettleUpSheet
          balance={settlingBalance}
          members={members}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          onSettle={writeSettlement}
          onClose={() => setSettlingBalance(null)}
        />
      ) : null}

      {selectedEntry ? (
        <EntryDetailSheet
          entry={selectedEntry}
          loan={selectedNarrative?.loan}
          returned={selectedNarrative?.returned}
          loanEntry={selectedNarrative?.loanEntry}
          voidTarget={selectedNarrative?.voidTarget}
          voidTargetNarrative={selectedNarrative?.voidTargetNarrative}
          voidedBy={selectedVoid}
          settlement={selectedNarrative?.settlement}
          viewerDeviceId={identity.deviceId}
          members={members}
          onReturn={writeReturn}
          onVoid={writeVoid}
          onConfirm={writeSettlementConfirm}
          onClose={() => setSelectedEntryId(null)}
        />
      ) : null}
    </main>
  )
}
