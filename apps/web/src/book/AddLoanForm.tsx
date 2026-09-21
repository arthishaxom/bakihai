import {
  LOAN_ITEM_LABEL_MAX_LENGTH,
  LOAN_UNIT_MAX_LENGTH,
  parseQuantityToHundredths,
} from '@bakihai/shared'
import { type FormEvent, useState } from 'react'
import type { LoanDraft } from './session'
import { formatQuantity, type NamedMember, nameFor } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

// The pill is a label around a real radio: the radio keeps its keyboard and
// screen-reader semantics, stretched invisibly over the pill so the whole
// shape is the hit target, and :checked / :focus-visible style the label.
const PILL_CLASSES =
  'relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-foreground/20 px-4 py-1.5 text-sm transition-colors has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground'

type Direction = 'lent' | 'borrowed'

/**
 * The Add Loan form: who took what from whom. The quantity is stored exactly
 * like paise (ADR-0008) — up to two decimals typed, an exact integer of
 * hundredths kept — with an optional free-text unit and no item catalog
 * (ADR-0006). Direction defaults to this device lending; any Member may record
 * either direction (ADR-0007).
 */
export function AddLoanForm({
  members,
  viewer,
  onSubmit,
}: {
  members: NamedMember[]
  viewer: NamedMember
  onSubmit: (input: LoanDraft) => Promise<void>
}) {
  const [direction, setDirection] = useState<Direction>('lent')
  const [counterpartyId, setCounterpartyId] = useState('')
  const [itemLabel, setItemLabel] = useState('')
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // On a fresh join the fold can lag this device's own Member Entry by a
  // moment, so the writer stays on the roster either way.
  const roster: NamedMember[] = members.some((member) => member.deviceId === viewer.deviceId)
    ? members
    : [viewer, ...members]
  const others = roster.filter((member) => member.deviceId !== viewer.deviceId)
  // The roster can arrive after the form opened, so the picker falls back to
  // the first Member rather than holding a device id that is not there yet.
  const counterparty = others.find((member) => member.deviceId === counterpartyId) ?? others[0]
  const quantityHundredths = parseQuantityToHundredths(quantity)
  const validQuantity = quantityHundredths !== null && quantityHundredths > 0
  const trimmedItem = itemLabel.trim()
  const trimmedUnit = unit.trim()
  const canSubmit =
    counterparty !== undefined && validQuantity && trimmedItem.length > 0 && !submitting

  const lenderDeviceId = direction === 'lent' ? viewer.deviceId : (counterparty?.deviceId ?? '')
  const borrowerDeviceId = direction === 'lent' ? (counterparty?.deviceId ?? '') : viewer.deviceId

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (!counterparty) {
      return
    }

    if (quantityHundredths === null || quantityHundredths <= 0) {
      setError('Enter a quantity like 3 or 1.5')
      return
    }

    if (trimmedItem.length === 0) {
      setError('Name the item, like eggs or rice')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({
        itemLabel: trimmedItem,
        quantityHundredths,
        ...(trimmedUnit.length === 0 ? {} : { unit: trimmedUnit }),
        lenderDeviceId,
        borrowerDeviceId,
      })
      setItemLabel('')
      setQuantity('')
      setUnit('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the Loan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form data-testid="loan-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend>Direction</legend>
        <div className="flex gap-2">
          <label data-direction="lent" className={PILL_CLASSES}>
            <input
              type="radio"
              name="direction"
              checked={direction === 'lent'}
              onChange={() => setDirection('lent')}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="pointer-events-none">Lent to</span>
          </label>
          <label data-direction="borrowed" className={PILL_CLASSES}>
            <input
              type="radio"
              name="direction"
              checked={direction === 'borrowed'}
              onChange={() => setDirection('borrowed')}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
            <span className="pointer-events-none">Borrowed from</span>
          </label>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Member
        <select
          name="counterparty"
          value={counterparty?.deviceId ?? ''}
          onChange={(event) => setCounterpartyId(event.target.value)}
          disabled={others.length === 0}
          className={INPUT_CLASSES}
        >
          {others.map((member) => (
            <option key={member.deviceId} value={member.deviceId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Item
        <input
          name="item"
          value={itemLabel}
          onChange={(event) => setItemLabel(event.target.value)}
          maxLength={LOAN_ITEM_LABEL_MAX_LENGTH}
          autoComplete="off"
          placeholder="eggs"
          className={INPUT_CLASSES}
        />
      </label>

      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Quantity
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
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Unit (optional)
          <input
            name="unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            maxLength={LOAN_UNIT_MAX_LENGTH}
            autoComplete="off"
            placeholder="kg"
            className={INPUT_CLASSES}
          />
        </label>
      </div>

      {others.length === 0 ? (
        <p role="status" className="text-red-600 text-sm">
          Add another Member before recording a Loan.
        </p>
      ) : null}

      {counterparty && quantityHundredths !== null && quantityHundredths > 0 && trimmedItem ? (
        <p data-testid="loan-summary" className="text-muted-foreground text-sm">
          {nameFor(roster, lenderDeviceId)} lent{' '}
          {formatQuantity(quantityHundredths, trimmedUnit || undefined)} {trimmedItem} to{' '}
          {nameFor(roster, borrowerDeviceId)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="min-h-11 rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        {submitting ? 'Adding…' : 'Add loan'}
      </button>
    </form>
  )
}
