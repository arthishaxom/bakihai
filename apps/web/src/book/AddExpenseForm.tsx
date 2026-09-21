import { type ExpenseShare, parseRupeesToPaise, splitExpense } from '@bakihai/shared'
import { type FormEvent, useState } from 'react'
import type { ExpenseDraft } from './session'
import { describeShares, formatRupees, type NamedMember } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

// The pill is a label around a real checkbox: the checkbox keeps its keyboard
// and screen-reader semantics, stretched invisibly over the pill so the whole
// shape is the hit target, and :checked / :focus-visible style the label.
const PILL_CLASSES =
  'relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-foreground/20 px-3 py-1.5 text-sm transition-colors has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground'

/**
 * The Add Expense form: amount in rupees (stored in paise, ADR-0008), a payer,
 * and the Members sharing the cost, equal by default. Unticking the payer
 * records them fronting a cost the others still owe; a cost nobody else shares
 * moves no Balance and is never written. The writer is this device's Member
 * unless they pick someone else.
 */
export function AddExpenseForm({
  members,
  viewer,
  onSubmit,
}: {
  members: NamedMember[]
  viewer: NamedMember
  onSubmit: (input: ExpenseDraft) => Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [payerDeviceId, setPayerDeviceId] = useState(viewer.deviceId)
  // Nobody is excluded until the writer unticks them, so the default is
  // "everyone shares", including Members this device learns about later.
  const [excludedIds, setExcludedIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // On a fresh join the fold can lag this device's own Member Entry by a
  // moment, so the writer stays on the roster either way rather than the
  // Expense quietly landing on someone else's name.
  const roster: NamedMember[] = members.some((member) => member.deviceId === viewer.deviceId)
    ? members
    : [viewer, ...members]
  const participants = roster.filter((member) => !excludedIds.has(member.deviceId))
  const payerName =
    roster.find((member) => member.deviceId === payerDeviceId)?.displayName ?? 'Someone'
  const enteredPaise = parseRupeesToPaise(amount)
  const amountPaise = enteredPaise !== null && enteredPaise > 0 ? enteredPaise : null
  // The same equal-split arithmetic the Balances fold uses (ADR-0008), so the
  // preview's remainder paise are the shares every device will fold.
  const shares: ExpenseShare[] =
    amountPaise !== null && participants.length > 0
      ? splitExpense(
          amountPaise,
          participants.map((member) => member.deviceId),
        )
      : []
  const shareByDeviceId = new Map<string, number>()

  for (const share of shares) {
    shareByDeviceId.set(share.deviceId, share.amountPaise)
  }

  const payerAlone =
    participants.length > 0 && participants.every((member) => member.deviceId === payerDeviceId)
  const nobodyShares = participants.length === 0
  const canSubmit = !payerAlone && !nobodyShares && amount.trim().length > 0 && !submitting

  function toggleParticipant(deviceId: string, checked: boolean): void {
    setExcludedIds((current) => {
      const next = new Set(current)

      if (checked) {
        next.delete(deviceId)
      } else {
        next.add(deviceId)
      }

      return next
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    // The submit button is disabled for these, but the form stays the gate so
    // no Entry is written either way. The schema and the fold stay permissive,
    // so Entries from other app versions still fold cleanly.
    if (payerAlone || nobodyShares) {
      return
    }

    if (amountPaise === null) {
      setError('Enter an amount in rupees, like 250 or 99.50')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({
        amountPaise,
        payerDeviceId,
        participantDeviceIds: participants.map((member) => member.deviceId),
      })
      setAmount('')
      setPayerDeviceId(viewer.deviceId)
      setExcludedIds(new Set())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the Expense')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="add-expense-heading">
      <h2 id="add-expense-heading" className="font-semibold text-lg">
        Add expense
      </h2>
      <form data-testid="expense-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Amount (₹)
          <input
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            className={INPUT_CLASSES}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Paid by
          <select
            name="payer"
            value={payerDeviceId}
            onChange={(event) => setPayerDeviceId(event.target.value)}
            className={INPUT_CLASSES}
          >
            {roster.map((member) => (
              <option key={member.deviceId} value={member.deviceId}>
                {member.displayName}
                {member.deviceId === viewer.deviceId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend>Split equally between</legend>
          <div className="flex flex-wrap gap-2">
            {roster.map((member) => {
              const sharePaise = shareByDeviceId.get(member.deviceId)

              return (
                <label
                  key={member.deviceId}
                  data-participant-name={member.displayName}
                  data-share-paise={sharePaise}
                  className={PILL_CLASSES}
                >
                  <input
                    type="checkbox"
                    checked={!excludedIds.has(member.deviceId)}
                    onChange={(event) => toggleParticipant(member.deviceId, event.target.checked)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  <span className="pointer-events-none flex items-baseline gap-1.5">
                    {member.displayName}
                    {member.deviceId === viewer.deviceId ? (
                      <span className="opacity-70">(you)</span>
                    ) : null}
                    {sharePaise === undefined ? null : (
                      <span className="font-medium tabular-nums">{formatRupees(sharePaise)}</span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>
          {amountPaise !== null && shares.length > 0 && !payerAlone ? (
            <p data-testid="split-summary" className="text-muted-foreground">
              {describeShares({ payerDeviceId, amountPaise, shares, members: roster })}
            </p>
          ) : null}
          {payerAlone || nobodyShares ? (
            <p data-testid="split-explanation" role="status" className="text-red-600">
              {nobodyShares
                ? 'Nobody is in the split. Select at least one Member to share the cost.'
                : `Only ${payerName} is in the split, so nothing is owed. Select someone else to share the cost.`}
            </p>
          ) : null}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-11 rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add expense'}
        </button>
      </form>
    </section>
  )
}
