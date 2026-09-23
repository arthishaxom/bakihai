import { useEffect, useRef, useState } from 'react'
import { AddExpenseForm } from './AddExpenseForm'
import { AddLoanForm } from './AddLoanForm'
import { AddSettlementForm } from './AddSettlementForm'
import type { ExpenseDraft, LoanDraft, SettlementDraft } from './session'
import type { NamedMember, SettlementTagOption } from './summaries'

type AddMode = 'expense' | 'loan' | 'settlement'

/**
 * The Add bottom sheet: an Expense / Loan / Settlement mode switch over the
 * form for the chosen kind. It is a native `<dialog>` shown modally, so the
 * browser gives it the top layer, a focus trap, and Escape to dismiss for free,
 * and CSS pins it to the bottom of the viewport for one-handed use. A
 * successful write closes the sheet; a refusal leaves it open with the reason
 * on screen.
 */
export function AddEntrySheet({
  members,
  viewer,
  tagOptions,
  onExpense,
  onLoan,
  onSettlement,
  onClose,
}: {
  members: NamedMember[]
  viewer: NamedMember
  /** The items a Settlement tag may name; none when nothing is open to tag. */
  tagOptions: SettlementTagOption[]
  onExpense: (input: ExpenseDraft) => Promise<void>
  onLoan: (input: LoanDraft) => Promise<void>
  onSettlement: (input: SettlementDraft) => Promise<void>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<AddMode>('expense')

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  async function handleExpense(input: ExpenseDraft): Promise<void> {
    await onExpense(input)
    onClose()
  }

  async function handleLoan(input: LoanDraft): Promise<void> {
    await onLoan(input)
    onClose()
  }

  async function handleSettlement(input: SettlementDraft): Promise<void> {
    await onSettlement(input)
    onClose()
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard path for dismissing a modal dialog; the click only closes when the backdrop itself is tapped.
    <dialog
      ref={dialogRef}
      aria-labelledby="add-sheet-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 text-foreground backdrop:bg-black/40"
    >
      <div
        data-testid="add-sheet-panel"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="add-sheet-heading" className="font-semibold text-lg">
            Add to the book
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-md border border-foreground/20 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>

        <fieldset className="flex gap-2 border-0 p-0">
          <legend className="sr-only">What to add</legend>
          <button
            type="button"
            aria-pressed={mode === 'expense'}
            onClick={() => setMode('expense')}
            className={modeButtonClasses(mode === 'expense')}
          >
            Expense
          </button>
          <button
            type="button"
            aria-pressed={mode === 'loan'}
            onClick={() => setMode('loan')}
            className={modeButtonClasses(mode === 'loan')}
          >
            Loan
          </button>
          <button
            type="button"
            aria-pressed={mode === 'settlement'}
            onClick={() => setMode('settlement')}
            className={modeButtonClasses(mode === 'settlement')}
          >
            Settlement
          </button>
        </fieldset>

        {mode === 'expense' ? (
          <AddExpenseForm members={members} viewer={viewer} onSubmit={handleExpense} />
        ) : mode === 'loan' ? (
          <AddLoanForm members={members} viewer={viewer} onSubmit={handleLoan} />
        ) : (
          <AddSettlementForm
            members={members}
            viewer={viewer}
            tagOptions={tagOptions}
            onSubmit={handleSettlement}
          />
        )}
      </div>
    </dialog>
  )
}

function modeButtonClasses(active: boolean): string {
  return `min-h-11 flex-1 rounded-full border px-4 py-2 text-sm font-medium ${
    active ? 'border-foreground bg-foreground text-background' : 'border-foreground/20'
  }`
}
