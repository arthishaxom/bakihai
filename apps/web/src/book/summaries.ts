import {
  type Balance,
  type EntryEnvelope,
  EXPENSE_ENTRY_TYPE,
  type ExpenseCoverage,
  type ExpenseShare,
  type ExpenseState,
  expenseEntryPayloadSchema,
  formatHundredthsAsQuantity,
  formatPaiseAsRupees,
  LOAN_ENTRY_TYPE,
  type LoanReturn,
  type LoanState,
  loanEntryPayloadSchema,
  MEMBER_ENTRY_TYPE,
  type Member,
  RETURN_ENTRY_TYPE,
  readSettlementConfirmPayload,
  readSettlementPayload,
  readVoidPayload,
  SETTLEMENT_CONFIRM_ENTRY_TYPE,
  SETTLEMENT_ENTRY_TYPE,
  type SettlementEntryPayload,
  type SettlementState,
  type SettlementTag,
  settlementEntryPayloadSchema,
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

/** Just enough of a Member to read their name or pick them in a form. */
export type NamedMember = Pick<Member, 'deviceId' | 'displayName'>

/** The name a Member reads as, or "Someone" while the roster has not caught up. */
export function nameFor(members: NamedMember[], deviceId: string): string {
  return members.find((member) => member.deviceId === deviceId)?.displayName ?? 'Someone'
}

/**
 * What an Entry reads as in the book: real Expenses get money, a Void names
 * what it Voided, Loans and Returns read as their item, and the rest read as
 * their type. The narrative carries what the Entry itself cannot say: the
 * Entry a Void names and the Loan a Loan or Return belongs to.
 */
export function describeEntry(
  entry: EntryEnvelope,
  members: Member[],
  narrative: EntryNarrative = {},
): string {
  if (entry.type === VOID_ENTRY_TYPE) {
    return describeVoid(entry, narrative.voidTarget, members, narrative.voidTargetNarrative)
  }

  if (entry.type === LOAN_ENTRY_TYPE) {
    if (narrative.loan) {
      return describeLoan(narrative.loan, members)
    }

    const line = describeLoanEntry(entry, members)

    if (line) {
      return line
    }
  }

  if (entry.type === RETURN_ENTRY_TYPE && narrative.returned) {
    return describeReturn(
      narrative.returned,
      narrative.loan ?? loanContext(narrative.loanEntry),
      members,
    )
  }

  if (entry.type === SETTLEMENT_CONFIRM_ENTRY_TYPE) {
    return describeSettlementConfirm(
      entry,
      narrative.confirmTarget,
      members,
      narrative.confirmTargetNarrative,
    )
  }

  const settlement = settlementEntryPayloadSchema.safeParse(entry.payload)

  if (entry.type === SETTLEMENT_ENTRY_TYPE && settlement.success) {
    return describeSettlement(settlement.data, members)
  }

  const expense = expenseEntryPayloadSchema.safeParse(entry.payload)

  if (entry.type === EXPENSE_ENTRY_TYPE && expense.success) {
    return narrative.expense === undefined
      ? describeExpenseSplit(expense.data, members)
      : describeExpenseLine(narrative.expense, members)
  }

  return entry.type
}

/**
 * What an Expense's split reads as without its coverage: who paid what and who
 * shares. This is all a Voided Expense's struck-through line can say, because
 * the fold no longer holds its state.
 */
export function describeExpenseSplit(
  expense: {
    amountPaise: number
    payerDeviceId: string
    participantDeviceIds: string[]
  },
  members: NamedMember[],
): string {
  const payer = nameFor(members, expense.payerDeviceId)
  const sharers = expense.participantDeviceIds.map((deviceId) => nameFor(members, deviceId))

  return `${payer} paid ${formatRupees(expense.amountPaise)} · split between ${sharers.join(', ')}`
}

/**
 * What an Expense with its coverage reads as in the book: the split, plus how
 * much of what the others owe tagged Settlements have covered. No coverage
 * reads without a suffix; partial coverage names the paid-of-total progress; a
 * fully covered Expense reads Settled.
 */
export function describeExpenseLine(state: ExpenseState, members: NamedMember[]): string {
  const line = describeExpenseSplit(state, members)

  if (state.settled) {
    return `${line} · Settled`
  }

  if (state.coveredPaise > 0) {
    return `${line} · ${formatRupees(state.coveredPaise)} of ${formatRupees(state.owedPaise)} repaid`
  }

  return line
}

/**
 * One participant's coverage, read from what they owe the payer: a partial
 * payment shows the paid-of-total progress, a covered share reads Settled, and
 * nothing paid reads as what they owe.
 */
export function describeExpenseCoverage(coverage: ExpenseCoverage, members: NamedMember[]): string {
  const name = nameFor(members, coverage.deviceId)

  if (coverage.settled) {
    return `${name} Settled`
  }

  if (coverage.coveredPaise > 0) {
    return `${name} repaid ${formatRupees(coverage.coveredPaise)} of ${formatRupees(coverage.sharePaise)}`
  }

  return `${name} owes ${formatRupees(coverage.sharePaise)}`
}

/**
 * What a row needs beyond its own Entry to read: the Entry a Void names, what
 * that target itself reads as, and the Loan a Loan or Return belongs to.
 */
export interface EntryNarrative {
  /** The Entry a Void names, when it is in this book. */
  voidTarget?: EntryEnvelope
  /** What the Voided Entry itself reads as, so a Void of a Loan names the item. */
  voidTargetNarrative?: EntryNarrative
  /** The Loan this Entry is, or the Loan a Return returns to. */
  loan?: LoanState
  /** The Return this Entry is, when it is a Return. */
  returned?: LoanReturn
  /** The Expense this Entry is, when the fold still holds it. */
  expense?: ExpenseState
  /**
   * The Settlement this Entry is, when the fold still holds it. A Voided
   * Settlement is read from its own payload instead.
   */
  settlement?: SettlementState
  /** The Settlement a Confirm names, when it is in this book. */
  confirmTarget?: EntryEnvelope
  /** What that Settlement itself reads as, so a Confirm names the Settlement. */
  confirmTargetNarrative?: EntryNarrative
  /** The Expense or Loan a Settlement's tag names, when it is in this book. */
  tagTarget?: EntryEnvelope
  /** What that tagged Entry reads as, so a Settlement names what it pays off. */
  tagTargetNarrative?: EntryNarrative
  /**
   * The Loan Entry itself, for lines the fold no longer holds: a Voided Loan
   * still names its item on its own struck-through line.
   */
  loanEntry?: EntryEnvelope
}

/** A quantity with its unit when it has one: "3", "1.5 kg". */
export function formatQuantity(hundredths: number, unit?: string): string {
  const quantity = formatHundredthsAsQuantity(hundredths)

  return unit === undefined ? quantity : `${quantity} ${unit}`
}

/** The item and quantity a Loan records: "3 eggs", "1.5 kg rice". */
export function describeLoanItem(
  quantityHundredths: number,
  unit: string | undefined,
  itemLabel: string,
): string {
  return `${formatQuantity(quantityHundredths, unit)} ${itemLabel}`
}

/** What a Loan needs to read: its item, quantity, and direction. */
interface LoanLine {
  lenderDeviceId: string
  borrowerDeviceId: string
  quantityHundredths: number
  unit?: string | undefined
  itemLabel: string
}

/** Who lent what to whom: "Rohan lent 1.5 kg rice to Mira". */
function describeLoanLine(loan: LoanLine, members: Member[]): string {
  const item = describeLoanItem(loan.quantityHundredths, loan.unit, loan.itemLabel)

  return `${nameFor(members, loan.lenderDeviceId)} lent ${item} to ${nameFor(members, loan.borrowerDeviceId)}`
}

/**
 * What a Loan reads as in the book: who lent what to whom, and what is still
 * outstanding. An over-returned Loan names how far past its quantity the
 * Returns went; a Loan with nothing left reads Settled.
 */
export function describeLoan(loan: LoanState, members: Member[]): string {
  const line = describeLoanLine(loan, members)

  if (loan.overReturnedByHundredths > 0) {
    return `${line} · over-returned by ${formatQuantity(loan.overReturnedByHundredths, loan.unit)}`
  }

  if (loan.settled) {
    return `${line} · Settled`
  }

  return `${line} · ${formatQuantity(loan.remainingHundredths, loan.unit)} left`
}

/**
 * A Loan Entry's own line, read from its payload: for a Voided Loan, which the
 * fold no longer holds, this is all its struck-through line says.
 */
export function describeLoanEntry(entry: EntryEnvelope, members: Member[]): string | undefined {
  const payload = loanEntryPayloadSchema.safeParse(entry.payload)

  if (!payload.success) {
    return undefined
  }

  return describeLoanLine(payload.data, members)
}

/** What a Return needs from its Loan to read: the item, and who lent it. */
type ReturnLoan = Pick<LoanState, 'itemLabel' | 'unit' | 'lenderDeviceId'>

/** The same context, read from a Loan Entry the fold has dropped as Voided. */
function loanContext(entry: EntryEnvelope | undefined): ReturnLoan | undefined {
  if (!entry) {
    return undefined
  }

  const payload = loanEntryPayloadSchema.safeParse(entry.payload)

  if (!payload.success) {
    return undefined
  }

  return {
    itemLabel: payload.data.itemLabel,
    ...(payload.data.unit === undefined ? {} : { unit: payload.data.unit }),
    lenderDeviceId: payload.data.lenderDeviceId,
  }
}

/**
 * What a Return reads as: who gave back how much of which Loan's item. A Return
 * the lender wrote by tapping Settle reads as settled rather than as the lender
 * returning something to themselves; a Return whose Loan is not in the book
 * reads without it.
 */
export function describeReturn(
  returned: LoanReturn,
  loan: ReturnLoan | undefined,
  members: Member[],
): string {
  const author = nameFor(members, returned.entry.authorDeviceId)
  const quantity = formatQuantity(returned.quantityHundredths, loan?.unit)

  if (!loan) {
    return `${author} returned ${quantity}`
  }

  if (returned.entry.authorDeviceId === loan.lenderDeviceId) {
    return `${author} settled ${quantity} of ${loan.itemLabel}`
  }

  return `${author} returned ${quantity} of ${loan.itemLabel} to ${nameFor(members, loan.lenderDeviceId)}`
}

/**
 * What a Settlement reads as in the book: who paid whom, and the note if one
 * was written. The line is neutral, like an Expense's; the viewer's own side is
 * read in the form and the detail sheet instead.
 */
export function describeSettlement(payload: SettlementEntryPayload, members: Member[]): string {
  const payer = nameFor(members, payload.fromDeviceId)
  const receiver = nameFor(members, payload.toDeviceId)
  const line = `${payer} paid ${receiver} ${formatRupees(payload.amountPaise)}`

  return payload.note === undefined ? line : `${line} · ${payload.note}`
}

/**
 * Who paid whom, read from the viewer's side: "You paid Mira ₹120", "Mira paid
 * you ₹120", or the neutral line when the Settlement is between two others.
 */
export function describeSettlementLine(
  fromDeviceId: string,
  toDeviceId: string,
  amountPaise: number,
  members: NamedMember[],
  viewerDeviceId: string,
): string {
  const amount = formatRupees(amountPaise)

  if (fromDeviceId === viewerDeviceId) {
    return `You paid ${nameFor(members, toDeviceId)} ${amount}`
  }

  if (toDeviceId === viewerDeviceId) {
    return `${nameFor(members, fromDeviceId)} paid you ${amount}`
  }

  return `${nameFor(members, fromDeviceId)} paid ${nameFor(members, toDeviceId)} ${amount}`
}

/**
 * Whether a Settlement has been attested to: a receiver-authored record is
 * confirmed from the start, a payer's claim waits for the receiver (ADR-0015).
 */
export function describeSettlementStatus(settlement: SettlementState, members: Member[]): string {
  const receiver = nameFor(members, settlement.toDeviceId)

  return settlement.confirmed ? `Confirmed by ${receiver}` : `Waiting for ${receiver} to confirm`
}

/** A choice in the Settlement form's tag picker: the tag, how it reads, and who could cover it. */
export interface SettlementTagOption {
  tag: SettlementTag
  label: string
  /** The Members who owe on this item; only their payments to the creditor cover it (ADR-0016). */
  owedByDeviceIds: string[]
  /** The Member a covering payment goes to: the Expense's payer or the Loan's lender. */
  creditorDeviceId: string
}

/**
 * The items a Settlement may be tagged to, newest first: every Expense not yet
 * fully covered and every Loan with something outstanding. Each option names
 * who could cover it, so the form only offers a tag the payment's pair can
 * actually cover (ADR-0016). A settled item has nothing left to pay off, and
 * an item the fold has dropped — Voided, or with a payload this version cannot
 * read — is not offered.
 */
export function describeSettlementTags(
  expenses: ExpenseState[],
  loans: LoanState[],
  members: Member[],
): SettlementTagOption[] {
  const options: SettlementTagOption[] = [
    ...expenses
      .filter((expense) => !expense.settled)
      .map((expense) => ({
        tag: { kind: 'expense', entryId: expense.expenseEntryId } as const,
        label: describeExpenseLine(expense, members),
        owedByDeviceIds: expense.coverage
          .filter((line) => !line.settled)
          .map((line) => line.deviceId),
        creditorDeviceId: expense.payerDeviceId,
      })),
    ...loans
      .filter((loan) => !loan.settled)
      .map((loan) => ({
        tag: { kind: 'loan', entryId: loan.loanEntryId } as const,
        label: describeLoan(loan, members),
        owedByDeviceIds: [loan.borrowerDeviceId],
        creditorDeviceId: loan.lenderDeviceId,
      })),
  ]

  return options.sort((left, right) =>
    left.tag.entryId < right.tag.entryId ? 1 : left.tag.entryId > right.tag.entryId ? -1 : 0,
  )
}

/** The tag of a Settlement, read from the fold or, for a Voided one, its payload. */
export function settlementTagOf(
  entry: EntryEnvelope,
  settlement: SettlementState | undefined,
): SettlementTag | undefined {
  return settlement?.tag ?? readSettlementPayload(entry)?.tag
}

/**
 * What a Confirm reads as in the book: who attested to which Settlement. A
 * Confirm naming a Settlement that is not in the book still names its author.
 */
export function describeSettlementConfirm(
  confirmEntry: EntryEnvelope,
  target: EntryEnvelope | undefined,
  members: Member[],
  targetNarrative: EntryNarrative = {},
): string {
  const confirmer = nameFor(members, confirmEntry.authorDeviceId)

  if (!readSettlementConfirmPayload(confirmEntry)) {
    return `${confirmer} confirmed a Settlement`
  }

  if (!target) {
    return `${confirmer} confirmed a Settlement that is not in this book`
  }

  return `${confirmer} confirmed “${describeEntry(target, members, targetNarrative)}”`
}

/**
 * What a Void reads as in the book: who Voided what. The reason stays on the
 * Voided line, where it reads next to what it explains.
 */
export function describeVoid(
  voidEntry: EntryEnvelope,
  target: EntryEnvelope | undefined,
  members: Member[],
  targetNarrative: EntryNarrative = {},
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

  return `${voider} voided “${describeEntry(target, members, targetNarrative)}”`
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
