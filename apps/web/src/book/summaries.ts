import {
  type Balance,
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  type ExpenseShare,
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

/** Just enough of a Member to read their name in a summary. */
type NamedMember = Pick<Member, 'deviceId' | 'displayName'>

function displayNameFor(members: NamedMember[], deviceId: string): string | undefined {
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

/** Joins names the way the book reads: "Mira", "Mira and Sam", "Mira, Sam and Kabir". */
function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? ''
  }

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The Add Expense form's one-line preview of a split. The shares are the same
 * equal-split arithmetic the Balances fold uses, so a remainder paise is named
 * exactly rather than rounded away. When the payer shares the cost the line
 * reads "₹300 each"; when the payer is only fronting it, the line names what
 * the others owe.
 */
export function describeShares(input: {
  payerDeviceId: string
  amountPaise: number
  /** The shares splitExpense computed; the payer is present only when sharing. */
  shares: ExpenseShare[]
  members: NamedMember[]
}): string {
  const nameFor = (deviceId: string) => displayNameFor(input.members, deviceId) ?? 'Someone'
  const paid = `${nameFor(input.payerDeviceId)} paid ${formatRupees(input.amountPaise)}`
  const [first] = input.shares

  if (!first) {
    return paid
  }

  const allSharesEqual = input.shares.every((share) => share.amountPaise === first.amountPaise)
  const payerShares = input.shares.some((share) => share.deviceId === input.payerDeviceId)
  const others = input.shares.filter((share) => share.deviceId !== input.payerDeviceId)

  if (!payerShares) {
    const [only] = others

    if (others.length === 1 && only) {
      return `${paid} · ${nameFor(only.deviceId)} owes ${formatRupees(only.amountPaise)}`
    }

    if (allSharesEqual) {
      return `${paid} · ${joinNames(others.map((share) => nameFor(share.deviceId)))} each owe ${formatRupees(first.amountPaise)}`
    }

    return `${paid} · ${others
      .map((share) => `${nameFor(share.deviceId)} owes ${formatRupees(share.amountPaise)}`)
      .join(', ')}`
  }

  if (allSharesEqual) {
    return `${paid} · ${formatRupees(first.amountPaise)} each`
  }

  return `${paid} · ${input.shares
    .map((share) => `${nameFor(share.deviceId)} ${formatRupees(share.amountPaise)}`)
    .join(', ')}`
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
