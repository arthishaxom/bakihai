import { describe, expect, it } from 'vitest'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import {
  EXPENSE_ENTRY_TYPE,
  type ExpenseState,
  foldExpenses,
  splitExpense,
} from '../src/group/expenses'
import { createSettlementEntry, type SettlementTag } from '../src/group/settlements'
import { createVoidEntry } from '../src/group/voids'
import { uuidv7 } from '../src/uuidv7'
import {
  makeDevice,
  makeEntry,
  makeExpenseEntry,
  makeMemberEntry,
  type TestDevice,
} from './helpers/entries'

const OCCURRED_AT = '2026-09-20T10:00:00.000Z'

/** Writes a Settlement as `device`, defaulting the payer to the device itself. */
function pay(
  device: TestDevice,
  payload: {
    toDeviceId: string
    amountPaise: number
    fromDeviceId?: string
    tag?: SettlementTag
    occurredAt?: string
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

/** Voids an Entry as `device`. */
function voidEntry(
  device: TestDevice,
  targetEntryId: string,
): Promise<Awaited<ReturnType<typeof createVoidEntry>>> {
  return createVoidEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    targetEntryId,
  })
}

/** The fold's one Expense, failing loudly when the book holds none or several. */
function onlyExpense(entries: Parameters<typeof foldExpenses>[0]): ExpenseState {
  const states = foldExpenses(entries)

  expect(states).toHaveLength(1)

  return states[0] as ExpenseState
}

describe('Expense Entries', () => {
  it('creates a signed Expense Entry that verifies', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entry = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
      occurredAt: OCCURRED_AT,
    })

    expect(entry.type).toBe(EXPENSE_ENTRY_TYPE)
    expect(entry.authorDeviceId).toBe(rohan.deviceId)
    expect(entry.signerPublicKey).toBe(rohan.signerPublicKey)
    expect(entry.occurredAt).toBe(OCCURRED_AT)
    expect(entry.payload).toEqual({
      amountPaise: 90_000,
      payerDeviceId: rohan.deviceId,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
    })
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('records a payer who is not sharing the cost', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entry = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })

    expect((entry.payload as { payerDeviceId: string }).payerDeviceId).toBe(rohan.deviceId)
    await expect(verifyEntryEnvelope(entry)).resolves.toEqual(entry)
  })

  it('refuses amounts that are not positive integer paise', async () => {
    const rohan = await makeDevice()

    await expect(
      makeExpenseEntry(rohan, { amountPaise: 0, participantDeviceIds: [rohan.deviceId] }),
    ).rejects.toThrow()
    await expect(
      makeExpenseEntry(rohan, { amountPaise: -100, participantDeviceIds: [rohan.deviceId] }),
    ).rejects.toThrow()
    await expect(
      makeExpenseEntry(rohan, { amountPaise: 99.5, participantDeviceIds: [rohan.deviceId] }),
    ).rejects.toThrow()
  })

  it('refuses an empty or repeated participant list', async () => {
    const rohan = await makeDevice()

    await expect(
      makeExpenseEntry(rohan, { amountPaise: 100, participantDeviceIds: [] }),
    ).rejects.toThrow()
    await expect(
      makeExpenseEntry(rohan, {
        amountPaise: 100,
        participantDeviceIds: [rohan.deviceId, rohan.deviceId],
      }),
    ).rejects.toThrow()
  })
})

describe('splitExpense', () => {
  it('splits ₹900 three ways into equal shares', () => {
    expect(splitExpense(90_000, ['a', 'b', 'c'])).toEqual([
      { deviceId: 'a', amountPaise: 30_000 },
      { deviceId: 'b', amountPaise: 30_000 },
      { deviceId: 'c', amountPaise: 30_000 },
    ])
  })

  it('distributes the remainder one paise at a time, losing nothing', () => {
    const shares = splitExpense(10_000, ['a', 'b', 'c'])

    expect(shares).toEqual([
      { deviceId: 'a', amountPaise: 3334 },
      { deviceId: 'b', amountPaise: 3333 },
      { deviceId: 'c', amountPaise: 3333 },
    ])
    expect(shares.reduce((sum, share) => sum + share.amountPaise, 0)).toBe(10_000)
  })

  it('computes the same shares however the participants are listed', () => {
    expect(splitExpense(10_000, ['c', 'a', 'b'])).toEqual(splitExpense(10_000, ['a', 'b', 'c']))
  })

  it('gives a single participant the whole amount', () => {
    expect(splitExpense(3333, ['a'])).toEqual([{ deviceId: 'a', amountPaise: 3333 }])
  })

  it('refuses invalid amounts and participant lists', () => {
    expect(() => splitExpense(0, ['a'])).toThrow(RangeError)
    expect(() => splitExpense(-1, ['a'])).toThrow(RangeError)
    expect(() => splitExpense(1.5, ['a'])).toThrow(RangeError)
    expect(() => splitExpense(100, [])).toThrow()
    expect(() => splitExpense(100, ['a', 'a'])).toThrow()
  })
})

describe('foldExpenses', () => {
  it('shows every non-payer share outstanding for an Expense with no payments', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
    })

    const state = onlyExpense([dinner])

    expect(state).toMatchObject({
      expenseEntryId: dinner.id,
      amountPaise: 90_000,
      payerDeviceId: rohan.deviceId,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
      owedPaise: 45_000,
      coveredPaise: 0,
      settled: false,
    })
    expect(state.coverage).toEqual([
      {
        deviceId: mira.deviceId,
        sharePaise: 45_000,
        settlements: [],
        paidPaise: 0,
        coveredPaise: 0,
        settled: false,
      },
    ])
  })

  it('counts a partial tagged payment toward its participant only', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 20_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    const state = onlyExpense([dinner, paid])

    expect(state.coveredPaise).toBe(20_000)
    expect(state.settled).toBe(false)
    expect(state.coverage.find((line) => line.deviceId === mira.deviceId)).toEqual({
      deviceId: mira.deviceId,
      sharePaise: 30_000,
      settlements: [expect.objectContaining({ settlementEntryId: paid.id, amountPaise: 20_000 })],
      paidPaise: 20_000,
      coveredPaise: 20_000,
      settled: false,
    })
    expect(state.coverage.find((line) => line.deviceId === kabir.deviceId)).toMatchObject({
      paidPaise: 0,
      coveredPaise: 0,
      settled: false,
    })
  })

  it('settles a participant once their tagged payments cover their share, and the Expense only when all are covered', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
    })
    const miraPaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    const half = onlyExpense([dinner, miraPaid])

    expect(half.coverage.find((line) => line.deviceId === mira.deviceId)?.settled).toBe(true)
    expect(half.coverage.find((line) => line.deviceId === kabir.deviceId)?.settled).toBe(false)
    expect(half.coveredPaise).toBe(30_000)
    expect(half.settled).toBe(false)

    // Two payments from Kabir also count, but only the live, admitted ones.
    const kabirFirst = await pay(kabir, {
      toDeviceId: rohan.deviceId,
      amountPaise: 10_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const kabirSecond = await pay(kabir, {
      toDeviceId: rohan.deviceId,
      amountPaise: 20_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    const whole = onlyExpense([dinner, miraPaid, kabirFirst, kabirSecond])

    expect(whole.coverage.find((line) => line.deviceId === kabir.deviceId)).toMatchObject({
      paidPaise: 30_000,
      coveredPaise: 30_000,
      settled: true,
    })
    expect(whole.owedPaise).toBe(60_000)
    expect(whole.coveredPaise).toBe(60_000)
    expect(whole.settled).toBe(true)
  })

  it('counts only tagged payments in the participant-to-payer direction', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
    })
    const untagged = await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 45_000 })
    const taggedElsewhere = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 45_000,
      tag: { kind: 'expense', entryId: uuidv7() },
    })
    const fromPayer = await pay(rohan, {
      toDeviceId: mira.deviceId,
      amountPaise: 45_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const fromBystander = await pay(kabir, {
      toDeviceId: rohan.deviceId,
      amountPaise: 45_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const taggedToLoan = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 45_000,
      tag: { kind: 'loan', entryId: dinner.id },
    })

    // Untagged money still moves the Balance; it just never touches the item.
    for (const entries of [
      [dinner, untagged],
      [dinner, taggedElsewhere],
      [dinner, fromPayer],
      [dinner, fromBystander],
      [dinner, taggedToLoan],
    ]) {
      expect(onlyExpense(entries)).toMatchObject({ coveredPaise: 0, settled: false })
    }
  })

  it('clamps coverage at the share and reads settled when a participant overpays', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
    })
    const overpaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 60_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    const state = onlyExpense([dinner, overpaid])

    expect(state.coverage[0]).toMatchObject({
      paidPaise: 60_000,
      coveredPaise: 50_000,
      settled: true,
    })
    expect(state.owedPaise).toBe(50_000)
    expect(state.coveredPaise).toBe(50_000)
    expect(state.settled).toBe(true)
  })

  it('needs no coverage for the payer sharing the cost', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
    })

    const state = onlyExpense([dinner])

    expect(state.coverage.map((line) => line.deviceId)).toEqual([mira.deviceId])
    expect(state.owedPaise).toBe(45_000)
  })

  it('yields the same coverage whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 10_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
    })
    const first = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 2000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const second = await pay(kabir, {
      toDeviceId: rohan.deviceId,
      amountPaise: 3334,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const entries = [dinner, first, second]

    expect(foldExpenses([...entries].reverse())).toEqual(foldExpenses(entries))
    expect(foldExpenses([second, dinner, first] as typeof entries)).toEqual(foldExpenses(entries))
  })

  it('folds the same coverage no matter what the Entries claim about the clock', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
      occurredAt: '2999-12-31T23:59:59.999Z',
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 45_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '1970-01-01T00:00:00.000Z',
    })

    expect(onlyExpense([dinner, paid]).coveredPaise).toBe(45_000)
    expect(foldExpenses([dinner, paid])).toEqual(foldExpenses([paid, dinner]))
  })

  it('reopens a covering payment when the tagged Settlement is Voided', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const correction = await voidEntry(rohan, paid.id)

    expect(onlyExpense([dinner, paid]).settled).toBe(true)
    expect(onlyExpense([dinner, paid, correction])).toMatchObject({
      coveredPaise: 0,
      settled: false,
    })
  })

  it('drops a Voided Expense out of the fold with its coverage', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    const correction = await voidEntry(rohan, dinner.id)

    expect(foldExpenses([dinner, paid, correction])).toEqual([])
  })

  it('ignores Expense and Settlement payloads this version cannot read', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const legacyExpense = await makeEntry('legacy expense', {
      type: EXPENSE_ENTRY_TYPE,
      payload: { rupees: 500 },
    })
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 500,
      participantDeviceIds: [mira.deviceId],
    })
    const legacySettlement = await makeEntry('legacy settlement', {
      type: 'settlement',
      payload: {
        from: mira.deviceId,
        to: rohan.deviceId,
        rupees: 5,
        tag: { kind: 'expense', entryId: dinner.id },
      },
    })

    expect(foldExpenses([legacyExpense])).toEqual([])
    expect(onlyExpense([dinner, legacySettlement])).toMatchObject({
      coveredPaise: 0,
      settled: false,
    })
  })

  it('rides the roster-bound admission path like any Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    const admitted = admitEntries([...roster, dinner, paid])

    expect(admitted).toContain(dinner)
    expect(admitted).toContain(paid)
    expect(onlyExpense(admitted).settled).toBe(true)
  })

  it('carries no settledAt while the Expense is open', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId],
      occurredAt: OCCURRED_AT,
    })

    expect(onlyExpense([dinner]).settledAt).toBeUndefined()
  })

  it('settles an Expense that owed nothing from the start at its own clock', async () => {
    const rohan = await makeDevice()
    const lunch = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [rohan.deviceId],
      occurredAt: OCCURRED_AT,
    })

    expect(onlyExpense([lunch])).toMatchObject({ settled: true, settledAt: OCCURRED_AT })
  })

  it('settles at the instant the last owed share was covered, not at the last Settlement', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
      occurredAt: '2026-09-20T10:00:00.000Z',
    })
    const miraPaid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-09-21T10:00:00.000Z',
    })
    const kabirPaid = await pay(kabir, {
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-09-22T10:00:00.000Z',
    })

    expect(onlyExpense([dinner, miraPaid, kabirPaid])).toMatchObject({
      settled: true,
      settledAt: '2026-09-22T10:00:00.000Z',
    })
    // The instant is a pure function of the Entries, so it does not move with
    // the order the book happens to hold them in.
    expect(foldExpenses([kabirPaid, dinner, miraPaid])).toEqual(
      foldExpenses([dinner, miraPaid, kabirPaid]),
    )
  })

  it('keeps the settling instant when a later Settlement arrives, even an overpayment', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
      occurredAt: '2026-09-20T10:00:00.000Z',
    })
    const settled = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-09-21T10:00:00.000Z',
    })
    const extra = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 10_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '2026-09-25T10:00:00.000Z',
    })

    expect(onlyExpense([dinner, settled, extra])).toMatchObject({
      settled: true,
      settledAt: '2026-09-21T10:00:00.000Z',
    })
  })

  it('never settles an Expense before its own clock says it existed', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 50_000,
      participantDeviceIds: [mira.deviceId],
      occurredAt: '2026-09-20T10:00:00.000Z',
    })
    const paid = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 50_000,
      tag: { kind: 'expense', entryId: dinner.id },
      occurredAt: '1970-01-01T00:00:00.000Z',
    })

    expect(onlyExpense([dinner, paid]).settledAt).toBe('2026-09-20T10:00:00.000Z')
  })

  it('is empty for a book with no Expenses', async () => {
    const rohan = await makeDevice()

    expect(foldExpenses([])).toEqual([])
    expect(foldExpenses([await makeMemberEntry(rohan, 'Rohan')])).toEqual([])
  })
})
