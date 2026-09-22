import {
  canVoidEntry,
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  type ExpenseCoverage,
  type ExpenseState,
  LOAN_ENTRY_TYPE,
  type LoanReturn,
  type LoanState,
  type Member,
  parseQuantityToHundredths,
  parseRupeesToPaise,
  readVoidPayload,
  type SettlementState,
  VOID_ENTRY_TYPE,
  VOID_REASON_MAX_LENGTH,
} from '@bakihai/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { AddSettlementForm } from './AddSettlementForm'
import type {
  LoanSettleDraft,
  ReturnDraft,
  SettlementConfirmDraft,
  SettlementDraft,
  VoidDraft,
} from './session'
import {
  describeEntry,
  describeExpenseCoverage,
  describeSettlementStatus,
  describeVoidedBy,
  type EntryNarrative,
  formatOccurredAt,
  formatQuantity,
  formatRupees,
  nameFor,
  type SettlementTagOption,
  settlementTagOf,
} from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'
// Every action in the sheet is at least 44px tall, the thumb target a phone needs.
const BUTTON_CLASSES = 'min-h-11 rounded-md px-4 py-2 font-medium'
// The pill is a label around a real radio: the radio keeps its keyboard and
// screen-reader semantics, stretched invisibly over the pill so the whole
// shape is the hit target, and :checked / :focus-visible style the label.
const PILL_CLASSES =
  'relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-foreground/20 px-4 py-1.5 text-sm transition-colors has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground'

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
  /** The Expense this Entry is, when the fold still holds it. */
  expense?: ExpenseState | undefined
  /** What this Entry Voided, when it is a Void and the target is in this book. */
  voidTarget?: EntryEnvelope | undefined
  /** What the Voided Entry reads as, so a Void of a Loan names the item. */
  voidTargetNarrative?: EntryNarrative | undefined
  /** The Void that Voided this Entry, when it is Voided. */
  voidedBy?: EntryEnvelope | undefined
  /** The Settlement this Entry is, when the fold still holds it. */
  settlement?: SettlementState | undefined
  /** The Expense or Loan this Entry's Settlement tag names, when it is in this book. */
  tagTarget?: EntryEnvelope | undefined
  /** What that tagged Entry reads as, so the tag names the item. */
  tagTargetNarrative?: EntryNarrative | undefined
  /** The items a Settlement tag may name; none when nothing is open to tag. */
  tagOptions: SettlementTagOption[]
  /** This device's Member identity, so only the receiver is offered a Confirm. */
  viewer: Pick<Member, 'deviceId' | 'displayName'>
  members: Member[]
  /** Signs and writes a Return against `loan`; resolves once it is in the local book. */
  onReturn: (input: ReturnDraft) => Promise<void>
  /**
   * Signs and writes the closing Return and, when money moved, the tagged
   * Settlement; resolves once both are in the local book.
   */
  onLoanSettle: (input: LoanSettleDraft) => Promise<void>
  /** Signs and writes a Settlement; resolves once it is in the local book. */
  onSettlement: (input: SettlementDraft) => Promise<void>
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
 * something outstanding a Return form and a Settle that closes the remainder
 * as a full Return (ADR-0006). Settle takes an optional amount: when money
 * changed hands, the same action writes the tagged Settlement alongside the
 * closing Return. An Expense shows what each participant still owes and lets
 * one share be settled directly, prefilled and tagged to the Expense. A Member
 * Entry or a Void offers no Void action (ADR-0014, #12), and an already-Voided
 * Entry offers none either, because a second Void would change nothing.
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
  expense,
  voidTarget,
  voidTargetNarrative,
  voidedBy,
  settlement,
  tagTarget,
  tagTargetNarrative,
  tagOptions,
  viewer,
  members,
  onReturn,
  onLoanSettle,
  onSettlement,
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
  const [settleAmount, setSettleAmount] = useState('')
  const [settleDirection, setSettleDirection] = useState<'borrower' | 'lender'>('borrower')
  const [settleError, setSettleError] = useState<string | null>(null)
  const [settlingShare, setSettlingShare] = useState<ExpenseCoverage | null>(null)
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
  const settlePaise = parseRupeesToPaise(settleAmount)
  const settlePays = settlePaise !== null && settlePaise > 0
  // Coverage acts on the Expense itself: a Voided Expense, and the Expense row
  // of a Settlement, offer no share to settle.
  const outstandingExpense = entry.type === EXPENSE_ENTRY_TYPE && !voidedBy ? expense : undefined
  // Only the Settlement's receiver can attest to a claim, and only while the
  // claim is unconfirmed and the Settlement not Voided (ADR-0015).
  const canConfirm =
    settlement !== undefined &&
    !settlement.confirmed &&
    settlement.toDeviceId === viewer.deviceId &&
    !voidedBy
  // A Voided Settlement reads its tag from its own payload; a live one from the fold.
  const settlementTag = settlementTagOf(entry, settlement)
  const tagLine =
    settlementTag === undefined
      ? undefined
      : tagTarget === undefined
        ? 'Tagged to an Entry that is not in this book.'
        : `Tagged to “${describeEntry(tagTarget, members, tagTargetNarrative)}”`
  // Optional properties cannot be handed over as undefined, so the narrative
  // is only given the parts this Entry actually has.
  const narrative: EntryNarrative = {
    ...(voidTarget === undefined ? {} : { voidTarget }),
    ...(voidTargetNarrative === undefined ? {} : { voidTargetNarrative }),
    ...(loan === undefined ? {} : { loan }),
    ...(returned === undefined ? {} : { returned }),
    ...(loanEntry === undefined ? {} : { loanEntry }),
    ...(expense === undefined ? {} : { expense }),
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

  /**
   * Closes the remainder of a Loan: always the closing Return, and — when an
   * amount was typed — the tagged Settlement recording the money that changed
   * hands, in the direction the pills picked. Both Entries are built together,
   * so one tap is one action (ADR-0006).
   */
  async function handleLoanSettle(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!outstandingLoan || outstandingLoan.remainingHundredths <= 0) {
      return
    }

    const typed = settleAmount.trim()

    if (typed !== '' && !settlePays) {
      setSettleError('Enter an amount in rupees, like 250 or 99.50, or leave it blank')
      return
    }

    setReturning(true)
    setSettleError(null)

    try {
      const borrowerPaid = settleDirection === 'borrower'

      await onLoanSettle({
        loanEntryId: outstandingLoan.loanEntryId,
        quantityHundredths: outstandingLoan.remainingHundredths,
        ...(settlePaise === null || settlePaise <= 0
          ? {}
          : {
              settlement: {
                fromDeviceId: borrowerPaid
                  ? outstandingLoan.borrowerDeviceId
                  : outstandingLoan.lenderDeviceId,
                toDeviceId: borrowerPaid
                  ? outstandingLoan.lenderDeviceId
                  : outstandingLoan.borrowerDeviceId,
                amountPaise: settlePaise,
              },
            }),
      })

      onClose()
    } catch (cause) {
      setSettleError(cause instanceof Error ? cause.message : 'Could not settle the Loan')
      setReturning(false)
    }
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

  /** Settles one participant's share of an Expense, prefilled and tagged to it. */
  async function handleSettleShare(input: SettlementDraft): Promise<void> {
    await onSettlement(input)
    onClose()
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

        {tagLine ? (
          <p data-testid="settlement-tag" className="text-sm">
            {tagLine}
          </p>
        ) : null}

        {outstandingExpense ? (
          <div
            data-testid="expense-coverage"
            className="flex flex-col gap-3 border-foreground/10 border-t pt-4"
          >
            <p className="text-muted-foreground text-sm">
              {outstandingExpense.settled
                ? 'Every share has been repaid.'
                : 'What each Member owes the payer.'}
            </p>
            <ul className="flex flex-col gap-1">
              {outstandingExpense.coverage.map((line) => (
                <li
                  key={line.deviceId}
                  data-testid="expense-participant"
                  data-participant-id={line.deviceId}
                  className="flex min-h-11 items-center justify-between gap-2"
                >
                  <span>{describeExpenseCoverage(line, members)}</span>
                  {line.settled || settlingShare ? null : (
                    <button
                      type="button"
                      data-testid="settle-share"
                      onClick={() => {
                        setSettlingShare(line)
                      }}
                      className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
                    >
                      Settle {formatRupees(line.sharePaise - line.coveredPaise)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {settlingShare ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm">
                  Settle {nameFor(members, settlingShare.deviceId)}&apos;s share of{' '}
                  {formatRupees(outstandingExpense.amountPaise)} with{' '}
                  {nameFor(members, outstandingExpense.payerDeviceId)}.
                </p>
                <AddSettlementForm
                  members={members}
                  viewer={viewer}
                  preset={{
                    fromDeviceId: settlingShare.deviceId,
                    toDeviceId: outstandingExpense.payerDeviceId,
                    amountPaise: settlingShare.sharePaise - settlingShare.coveredPaise,
                  }}
                  tagOptions={tagOptions}
                  initialTag={{ kind: 'expense', entryId: outstandingExpense.expenseEntryId }}
                  onSubmit={handleSettleShare}
                />
              </div>
            ) : null}
          </div>
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
            <form
              data-testid="settle-form"
              onSubmit={handleLoanSettle}
              className="flex flex-col gap-3"
            >
              <label className="flex flex-col gap-1 text-sm">
                Amount (₹, optional)
                <input
                  name="settle-amount"
                  value={settleAmount}
                  onChange={(event) => setSettleAmount(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  className={INPUT_CLASSES}
                />
              </label>
              {settlePays ? (
                <fieldset className="flex flex-col gap-2 text-sm">
                  <legend>Who paid whom</legend>
                  <div className="flex flex-wrap gap-2">
                    <label data-direction="borrower" className={PILL_CLASSES}>
                      <input
                        type="radio"
                        name="loan-settle-direction"
                        checked={settleDirection === 'borrower'}
                        onChange={() => setSettleDirection('borrower')}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <span className="pointer-events-none">
                        {nameFor(members, outstandingLoan.borrowerDeviceId)} paid{' '}
                        {nameFor(members, outstandingLoan.lenderDeviceId)}
                      </span>
                    </label>
                    <label data-direction="lender" className={PILL_CLASSES}>
                      <input
                        type="radio"
                        name="loan-settle-direction"
                        checked={settleDirection === 'lender'}
                        onChange={() => setSettleDirection('lender')}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <span className="pointer-events-none">
                        {nameFor(members, outstandingLoan.lenderDeviceId)} paid{' '}
                        {nameFor(members, outstandingLoan.borrowerDeviceId)}
                      </span>
                    </label>
                  </div>
                </fieldset>
              ) : null}
              {settleError ? (
                <p role="alert" className="text-red-600 text-sm">
                  {settleError}
                </p>
              ) : null}
              <button
                type="submit"
                data-testid="settle-button"
                disabled={returning}
                className={`${BUTTON_CLASSES} border border-foreground/20 disabled:opacity-50`}
              >
                {returning
                  ? 'Settling…'
                  : settlePays && settlePaise !== null
                    ? `Settle with ${formatRupees(settlePaise)}`
                    : 'Settle'}
              </button>
            </form>
            <p className="text-muted-foreground text-sm">
              Settle records a Return for the{' '}
              {formatQuantity(remainingHundredths, outstandingLoan.unit)} left and closes the item.
              Add an amount when money changed hands.
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
