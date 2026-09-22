import {
  archivedEntryIds,
  type Balance,
  buildInviteUrl,
  type EntryEnvelope,
  LOAN_ENTRY_TYPE,
  MEMBER_ENTRY_TYPE,
  PAYMENT_ADDRESS_ENTRY_TYPE,
  RETURN_ENTRY_TYPE,
  readReturnPayload,
  readSettlementConfirmPayload,
  readVoidPayload,
  SETTLEMENT_ENTRY_TYPE,
  type SyncStatus,
} from '@bakihai/shared'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { AddEntrySheet } from '../book/AddEntrySheet'
import { EntryDetailSheet } from '../book/EntryDetailSheet'
import {
  LEDGER_FILTER_LABELS,
  LEDGER_FILTERS,
  type LedgerFilter,
  loadLedgerFilter,
  saveLedgerFilter,
  visibleLedgerEntries,
} from '../book/ledger'
import { PaymentAddressSheet } from '../book/PaymentAddressSheet'
import { SettleUpSheet } from '../book/SettleUpSheet'
import {
  describeBalance,
  describeEntry,
  describeSettlementStatus,
  describeSettlementTags,
  describeVoidedBy,
  type EntryNarrative,
  formatOccurredAt,
  settlementTagOf,
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

/** The pill styling a filter chip or the Show hidden toggle carries, lit when on. */
function pillClasses(active: boolean): string {
  return `min-h-11 rounded-full border px-3 py-2 text-sm ${
    active ? 'border-foreground bg-foreground text-background' : 'border-foreground/20'
  }`
}

/**
 * The book of the Group this device belongs to: its Members, its Balances, the
 * Add bottom sheet, its Entries newest first behind filter chips, and the invite
 * action. The list starts quiet — Settled items past their 14-day deadline and
 * Void pairs wait behind Show hidden, which hides nothing from the arithmetic
 * (ADR-0005). Everything is read from the local copy, so the screen is instant
 * with no network (ADR-0001) and Balances are folded, never stored (ADR-0004).
 */
export function BookPage() {
  const [identity] = useState(loadIdentity)

  if (!identity) {
    return null
  }

  return <BookScreen identity={identity} />
}

function BookScreen({ identity }: { identity: Identity }) {
  const navigate = useNavigate()
  // An invite for another Group sent this device here; the notice names that
  // Group beside this book's, and dismissing it clears the search param.
  const { inviteFor } = useSearch({ from: '/' })
  const {
    entries,
    members,
    memberArchives,
    balances,
    expenses,
    loans,
    settlements,
    settlementsAwaitingConfirmation,
    paymentAddresses,
    voidsByTargetId,
    status,
    error,
    ready,
    writeExpense,
    writeLoan,
    writeReturn,
    writeLoanSettle,
    writeVoid,
    writeMemberArchive,
    writeSettlement,
    writeSettlementConfirm,
    writePaymentAddress,
  } = useBook(identity)
  const inviteUrl = buildInviteUrl(window.location.origin, inviteForIdentity(identity))
  const [copied, setCopied] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [settlingBalance, setSettlingBalance] = useState<Balance | null>(null)
  const [memberActionError, setMemberActionError] = useState<string | null>(null)
  const [memberActionPending, setMemberActionPending] = useState(false)
  // The chosen chip is a device preference and survives a reload; Show hidden is
  // view state for this visit, so a fresh look at the book starts quiet.
  const [filter, setFilter] = useState<LedgerFilter>(loadLedgerFilter)
  const [showHidden, setShowHidden] = useState(false)
  // The archive deadline is read when the book opens, not ticked: nothing here
  // needs a timer, and reopening the book recomputes every deadline from the
  // Entries. A phone left on this screen across a deadline catches it next visit.
  const [now] = useState(() => new Date())
  // useBook hands over only accepted Entries, so the ledger leaves out the
  // Member Entries that announce the roster itself and the Payment address
  // Entries that live on the Members rows, and orders the rest newest first.
  const ledgerEntries = useMemo(
    () =>
      entries
        .filter(
          (entry) => entry.type !== MEMBER_ENTRY_TYPE && entry.type !== PAYMENT_ADDRESS_ENTRY_TYPE,
        )
        .sort(
          (left, right) =>
            compareTextDesc(left.occurredAt, right.occurredAt) ||
            compareTextDesc(left.id, right.id),
        ),
    [entries],
  )
  // The lines the active list hides: Settled items past their 14-day deadline,
  // with the Returns and tagged Settlements that belong to them. Nothing else in
  // the book reads this set, so hiding never moves a Balance (ADR-0005).
  const archivedIds = useMemo(
    () => archivedEntryIds({ expenses, loans, settlements, now }),
    [expenses, loans, settlements, now],
  )
  // The ledger after the chips and Show hidden: what the Entries list renders.
  const visibleEntries = useMemo(
    () =>
      visibleLedgerEntries({
        entries: ledgerEntries,
        voidsByTargetId,
        archivedEntryIds: archivedIds,
        filter,
        showHidden,
      }),
    [ledgerEntries, voidsByTargetId, archivedIds, filter, showHidden],
  )
  const memberIds = useMemo(() => new Set(members.map((member) => member.deviceId)), [members])
  // Archived Members stay in the roster — their Entries and Balances are
  // untouched — but leave every picker and group under Archived at the bottom
  // of the Member list (ADR-0014).
  const archivedMemberIds = useMemo(() => new Set(memberArchives.keys()), [memberArchives])
  const activeMembers = useMemo(
    () => members.filter((member) => !archivedMemberIds.has(member.deviceId)),
    [members, archivedMemberIds],
  )
  const archivedMembers = useMemo(
    () => members.filter((member) => archivedMemberIds.has(member.deviceId)),
    [members, archivedMemberIds],
  )
  // Balances are between Members: an accepted Entry can still name someone who
  // is not in the roster, and a Balance with them is not this Group's business.
  const visibleBalances = balances.filter(
    (balance) => memberIds.has(balance.debtorDeviceId) && memberIds.has(balance.creditorDeviceId),
  )
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])
  // The items a Settlement can be tagged to: everything still open, newest
  // first. Settled items have nothing left to pay off (ADR-0004).
  const tagOptions = useMemo(
    () => describeSettlementTags(expenses, loans, members),
    [expenses, loans, members],
  )
  // What each row needs beyond its own Entry: the Loan an Expense, Loan or
  // Return belongs to with its computed state, and for a Void, Confirm, or
  // tagged Settlement the target's own narrative, so a Void of a Loan names
  // the item, a Confirm names the Settlement it attests to, and a tag names
  // what it pays off rather than the type. A Voided item is no longer in the
  // fold, so its line is read from its own Entry instead.
  const narratives = useMemo(() => {
    const byEntryId = new Map<string, EntryNarrative>()
    const liveLoans = new Map(loans.map((loan) => [loan.loanEntryId, loan]))
    const liveExpenses = new Map(expenses.map((expense) => [expense.expenseEntryId, expense]))
    const liveSettlements = new Map(
      settlements.map((settlement) => [settlement.settlementEntryId, settlement]),
    )
    const loanEntries = new Map(
      entries
        .filter((entry) => entry.type === LOAN_ENTRY_TYPE)
        .map((entry) => [entry.id, entry] as const),
    )

    for (const [entryId, entry] of loanEntries) {
      const live = liveLoans.get(entryId)

      byEntryId.set(entryId, live ? { loan: live } : { loanEntry: entry })
    }

    for (const [entryId, live] of liveExpenses) {
      byEntryId.set(entryId, { expense: live })
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

    for (const entry of entries) {
      if (entry.type !== SETTLEMENT_ENTRY_TYPE) {
        continue
      }

      const live = liveSettlements.get(entry.id)
      const tag = settlementTagOf(entry, live)
      const tagTarget = tag === undefined ? undefined : entriesById.get(tag.entryId)
      const tagTargetNarrative = tag === undefined ? undefined : byEntryId.get(tag.entryId)

      byEntryId.set(entry.id, {
        ...(live === undefined ? {} : { settlement: live }),
        ...(tagTarget === undefined ? {} : { tagTarget }),
        ...(tagTargetNarrative === undefined ? {} : { tagTargetNarrative }),
      })
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
  }, [entries, entriesById, expenses, loans, settlements])
  const selectedEntry = selectedEntryId === null ? undefined : entriesById.get(selectedEntryId)
  const selectedNarrative =
    selectedEntry === undefined ? undefined : narratives.get(selectedEntry.id)
  const selectedVoid =
    selectedEntry === undefined ? undefined : voidsByTargetId.get(selectedEntry.id)

  function openEntry(entry: EntryEnvelope): void {
    setSelectedEntryId(entry.id)
  }

  function chooseFilter(next: LedgerFilter): void {
    setFilter(next)
    saveLedgerFilter(next)
  }

  /**
   * Runs a Member-row action — archiving a Member whose phone is gone, or
   * Voiding the marker to restore one — one at a time, and keeps a failure on
   * screen beside the list instead of losing it in a tap. A second tap while
   * one is in flight is dropped: two markers for one Member would take two
   * undos to clear.
   */
  async function runMemberAction(action: () => Promise<void>): Promise<void> {
    if (memberActionPending) {
      return
    }

    setMemberActionPending(true)
    setMemberActionError(null)

    try {
      await action()
    } catch (cause) {
      setMemberActionError(cause instanceof Error ? cause.message : 'Could not update the Member')
    } finally {
      setMemberActionPending(false)
    }
  }

  /** Dismissing the invite notice clears it from the URL, leaving no state behind. */
  function dismissInviteNotice(): void {
    void navigate({ to: '/', search: {}, replace: true })
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

      {inviteFor !== undefined ? (
        // Opening another Group's invite does not switch this phone: the notice
        // names both Groups, and the book below is untouched.
        <div
          data-testid="invite-notice"
          className="flex items-start justify-between gap-3 rounded-md border border-foreground/20 px-3 py-2"
        >
          <p className="text-sm">
            This invite is for “{inviteFor}”. This phone is still showing “{identity.groupName}”.
          </p>
          <button
            type="button"
            onClick={dismissInviteNotice}
            className="min-h-11 shrink-0 text-sm underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          This device&apos;s book could not be opened. {error instanceof Error ? error.message : ''}
        </p>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="members-heading">
        <h2 id="members-heading" className="font-semibold text-lg">
          Members
        </h2>
        {memberActionError ? (
          <p role="alert" className="text-sm text-red-600">
            {memberActionError}
          </p>
        ) : null}
        <ul data-testid="member-list" className="flex flex-col gap-1">
          {activeMembers.map((member) => {
            const address = paymentAddresses.get(member.deviceId)

            return (
              <li
                key={member.deviceId}
                data-member-name={member.displayName}
                className="flex min-h-11 items-center"
              >
                {member.deviceId === identity.deviceId ? (
                  // Your own row opens the Payment address sheet; everyone
                  // else's row shows the address to pay them at and offers to
                  // archive them once their phone is gone.
                  <button
                    type="button"
                    data-testid="own-member"
                    onClick={() => setAddressOpen(true)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left"
                  >
                    <span className="min-w-0 truncate">
                      {member.displayName}
                      <span className="text-muted-foreground"> (you)</span>
                    </span>
                    <span
                      data-testid="member-upi"
                      className="shrink-0 text-muted-foreground text-sm"
                    >
                      {address ? address.upiId : 'Set UPI ID'}
                    </span>
                  </button>
                ) : (
                  <div className="flex min-h-11 w-full items-center justify-between gap-2 px-2 py-1.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{member.displayName}</span>
                      {address ? (
                        <span
                          data-testid="member-upi"
                          className="truncate text-muted-foreground text-sm"
                        >
                          {address.upiId}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      data-testid="archive-member"
                      aria-label={`Archive ${member.displayName}`}
                      disabled={memberActionPending}
                      onClick={() =>
                        runMemberAction(() =>
                          writeMemberArchive({ memberDeviceId: member.deviceId }),
                        )
                      }
                      className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50"
                    >
                      Archive
                    </button>
                  </div>
                )}
              </li>
            )
          })}
          {ready && members.length === 0 ? (
            <li className="text-muted-foreground">No members yet.</li>
          ) : null}
        </ul>
        {archivedMembers.length > 0 ? (
          <div data-testid="archived-members" className="flex flex-col gap-1">
            <h3 className="font-medium text-muted-foreground text-sm">Archived</h3>
            <ul data-testid="archived-member-list" className="flex flex-col gap-1">
              {archivedMembers.map((member) => {
                const marker = memberArchives.get(member.deviceId)

                return (
                  <li
                    key={member.deviceId}
                    data-member-name={member.displayName}
                    className="flex min-h-11 items-center justify-between gap-2 px-2 py-1.5"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate">{member.displayName}</span>
                      <span className="shrink-0 text-muted-foreground text-sm">Archived</span>
                    </span>
                    {marker ? (
                      // Undo is a Void of the marker Entry, so the archive stays
                      // in the book and the Member returns to the active list.
                      <button
                        type="button"
                        data-testid="unarchive-member"
                        aria-label={`Unarchive ${member.displayName}`}
                        disabled={memberActionPending}
                        onClick={() =>
                          runMemberAction(() => writeVoid({ targetEntryId: marker.id }))
                        }
                        className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm disabled:opacity-50"
                      >
                        Unarchive
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
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
                  {describeBalance(balance, members, identity.deviceId, archivedMemberIds)}
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
        <div className="flex flex-wrap items-center gap-2">
          <fieldset data-testid="ledger-filters" className="flex flex-wrap gap-2 border-0 p-0">
            <legend className="sr-only">Filter entries</legend>
            {LEDGER_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                data-filter={option}
                aria-pressed={filter === option}
                onClick={() => chooseFilter(option)}
                className={pillClasses(filter === option)}
              >
                {LEDGER_FILTER_LABELS[option]}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            data-testid="show-hidden"
            aria-pressed={showHidden}
            onClick={() => setShowHidden((shown) => !shown)}
            className={pillClasses(showHidden)}
          >
            Show hidden
          </button>
        </div>
        {ledgerEntries.length > 0 ? (
          <>
            <ul data-testid="entry-list" className="flex flex-col gap-1">
              {visibleEntries.map((entry) => {
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
            {visibleEntries.length === 0 ? (
              <p data-testid="no-visible-entries" className="text-muted-foreground">
                Nothing matches. Try another filter, or turn on Show hidden.
              </p>
            ) : null}
          </>
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
          members={activeMembers}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          tagOptions={tagOptions}
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
          archivedDeviceIds={archivedMemberIds}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          tagOptions={tagOptions}
          onSettle={writeSettlement}
          onClose={() => setSettlingBalance(null)}
        />
      ) : null}

      {addressOpen ? (
        <PaymentAddressSheet
          address={paymentAddresses.get(identity.deviceId)}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          onSave={writePaymentAddress}
          onClose={() => setAddressOpen(false)}
        />
      ) : null}

      {selectedEntry ? (
        <EntryDetailSheet
          entry={selectedEntry}
          loan={selectedNarrative?.loan}
          returned={selectedNarrative?.returned}
          loanEntry={selectedNarrative?.loanEntry}
          expense={selectedNarrative?.expense}
          voidTarget={selectedNarrative?.voidTarget}
          voidTargetNarrative={selectedNarrative?.voidTargetNarrative}
          voidedBy={selectedVoid}
          settlement={selectedNarrative?.settlement}
          tagTarget={selectedNarrative?.tagTarget}
          tagTargetNarrative={selectedNarrative?.tagTargetNarrative}
          tagOptions={tagOptions}
          paymentAddresses={paymentAddresses}
          viewer={{ deviceId: identity.deviceId, displayName: identity.displayName }}
          members={members}
          onReturn={writeReturn}
          onLoanSettle={writeLoanSettle}
          onSettlement={writeSettlement}
          onVoid={writeVoid}
          onConfirm={writeSettlementConfirm}
          onClose={() => setSelectedEntryId(null)}
        />
      ) : null}
    </main>
  )
}
