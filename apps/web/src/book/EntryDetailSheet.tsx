import {
  canVoidEntry,
  type EntryEnvelope,
  type Member,
  readVoidPayload,
  VOID_ENTRY_TYPE,
  VOID_REASON_MAX_LENGTH,
} from '@bakihai/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { VoidDraft } from './session'
import { describeEntry, describeVoidedBy, formatOccurredAt, nameFor } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'
// Every action in the sheet is at least 44px tall, the thumb target a phone needs.
const BUTTON_CLASSES = 'min-h-11 rounded-md px-4 py-2 font-medium'

interface EntryDetailSheetProps {
  entry: EntryEnvelope
  /** What this Entry Voided, when it is a Void and the target is in this book. */
  voidTarget?: EntryEnvelope | undefined
  /** The Void that Voided this Entry, when it is Voided. */
  voidedBy?: EntryEnvelope | undefined
  members: Member[]
  /** Signs and writes a Void of `entry`; resolves once it is in the local book. */
  onVoid: (input: VoidDraft) => Promise<void>
  onClose: () => void
}

/**
 * One Entry's detail bottom sheet, opened from its row in the book. It shows
 * what the Entry is, who wrote it, and — for an Entry that can still be
 * corrected — a Void action with an optional short reason. A Member Entry or a
 * Void offers no Void action (ADR-0014, #12), and an already-Voided Entry
 * offers none either, because a second Void would change nothing.
 *
 * The sheet is a native `<dialog>` shown modally: the browser gives it the top
 * layer, a focus trap, and Escape to dismiss for free, and CSS pins it to the
 * bottom of the viewport.
 */
export function EntryDetailSheet({
  entry,
  voidTarget,
  voidedBy,
  members,
  onVoid,
  onClose,
}: EntryDetailSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  const voidable = canVoidEntry(entry) && !voidedBy

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
            {describeEntry(entry, members, voidTarget)}
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

        {entry.type === VOID_ENTRY_TYPE && readVoidPayload(entry) && !voidTarget ? (
          <p className="text-muted-foreground text-sm">The Entry it names is not in this book.</p>
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
