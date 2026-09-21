import {
  canVoidEntry,
  type EntryEnvelope,
  LOAN_ENTRY_TYPE,
  type LoanReturn,
  type LoanState,
  type Member,
  parseQuantityToHundredths,
  readVoidPayload,
  type SettlementState,
  VOID_ENTRY_TYPE,
  VOID_REASON_MAX_LENGTH,
} from '@bakihai/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { ReturnDraft, SettlementConfirmDraft, VoidDraft } from './session'
import {
  describeEntry,
  describeSettlementStatus,
  describeVoidedBy,
  type EntryNarrative,
  formatOccurredAt,
  formatQuantity,
  nameFor,
} from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'
// Every action in the sheet is at least 44px tall, the thumb target a phone needs.
const BUTTON_CLASSES = 'min-h-11 rounded-md px-4 py-2 font-medium'

interface EntryDetailSheetProps {
  entry: EntryEnvelope
  /** The Loan this Entry is, or the Loan a Return returns to, when it is in this book. */
  loan?: LoanState | undefined
  /** The Return this Entry is, when it is a Return. */
  returned?: LoanReturn | undefined
  /**
   * The Loan Entry itself, for a Voided Loan the fold has dropped, so the
   * sheet's heading still names the item.
   */
  loanEntry?: EntryEnvelope | undefined
  /** What this Entry Voided, when it is a Void and the target is in this book. */
  voidTarget?: EntryEnvelope | undefined
  /** What the Voided Entry reads as, so a Void of a Loan names the item. */
  voidTargetNarrative?: EntryNarrative | undefined
  /** The Void that Voided this Entry, when it is Voided. */
  voidedBy?: EntryEnvelope | undefined
  /** The Settlement this Entry is, when the fold still holds it. */
  settlement?: SettlementState | undefined
  /** This device's Member id, so only the receiver is offered a Confirm. */
  viewerDeviceId: string
  members: Member[]
  /** Signs and writes a Return against `loan`; resolves once it is in the local book. */
  onReturn: (input: ReturnDraft) => Promise<void>
  /** Signs and writes a Void of `entry`; resolves once it is in the local book. */
  onVoid: (input: VoidDraft) => Promise<void>
  /** Signs and writes a Confirm of `settlement`; resolves once it is in the local book. */
  onConfirm: (input: SettlementConfirmDraft) => Promise<void>
  onClose: () => void
}

/**
 * One Entry's detail bottom sheet, opened from its row in the book. It shows
 * what the Entry is, who wrote it, and — for an Entry that can still be acted
 * on — a Void action with an optional short reason, and for a Loan with
 * something outstanding a Return form and a one-tap Settle that closes the
 * remainder as a full Return (ADR-0006). A Member Entry or a Void offers no
 * Void action (ADR-0014, #12), and an already-Voided Entry offers none either,
 * because a second Void would change nothing.
 *
 * The sheet is a native `<dialog>` shown modally: the browser gives it the top
 * layer, a focus trap, and Escape to dismiss for free, and CSS pins it to the
 * bottom of the viewport.
 */
export function EntryDetailSheet({
  entry,
  loan,
  returned,
  loanEntry,
  voidTarget,
  voidTargetNarrative,
  voidedBy,
  settlement,
  viewerDeviceId,
  members,
  onReturn,
  onVoid,
  onConfirm,
  onClose,
}: EntryDetailSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [returnError, setReturnError] = useState<string | null>(null)
  const [returning, setReturning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  const voidable = canVoidEntry(entry) && !voidedBy
  // Return and Settle act on the Loan itself: a Return row, a Voided Loan, and
  // a Loan with nothing left outstanding all offer neither.
  const outstandingLoan = entry.type === LOAN_ENTRY_TYPE && !voidedBy ? loan : undefined
  const remainingHundredths = outstandingLoan?.remainingHundredths ?? 0
  // Only the Settlement's receiver can attest to a claim, and only while the
  // claim is unconfirmed and the Settlement not Voided (ADR-0015).
  const canConfirm =
    settlement !== undefined &&
    !settlement.confirmed &&
    settlement.toDeviceId === viewerDeviceId &&
    !voidedBy
  // Optional properties cannot be handed over as undefined, so the narrative
  // is only given the parts this Entry actually has.
  const narrative: EntryNarrative = {
    ...(voidTarget === undefined ? {} : { voidTarget }),
    ...(voidTargetNarrative === undefined ? {} : { voidTargetNarrative }),
    ...(loan === undefined ? {} : { loan }),
    ...(returned === undefined ? {} : { returned }),
    ...(loanEntry === undefined ? {} : { loanEntry }),
    ...(settlement === undefined ? {} : { settlement }),
  }

  async function handleVoid(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    try {
      await onVoid({
        targetEntryId: entry.id,
        ...(reason.trim() ? { reason } : {}),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not void the Entry')
      setSubmitting(false)
    }
  }

  async function handleReturn(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!outstandingLoan) {
      return
    }

    const hundredths = parseQuantityToHundredths(quantity)

    // The form is the gate the fold cannot be: Entries are immutable and the
    // fold must stay total, so a Return past what is left is refused here and
    // only ever surfaces as an over-returned marker if two phones raced it.
    if (hundredths === null || hundredths <= 0) {
      setReturnError('Enter a quantity like 1 or 1.5')
      return
    }

    if (hundredths > outstandingLoan.remainingHundredths) {
      setReturnError(
        `Only ${formatQuantity(outstandingLoan.remainingHundredths, outstandingLoan.unit)} is left to return`,
      )
      return
    }

    await writeReturn(outstandingLoan.loanEntryId, hundredths)
  }

  async function handleSettle(): Promise<void> {
    if (!outstandingLoan || outstandingLoan.remainingHundredths <= 0) {
      return
    }

    await writeReturn(outstandingLoan.loanEntryId, outstandingLoan.remainingHundredths)
  }

  async function writeReturn(loanEntryId: string, quantityHundredths: number): Promise<void> {
    setReturning(true)
    setReturnError(null)

    try {
      await onReturn({ loanEntryId, quantityHundredths })
      onClose()
    } catch (cause) {
      setReturnError(cause instanceof Error ? cause.message : 'Could not record the Return')
      setReturning(false)
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!settlement) {
      return
    }

    setConfirming(true)
    setConfirmError(null)

    try {
      await onConfirm({ settlementEntryId: settlement.settlementEntryId })
      onClose()
    } catch (cause) {
      setConfirmError(cause instanceof Error ? cause.message : 'Could not confirm the Settlement')
      setConfirming(false)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard path for dismissing a modal dialog; the click only closes when the backdrop itself is tapped.
    <dialog
      ref={dialogRef}
      aria-labelledby="entry-sheet-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40"
    >
      <div
        data-testid="entry-sheet-panel"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="entry-sheet-heading" className="font-semibold text-lg">
            {describeEntry(entry, members, narrative)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>

        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Added by</dt>
            <dd>{nameFor(members, entry.authorDeviceId)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">When</dt>
            <dd>{formatOccurredAt(entry.occurredAt)}</dd>
          </div>
        </dl>

        {voidedBy ? (
          <p data-testid="voided-annotation" className="text-sm">
            {describeVoidedBy(voidedBy, members)}
          </p>
        ) : null}

        {settlement ? (
          <p data-testid="settlement-status" className="text-sm">
            {describeSettlementStatus(settlement, members)}
          </p>
        ) : null}

        {canConfirm && settlement ? (
          <div className="flex flex-col gap-3 border-foreground/10 border-t pt-4">
            <p className="text-muted-foreground text-sm">
              {nameFor(members, settlement.entry.authorDeviceId)} recorded this Settlement. Confirm
              that it reached you.
            </p>
            {confirmError ? (
              <p role="alert" className="text-red-600 text-sm">
                {confirmError}
              </p>
            ) : null}
            <button
              type="button"
              data-testid="confirm-settlement"
              onClick={handleConfirm}
              disabled={confirming}
              className={`${BUTTON_CLASSES} bg-foreground text-background disabled:opacity-50`}
            >
              {confirming ? 'Confirming…' : 'Confirm settlement'}
            </button>
          </div>
        ) : null}

        {entry.type === VOID_ENTRY_TYPE && readVoidPayload(entry) && !voidTarget ? (
          <p className="text-muted-foreground text-sm">The Entry it names is not in this book.</p>
        ) : null}

        {outstandingLoan && remainingHundredths > 0 ? (
          <div className="flex flex-col gap-3 border-foreground/10 border-t pt-4">
            <p data-testid="loan-outstanding" className="text-sm">
              {formatQuantity(remainingHundredths, outstandingLoan.unit)} of{' '}
              {outstandingLoan.itemLabel} is still out.
            </p>
            <form data-testid="return-form" onSubmit={handleReturn} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Quantity returned
                <input
                  name="quantity"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className={INPUT_CLASSES}
                />
              </label>
              {returnError ? (
                <p role="alert" className="text-red-600 text-sm">
                  {returnError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={returning}
                className={`${BUTTON_CLASSES} bg-foreground text-background disabled:opacity-50`}
              >
                {returning ? 'Recording…' : 'Record return'}
              </button>
            </form>
            <button
              type="button"
              data-testid="settle-button"
              onClick={handleSettle}
              disabled={returning}
              className={`${BUTTON_CLASSES} border border-foreground/20 disabled:opacity-50`}
            >
              Settle
            </button>
            <p className="text-muted-foreground text-sm">
              Settle records a Return for the{' '}
              {formatQuantity(remainingHundredths, outstandingLoan.unit)} left and closes the item.
            </p>
          </div>
        ) : null}

        {voidable ? (
          <form
            data-testid="void-form"
            onSubmit={handleVoid}
            className="flex flex-col gap-3 border-foreground/10 border-t pt-4"
          >
            <label className="flex flex-col gap-1 text-sm">
              Reason (optional)
              <input
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={VOID_REASON_MAX_LENGTH}
                autoComplete="off"
                className={INPUT_CLASSES}
              />
            </label>
            <p className="text-muted-foreground text-sm">
              Voiding this Entry stops it counting for everyone. Both lines stay in the book.
            </p>
            {error ? (
              <p role="alert" className="text-red-600 text-sm">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className={`${BUTTON_CLASSES} border border-red-600 text-red-600 disabled:opacity-50`}
            >
              {submitting ? 'Voiding…' : 'Void entry'}
            </button>
          </form>
        ) : null}
      </div>
    </dialog>
  )
}
