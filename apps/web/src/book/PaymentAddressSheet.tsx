import {
  isUpiId,
  PAYEE_NAME_MAX_LENGTH,
  type PaymentAddress,
  UPI_ID_MAX_LENGTH,
} from '@bakihai/shared'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { PaymentAddressDraft } from './session'
import type { NamedMember } from './summaries'

const INPUT_CLASSES =
  'min-h-11 rounded-md border border-foreground/20 bg-transparent px-3 py-2 text-base'

/**
 * The Payment address bottom sheet, opened from your own row in Members: where
 * everyone in the Group pays you by UPI. Setting it writes an Entry like any
 * other, so it syncs to every device, and editing it writes another one — the
 * fold reads the latest. Only your own device can write yours, because the
 * Entry never names a Member: the address belongs to its author (ADR-0017).
 */
export function PaymentAddressSheet({
  address,
  viewer,
  onSave,
  onClose,
}: {
  /** The Member's folded address, when one is set. */
  address?: Pick<PaymentAddress, 'upiId' | 'payeeName'> | undefined
  viewer: NamedMember
  onSave: (input: PaymentAddressDraft) => Promise<void>
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [upiId, setUpiId] = useState(() => address?.upiId ?? '')
  const [payeeName, setPayeeName] = useState(() => address?.payeeName ?? viewer.displayName)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current

    if (dialog && !dialog.open) {
      dialog.showModal()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    const trimmedUpiId = upiId.trim()
    const trimmedPayeeName = payeeName.trim()

    if (!isUpiId(trimmedUpiId)) {
      setError('Enter a UPI ID like name@bank')
      return
    }

    if (trimmedPayeeName.length === 0) {
      setError('Enter the name on the UPI account')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      await onSave({ upiId: trimmedUpiId, payeeName: trimmedPayeeName })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the payment address')
      setSubmitting(false)
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the keyboard path for dismissing a modal dialog; the click only closes when the backdrop itself is tapped.
    <dialog
      ref={dialogRef}
      aria-labelledby="payment-address-heading"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current.close()
        }
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/40"
    >
      <div
        data-testid="payment-address-panel"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-background p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="payment-address-heading" className="font-semibold text-lg">
            Payment address
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
          Where everyone in the group pays you by UPI. Only your device can set it.
        </p>

        <form
          data-testid="payment-address-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            UPI ID
            <input
              name="upi-id"
              value={upiId}
              onChange={(event) => setUpiId(event.target.value)}
              maxLength={UPI_ID_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@bank"
              className={INPUT_CLASSES}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Payee name
            <input
              name="payee-name"
              value={payeeName}
              onChange={(event) => setPayeeName(event.target.value)}
              maxLength={PAYEE_NAME_MAX_LENGTH}
              autoComplete="off"
              className={INPUT_CLASSES}
            />
          </label>

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
            {submitting ? 'Saving…' : address === undefined ? 'Save UPI ID' : 'Update UPI ID'}
          </button>
        </form>
      </div>
    </dialog>
  )
}
