import {
  type Balance,
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  type ExpenseShare,
  expenseEntryPayloadSchema,
  formatPaiseAsRupees,
  MEMBER_ENTRY_TYPE,
  type Member,
  readVoidPayload,
  VOID_ENTRY_TYPE,
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

/** The name a Member reads as, or "Someone" while the roster has not caught up. */
export function nameFor(members: NamedMember[], deviceId: string): string {
  return members.find((member) => member.deviceId === deviceId)?.displayName ?? 'Someone'
}

/**
 * What an Entry reads as in the book: real Expenses get money, a Void names
 * what it Voided, and the rest read as their type. A Void's `voidTarget` is
 * the Entry it names, when that Entry is in this book.
 */
export function describeEntry(
  entry: EntryEnvelope,
  members: Member[],
  voidTarget?: EntryEnvelope,
): string {
  if (entry.type === VOID_ENTRY_TYPE) {
    return describeVoid(entry, voidTarget, members)
  }

  const expense = expenseEntryPayloadSchema.safeParse(entry.payload)

  if (entry.type === EXPENSE_ENTRY_TYPE && expense.success) {
    const payer = nameFor(members, expense.data.payerDeviceId)
    const sharers = expense.data.participantDeviceIds.map((deviceId) => nameFor(members, deviceId))

    return `${payer} paid ${formatRupees(expense.data.amountPaise)} · split between ${sharers.join(', ')}`
  }

  return entry.type
}

/**
 * What a Void reads as in the book: who Voided what. The reason stays on the
 * Voided line, where it reads next to what it explains.
 */
export function describeVoid(
  voidEntry: EntryEnvelope,
  target: EntryEnvelope | undefined,
  members: Member[],
): string {
  const voider = nameFor(members, voidEntry.authorDeviceId)

  if (!readVoidPayload(voidEntry)) {
    return `${voider} voided an Entry`
  }

  if (!target) {
    return `${voider} voided an Entry that is not in this book`
  }

  if (target.type === MEMBER_ENTRY_TYPE) {
    return `${voider} voided a Member Entry, which is ignored`
  }

  if (target.type === VOID_ENTRY_TYPE) {
    return `${voider} voided a Void, which is ignored`
  }

  return `${voider} voided “${describeEntry(target, members)}”`
}

/** The annotation a Voided line carries: who Voided it, and why. */
export function describeVoidedBy(voidEntry: EntryEnvelope, members: Member[]): string {
  const voider = nameFor(members, voidEntry.authorDeviceId)
  const reason = readVoidPayload(voidEntry)?.reason

  return reason ? `Voided by ${voider} — ${reason}` : `Voided by ${voider}`
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
  const nameOf = (deviceId: string) => nameFor(input.members, deviceId)
  const paid = `${nameOf(input.payerDeviceId)} paid ${formatRupees(input.amountPaise)}`
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
      return `${paid} · ${nameOf(only.deviceId)} owes ${formatRupees(only.amountPaise)}`
    }

    if (allSharesEqual) {
      return `${paid} · ${joinNames(others.map((share) => nameOf(share.deviceId)))} each owe ${formatRupees(first.amountPaise)}`
    }

    return `${paid} · ${others
      .map((share) => `${nameOf(share.deviceId)} owes ${formatRupees(share.amountPaise)}`)
      .join(', ')}`
  }

  if (allSharesEqual) {
    return `${paid} · ${formatRupees(first.amountPaise)} each`
  }

  return `${paid} · ${input.shares
    .map((share) => `${nameOf(share.deviceId)} ${formatRupees(share.amountPaise)}`)
    .join(', ')}`
}

/** What a Balance reads as on this device, always from the viewer's side outward. */
export function describeBalance(
  balance: Balance,
  members: Member[],
  viewerDeviceId: string,
): string {
  const debtor = nameFor(members, balance.debtorDeviceId)
  const creditor = nameFor(members, balance.creditorDeviceId)
  const amount = formatRupees(balance.amountPaise)

  if (balance.debtorDeviceId === viewerDeviceId) {
    return `You owe ${creditor} ${amount}`
  }

  if (balance.creditorDeviceId === viewerDeviceId) {
    return `${debtor} owes You ${amount}`
  }

  return `${debtor} owes ${creditor} ${amount}`
}
