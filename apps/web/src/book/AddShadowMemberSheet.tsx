import { MEMBER_DISPLAY_NAME_MAX_LENGTH } from '@bakihai/shared'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ShadowMemberDraft } from './session'
import type { NamedMember } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

/**
 * The Add-a-person-without-the-app bottom sheet, opened from Members. The
 * person has no phone of their own, so this device signs their Member Entry
 * and then holds their key (ADR-0020). A name is all the book needs: from then
 * on every picker offers them, and their side is recorded here.
 */
export function AddShadowMemberSheet({
  members,
  onAdd,
  onClose,
}: {
  /** The Group roster, so a name already in the Group can be flagged. */
  members: NamedMember[]
  onAdd: (input: ShadowMemberDraft) => Promise<void>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  const trimmedName = displayName.trim()
  // Duplicate names are allowed (ADR-0014), so this only ever warns.
  const duplicate = useMemo(
    () =>
      trimmedName.length > 0 &&
      members.some(
        (member) => member.displayName.trim().toLowerCase() === trimmedName.toLowerCase(),
      ),
    [members, trimmedName],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (trimmedName.length === 0) {
      setError('Enter a name')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onAdd({ displayName: trimmedName })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the person')
      setSubmitting(false)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard path for dismissing a modal dialog; the click only closes when the backdrop itself is tapped.
    <dialog
      ref={dialogRef}
      aria-labelledby="add-shadow-member-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40"
    >
      <div
        data-testid="add-shadow-member-panel"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="add-shadow-member-heading" className="font-semibold text-lg">
            Add a person without the app
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>

        <p className="text-muted-foreground text-sm">
          They have no phone to join with, so you record their side of the book. You can archive
          them later like any Member.
        </p>

        <form
          data-testid="add-shadow-member-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              name="display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={MEMBER_DISPLAY_NAME_MAX_LENGTH}
              autoComplete="off"
              placeholder="Rohit"
              className={INPUT_CLASSES}
            />
          </label>

          {duplicate ? (
            <p
              data-testid="duplicate-name-warning"
              role="status"
              className="text-amber-600 text-sm"
            >
              Someone named “{trimmedName}” is already in this Group. You can still add them.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="text-red-600 text-sm">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-md bg-foreground px-4 py-2 font-medium text-background disabled:opacity-50"
          >
            {submitting ? 'Adding…' : 'Add person'}
          </button>
        </form>
      </div>
    </dialog>
  )
}
