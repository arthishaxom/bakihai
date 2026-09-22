import type { Balance, Member } from '@bakihai/shared'
import { useEffect, useRef } from 'react'
import { AddSettlementForm } from './AddSettlementForm'
import type { SettlementDraft } from './session'
import { describeBalance, type NamedMember, nameFor, type SettlementTagOption } from './summaries'

/**
 * The Settle up bottom sheet, opened from a Balance row. It prefills the
 * Settlement with the pairwise net, owing side to owed side, and leaves the
 * amount editable so a partial payment is normal. The tag picker is open too,
 * so the payment can be attached to the Expense or Loan it pays off. Whoever
 * taps it authors the Settlement: the debtor's record is a claim the creditor
 * confirms, while the creditor's own record is confirmed from the start
 * (ADR-0015).
 */
export function SettleUpSheet({
  balance,
  members,
  viewer,
  tagOptions,
  onSettle,
  onClose,
}: {
  balance: Balance
  members: Member[]
  viewer: NamedMember
  /** The items a tag may name; none when nothing is open to tag. */
  tagOptions?: SettlementTagOption[] | undefined
  onSettle: (input: SettlementDraft) => Promise<void>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  async function handleSettle(input: SettlementDraft): Promise<void> {
    await onSettle(input)
    onClose()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard path for dismissing a modal dialog; the click only closes when the backdrop itself is tapped.
    <dialog
      ref={dialogRef}
      aria-labelledby="settle-up-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40"
    >
      <div
        data-testid="settle-up-panel"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="settle-up-heading" className="font-semibold text-lg">
            Settle up
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>

        <p data-testid="settle-up-net" className="text-sm">
          {describeBalance(balance, members, viewer.deviceId)}
        </p>
        <p className="text-muted-foreground text-sm">
          Writes a Settlement from {nameFor(members, balance.debtorDeviceId)} to{' '}
          {nameFor(members, balance.creditorDeviceId)}. Change the amount for a partial payment.
        </p>

        <AddSettlementForm
          members={members}
          viewer={viewer}
          preset={{
            fromDeviceId: balance.debtorDeviceId,
            toDeviceId: balance.creditorDeviceId,
            amountPaise: balance.amountPaise,
          }}
          tagOptions={tagOptions}
          onSubmit={handleSettle}
        />
      </div>
    </dialog>
  )
}
