import { describe, expect, it } from 'vitest'
import { archivedEntryIds, hasArchived, SETTLED_ARCHIVE_AFTER_DAYS } from '../src/group/archive'
import { foldExpenses } from '../src/group/expenses'
import { createLoanEntry, createReturnEntry, foldLoans } from '../src/group/loans'
import {
  createSettlementConfirmEntry,
  createSettlementEntry,
  foldSettlements,
  type SettlementTag,
} from '../src/group/settlements'
import { createVoidEntry } from '../src/group/voids'
import { makeDevice, makeExpenseEntry, makeMemberEntry, type TestDevice } from './helpers/entries'

/** A device writes an Expense for an amount only a named Member shares. */
function expenseFor(device: TestDevice, sharerDeviceId: string, occurredAt: string) {
  return makeExpenseEntry(device, {
    amountPaise: 50_000,
    participantDeviceIds: [sharerDeviceId],
    occurredAt,
  })
}

/** Writes a Loan as `device`, lent by the device itself. */
function lend(
  device: TestDevice,
  borrowerDeviceId: string,
  occurredAt: string,
): Promise<Awaited<ReturnType<typeof createLoanEntry>>> {
  return createLoanEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    lenderDeviceId: device.deviceId,
    borrowerDeviceId,
    itemLabel: 'eggs',
    quantityHundredths: 300,
    occurredAt,
  })
}

/** Writes a Return as `device`. */
function recordReturn(
  device: TestDevice,
  loanEntryId: string,
  occurredAt: string,
): Promise<Awaited<ReturnType<typeof createReturnEntry>>> {
  return createReturnEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    loanEntryId,
    quantityHundredths: 300,
    occurredAt,
  })
}

/** Writes a Settlement as `device`, defaulting the payer to the device itself. */
function pay(
  device: TestDevice,
  payload: {
    toDeviceId: string
    amountPaise: number
    tag?: SettlementTag
    occurredAt: string
  },
): Promise<Awaited<ReturnType<typeof createSettlementEntry>>> {
  return createSettlementEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    fromDeviceId: device.deviceId,
    ...payload,
  })
}

/** Writes a Confirm of `settlementEntryId` as `device`, its receiver. */
function confirm(
  device: TestDevice,
  settlementEntryId: string,
): Promise<Awaited<ReturnType<typeof createSettlementConfirmEntry>>> {
  return createSettlementConfirmEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    settlementEntryId,
  })
}

/** The whole archive decision for one book, at one instant. */
function archived(entries: Parameters<typeof foldExpenses>[0], now: Date): Set<string> {
  return archivedEntryIds({
    expenses: foldExpenses(entries),
    loans: foldLoans(entries),
    settlements: foldSettlements(entries),
    now,
  })
}

const SETTLED_AT = '2026-09-01T10:00:00.000Z'
const FIFTEEN_DAYS_LATER = new Date('2026-09-16T10:00:00.000Z')
const ONE_DAY_LATER = new Date('2026-09-02T10:00:00.000Z')

describe('hasArchived', () => {
  it('leaves a Settled item alone until its deadline, then archives it', () => {
    expect(SETTLED_ARCHIVE_AFTER_DAYS).toBe(14)
    expect(hasArchived(SETTLED_AT, new Date('2026-09-14T10:00:00.000Z'))).toBe(false)
    expect(hasArchived(SETTLED_AT, new Date('2026-09-15T09:59:59.999Z'))).toBe(false)
    // Exactly on the deadline it has archived, so the boundary is not a day late.
    expect(hasArchived(SETTLED_AT, new Date('2026-09-15T10:00:00.000Z'))).toBe(true)
    expect(hasArchived(SETTLED_AT, FIFTEEN_DAYS_LATER)).toBe(true)
  })

  it('never hides a line on an unreadable clock reading, or with no settled instant', () => {
    expect(hasArchived('not a date', FIFTEEN_DAYS_LATER)).toBe(false)
    expect(hasArchived('', FIFTEEN_DAYS_LATER)).toBe(false)
    // An open item carries no settled instant, so no age can archive it.
    expect(hasArchived(undefined, FIFTEEN_DAYS_LATER)).toBe(false)
  })
})

describe('archivedEntryIds', () => {
  it('archives an Expense that settled past its deadline and keeps one that settled yesterday', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const old = await expenseFor(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    const oldPaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: old.id },
      occurredAt: SETTLED_AT,
    })
    const fresh = await expenseFor(rohan, mira.deviceId, '2026-09-15T09:00:00.000Z')
    const freshPaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: fresh.id },
      occurredAt: '2026-09-15T10:00:00.000Z',
    })
    const book = [old, oldPaid, fresh, freshPaid]

    const at = archived(book, FIFTEEN_DAYS_LATER)

    expect(at.has(old.id)).toBe(true)
    expect(at.has(oldPaid.id)).toBe(true)
    expect(at.has(fresh.id)).toBe(false)
    expect(at.has(freshPaid.id)).toBe(false)
  })

  it('never archives an open item, however old it is', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const open = await expenseFor(rohan, mira.deviceId, '2026-01-01T10:00:00.000Z')
    const loan = await lend(rohan, mira.deviceId, '2026-01-01T10:00:00.000Z')

    const at = archived([open, loan], FIFTEEN_DAYS_LATER)

    expect(foldExpenses([open])[0]?.settled).toBe(false)
    expect(at.has(open.id)).toBe(false)
    expect(at.has(loan.id)).toBe(false)
  })

  it('archives a settled Loan with its Returns', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    const returned = await recordReturn(mira, loan.id, SETTLED_AT)

    const at = archived([loan, returned], FIFTEEN_DAYS_LATER)

    expect(at.has(loan.id)).toBe(true)
    expect(at.has(returned.id)).toBe(true)
  })

  it('archives a tagged Settlement and its Confirm with the item they settle', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const dinner = await expenseFor(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    // Mira records the Settlement herself, then Rohan attests to a claim of his own.
    const miraPaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: SETTLED_AT,
    })
    const claimed = await pay(rohan, {
      toDeviceId: mira.deviceId,
      amountPaise: 100,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-09-02T10:00:00.000Z',
    })
    const attested = await confirm(mira, claimed.id)

    const at = archived([...roster, dinner, miraPaid, claimed, attested], FIFTEEN_DAYS_LATER)

    expect(at.has(miraPaid.id)).toBe(true)
    expect(at.has(claimed.id)).toBe(true)
    expect(at.has(attested.id)).toBe(true)
  })

  it('never archives a Settlement that is not tagged to an item', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const untagged = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      occurredAt: '2026-01-01T10:00:00.000Z',
    })

    expect(archived([untagged], FIFTEEN_DAYS_LATER).size).toBe(0)
  })

  it('leaves a Settlement tagged to an item that is still open in the active list', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await expenseFor(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    const part = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 10_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-08-02T10:00:00.000Z',
    })

    const at = archived([dinner, part], FIFTEEN_DAYS_LATER)

    expect(foldExpenses([dinner, part])[0]?.settled).toBe(false)
    expect(at.size).toBe(0)
  })

  it('decides from the fold alone, so a Voided Settlement no longer archives', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await expenseFor(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: SETTLED_AT,
    })

    // Without the Void the Expense settled and archives; the Void reopens it, so
    // neither the Expense nor its Settlement is hidden.
    expect(archived([dinner, paid], FIFTEEN_DAYS_LATER).has(dinner.id)).toBe(true)

    const correction = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: paid.id,
    })

    expect(foldExpenses([dinner, paid, correction])[0]?.settled).toBe(false)
    expect(archived([dinner, paid, correction], FIFTEEN_DAYS_LATER).size).toBe(0)
  })

  it('lets a skewed clock shift the archive view, never the arithmetic', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    // A Return whose device clock ran ahead settles the Loan at that future
    // instant, so the deadline is measured from there and this device keeps the
    // item visible a while longer. The item's arithmetic never reads the clock.
    const returned = await recordReturn(mira, loan.id, '2999-01-01T00:00:00.000Z')

    expect(archived([loan, returned], FIFTEEN_DAYS_LATER).size).toBe(0)
    expect(foldLoans([loan, returned])[0]?.settled).toBe(true)
  })

  it('reads only the Entries, so every device hides the same lines', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, mira.deviceId, '2026-08-01T10:00:00.000Z')
    const returned = await recordReturn(mira, loan.id, SETTLED_AT)
    const entries = [loan, returned]

    expect(archived([...entries].reverse(), FIFTEEN_DAYS_LATER)).toEqual(
      archived(entries, FIFTEEN_DAYS_LATER),
    )
    expect(archived(entries, ONE_DAY_LATER).size).toBe(0)
  })
})
