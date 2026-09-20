import {
  type Balance,
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  expenseEntryPayloadSchema,
  formatPaiseAsRupees,
  type Member,
} from '@bakihai/shared'

export function formatRupees(amountPaise: number): string {
  return `₹${formatPaiseAsRupees(amountPaise)}`
}

export function formatOccurredAt(occurredAt: string): string {
  const date = new Date(occurredAt)

  if (Number.isNaN(date.getTime())) {
    return occurredAt
  }

  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function displayNameFor(members: Member[], deviceId: string): string | undefined {
  return members.find((member) => member.deviceId === deviceId)?.displayName
}

/** What an Entry reads as in the book: real Expenses get money, the rest their type. */
export function describeEntry(entry: EntryEnvelope, members: Member[]): string {
  const expense = expenseEntryPayloadSchema.safeParse(entry.payload)

  if (entry.type === EXPENSE_ENTRY_TYPE && expense.success) {
    const payer = displayNameFor(members, expense.data.payerDeviceId) ?? 'Someone'
    const sharers = expense.data.participantDeviceIds.map(
      (deviceId) => displayNameFor(members, deviceId) ?? 'Someone',
    )

    return `${payer} paid ${formatRupees(expense.data.amountPaise)} · split between ${sharers.join(', ')}`
  }

  return entry.type
}

/** What a Balance reads as on this device, always from the viewer's side outward. */
export function describeBalance(
  balance: Balance,
  members: Member[],
  viewerDeviceId: string,
): string {
  const debtor = displayNameFor(members, balance.debtorDeviceId) ?? 'Someone'
  const creditor = displayNameFor(members, balance.creditorDeviceId) ?? 'Someone'
  const amount = formatRupees(balance.amountPaise)

  if (balance.debtorDeviceId === viewerDeviceId) {
    return `You owe ${creditor} ${amount}`
  }

  if (balance.creditorDeviceId === viewerDeviceId) {
    return `${debtor} owes You ${amount}`
  }

  return `${debtor} owes ${creditor} ${amount}`
}
