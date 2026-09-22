import {
  formatPaiseAsRupees,
  parseRupeesToPaise,
  SETTLEMENT_NOTE_MAX_LENGTH,
  type SettlementTag,
} from '@bakihai/shared'
import { type FormEvent, useState } from 'react'
import type { SettlementDraft } from './session'
import { describeSettlementLine, type NamedMember, type SettlementTagOption } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

// The pill is a label around a real radio: the radio keeps its keyboard and
// screen-reader semantics, stretched invisibly over the pill so the whole
// shape is the hit target, and :checked / :focus-visible style the label.
const PILL_CLASSES =
  'relative inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-foreground/20 px-4 py-1.5 text-sm transition-colors has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground'

type Direction = 'paid' | 'received'

/** A Settle up's locked pair and prefilled net, in paise. */
export interface SettlementPreset {
  fromDeviceId: string
  toDeviceId: string
  amountPaise: number
}

/** The value a tag takes in the picker: its kind and Entry id, unambiguous. */
function tagKeyOf(tag: SettlementTag): string {
  return `${tag.kind}:${tag.entryId}`
}

/**
 * The Settlement form: who paid whom, how much, and an optional note and tag.
 * A payer claims "I paid"; a receiver records "they paid me" — the receiver's
 * own authorship is what makes a Settlement confirmed from the start
 * (ADR-0015). An optional tag names the Expense or Loan the payment pays off,
 * defaulted when the form is opened from an item; without one, the Settlement
 * moves only the Balance (ADR-0004). Settle up locks the direction and
 * counterparty to a Balance's pair and prefills its net, leaving the amount
 * editable for a partial payment.
 */
export function AddSettlementForm({
  members,
  viewer,
  preset,
  tagOptions,
  initialTag,
  onSubmit,
}: {
  members: NamedMember[]
  viewer: NamedMember
  /** Set by Settle up: the pair and the pairwise net, prefilled and locked. */
  preset?: SettlementPreset | undefined
  /** The items the tag picker offers; none when nothing is open to tag. */
  tagOptions?: SettlementTagOption[] | undefined
  /** The tag the picker starts on, when the form was opened from an item. */
  initialTag?: SettlementTag | undefined
  onSubmit: (input: SettlementDraft) => Promise<void>
}) {
  const [direction, setDirection] = useState<Direction>('paid')
  const [counterpartyId, setCounterpartyId] = useState('')
  const [amount, setAmount] = useState(() =>
    preset === undefined ? '' : formatPaiseAsRupees(preset.amountPaise),
  )
  const [note, setNote] = useState('')
  const [tagKey, setTagKey] = useState(() => (initialTag === undefined ? '' : tagKeyOf(initialTag)))
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

  const fromDeviceId =
    preset !== undefined
      ? preset.fromDeviceId
      : direction === 'paid'
        ? viewer.deviceId
        : (counterparty?.deviceId ?? '')
  const toDeviceId =
    preset !== undefined
      ? preset.toDeviceId
      : direction === 'paid'
        ? (counterparty?.deviceId ?? '')
        : viewer.deviceId
  // Only items this exact pair could cover are offered: a tag whose item is not
  // owed by the payer to the receiver would promise coverage the fold never
  // grants (ADR-0016). A tag the pair no longer covers is left off the write.
  const options = (tagOptions ?? []).filter(
    (option) =>
      option.owedByDeviceIds.includes(fromDeviceId) && option.creditorDeviceId === toDeviceId,
  )
  const selectedTag = options.find((option) => tagKeyOf(option.tag) === tagKey)

  const amountPaise = parseRupeesToPaise(amount)
  const validAmount = amountPaise !== null && amountPaise > 0
  const pairReady = preset !== undefined || counterparty !== undefined
  const canSubmit = pairReady && validAmount && !submitting

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (amountPaise === null || amountPaise <= 0) {
      setError('Enter an amount in rupees, like 250 or 99.50')
      return
    }

    if (!pairReady) {
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({
        fromDeviceId,
        toDeviceId,
        amountPaise,
        ...(note.trim() ? { note } : {}),
        ...(selectedTag === undefined ? {} : { tag: selectedTag.tag }),
      })
      setAmount(preset === undefined ? '' : formatPaiseAsRupees(preset.amountPaise))
      setNote('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record the Settlement')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form data-testid="settlement-form" onSubmit={handleSubmit} className="flex flex-col gap-3">
      {preset === undefined ? (
        <>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend>Direction</legend>
            <div className="flex gap-2">
              <label data-direction="paid" className={PILL_CLASSES}>
                <input
                  type="radio"
                  name="direction"
                  checked={direction === 'paid'}
                  onChange={() => setDirection('paid')}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <span className="pointer-events-none">I paid</span>
              </label>
              <label data-direction="received" className={PILL_CLASSES}>
                <input
                  type="radio"
                  name="direction"
                  checked={direction === 'received'}
                  onChange={() => setDirection('received')}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <span className="pointer-events-none">They paid me</span>
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
        </>
      ) : null}

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

      {options.length > 0 ? (
        <label className="flex flex-col gap-1 text-sm">
          Tag (optional)
          <select
            name="tag"
            data-testid="settlement-tag"
            value={tagKey}
            onChange={(event) => setTagKey(event.target.value)}
            className={INPUT_CLASSES}
          >
            <option value="">None — moves only the Balance</option>
            {options.map((option) => (
              <option key={tagKeyOf(option.tag)} value={tagKeyOf(option.tag)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        Note (optional)
        <input
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={SETTLEMENT_NOTE_MAX_LENGTH}
          autoComplete="off"
          placeholder="for dinner"
          className={INPUT_CLASSES}
        />
      </label>

      {others.length === 0 && preset === undefined ? (
        <p role="status" className="text-red-600 text-sm">
          Add another Member before recording a Settlement.
        </p>
      ) : null}

      {validAmount && pairReady && amountPaise !== null ? (
        <p data-testid="settlement-summary" className="text-muted-foreground text-sm">
          {describeSettlementLine(fromDeviceId, toDeviceId, amountPaise, roster, viewer.deviceId)}
        </p>
      ) : null}

      {selectedTag === undefined ? (
        <p data-testid="settlement-untagged-notice" className="text-muted-foreground text-sm">
          Not attached to an Expense or Loan — this Settlement only moves the Balance.
        </p>
      ) : (
        <p data-testid="settlement-tag-notice" className="text-muted-foreground text-sm">
          Tagged to {selectedTag.label} — this Settlement counts toward that item&apos;s coverage.
        </p>
      )}

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
        {submitting ? 'Recording…' : preset === undefined ? 'Add settlement' : 'Record settlement'}
      </button>
    </form>
  )
}
