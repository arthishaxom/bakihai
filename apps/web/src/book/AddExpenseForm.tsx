import { parseRupeesToPaise } from '@bakihai/shared'
import { type FormEvent, useState } from 'react'
import type { ExpenseDraft } from './session'

const INPUT_CLASSES = 'rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

interface RosterEntry {
  deviceId: string
  displayName: string
}

/**
 * The Add Expense form: amount in rupees (stored in paise, ADR-0008), a payer,
 * and the Members sharing the cost, equal by default. Unticking the payer is
 * how a Member treats the others. The writer is this device's Member unless
 * they pick someone else.
 */
export function AddExpenseForm({
  members,
  viewer,
  onSubmit,
}: {
  members: RosterEntry[]
  viewer: RosterEntry
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
  const roster: RosterEntry[] = members.some((member) => member.deviceId === viewer.deviceId)
    ? members
    : [viewer, ...members]
  const participants = roster.filter((member) => !excludedIds.has(member.deviceId))
  const canSubmit = participants.length > 0 && amount.trim().length > 0 && !submitting

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

    const amountPaise = parseRupeesToPaise(amount)

    if (amountPaise === null || amountPaise === 0) {
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
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend>Split between</legend>
          {roster.map((member) => (
            <label key={member.deviceId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!excludedIds.has(member.deviceId)}
                onChange={(event) => toggleParticipant(member.deviceId, event.target.checked)}
              />
              {member.displayName}
              {member.deviceId === viewer.deviceId ? ' (you)' : ''}
            </label>
          ))}
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add expense'}
        </button>
      </form>
    </section>
  )
}
