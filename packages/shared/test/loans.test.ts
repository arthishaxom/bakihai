import { describe, expect, it } from 'vitest'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import {
  createLoanEntry,
  createReturnEntry,
  foldLoans,
  type LoanState,
  loanEntryPayloadSchema,
  readLoanPayload,
  readReturnPayload,
} from '../src/group/loans'
import { createVoidEntry } from '../src/group/voids'
import { uuidv7 } from '../src/uuidv7'
import {
  makeDevice,
  makeEntry,
  makeExpenseEntry,
  makeMemberEntry,
  type TestDevice,
} from './helpers/entries'

/** Writes a Loan as `device`, defaulting the lender to the device itself. */
function lend(
  device: TestDevice,
  payload: {
    itemLabel: string
    quantityHundredths: number
    unit?: string
    borrowerDeviceId: string
    lenderDeviceId?: string
    occurredAt?: string
  },
): Promise<Awaited<ReturnType<typeof createLoanEntry>>> {
  return createLoanEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    lenderDeviceId: device.deviceId,
    ...payload,
  })
}

/** Writes a Return as `device`. */
function recordReturn(
  device: TestDevice,
  loanEntryId: string,
  quantityHundredths: number,
  occurredAt?: string,
): Promise<Awaited<ReturnType<typeof createReturnEntry>>> {
  return createReturnEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    loanEntryId,
    quantityHundredths,
    ...(occurredAt === undefined ? {} : { occurredAt }),
  })
}

/** The fold's one item, failing loudly when the book holds none or several. */
function onlyLoan(entries: Parameters<typeof foldLoans>[0]): LoanState {
  const states = foldLoans(entries)

  expect(states).toHaveLength(1)

  return states[0] as LoanState
}

describe('createLoanEntry', () => {
  it('writes a signed Loan carrying its item, quantity, unit, and direction', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()

    const loan = await lend(rohan, {
      itemLabel: 'rice',
      quantityHundredths: 150,
      unit: 'kg',
      borrowerDeviceId: mira.deviceId,
    })

    expect(loan.type).toBe('loan')
    expect(loan.authorDeviceId).toBe(rohan.deviceId)
    await expect(verifyEntryEnvelope(loan)).resolves.toEqual(loan)
    expect(loan.payload).toEqual({
      itemLabel: 'rice',
      quantityHundredths: 150,
      unit: 'kg',
      lenderDeviceId: rohan.deviceId,
      borrowerDeviceId: mira.deviceId,
    })
    expect(readLoanPayload(loan)).toEqual({
      itemLabel: 'rice',
      quantityHundredths: 150,
      unit: 'kg',
      lenderDeviceId: rohan.deviceId,
      borrowerDeviceId: mira.deviceId,
    })
  })

  it('trims the item and unit and leaves a blank unit out entirely', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const write = (unit: string) =>
      lend(rohan, {
        itemLabel: '  eggs  ',
        quantityHundredths: 300,
        unit,
        borrowerDeviceId: mira.deviceId,
      })

    expect(loanEntryPayloadSchema.parse((await write('  dozen ')).payload)).toEqual({
      itemLabel: 'eggs',
      quantityHundredths: 300,
      unit: 'dozen',
      lenderDeviceId: rohan.deviceId,
      borrowerDeviceId: mira.deviceId,
    })
    expect(loanEntryPayloadSchema.parse((await write('   ')).payload)).toEqual({
      itemLabel: 'eggs',
      quantityHundredths: 300,
      lenderDeviceId: rohan.deviceId,
      borrowerDeviceId: mira.deviceId,
    })
  })

  it('refuses a quantity that is not a positive integer number of hundredths', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const write = (quantityHundredths: number) =>
      lend(rohan, {
        itemLabel: 'eggs',
        quantityHundredths,
        borrowerDeviceId: mira.deviceId,
      })

    await expect(write(0)).rejects.toThrow()
    await expect(write(-100)).rejects.toThrow()
    await expect(write(1.5)).rejects.toThrow()
    await expect(write(Number.NaN)).rejects.toThrow()
  })
})

describe('createReturnEntry', () => {
  it('writes a signed Return naming its Loan and quantity', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })

    const returned = await recordReturn(mira, loan.id, 150)

    expect(returned.type).toBe('return')
    expect(returned.authorDeviceId).toBe(mira.deviceId)
    await expect(verifyEntryEnvelope(returned)).resolves.toEqual(returned)
    expect(returned.payload).toEqual({ loanEntryId: loan.id, quantityHundredths: 150 })
    expect(readReturnPayload(returned)).toEqual({ loanEntryId: loan.id, quantityHundredths: 150 })
  })

  it('reads nothing from an Entry of another type or an unreadable payload', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const legacyLoan = await makeEntry('legacy loan', {
      type: 'loan',
      payload: { item: 'eggs', taken: 3 },
    })
    const legacyReturn = await makeEntry('legacy return', {
      type: 'return',
      payload: { loan: dinner.id, given: 1 },
    })

    expect(readLoanPayload(dinner)).toBeUndefined()
    expect(readLoanPayload(legacyLoan)).toBeUndefined()
    expect(readReturnPayload(dinner)).toBeUndefined()
    expect(readReturnPayload(legacyReturn)).toBeUndefined()
  })
})

describe('foldLoans', () => {
  it('shows the whole quantity outstanding for a Loan with no Returns', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })

    const state = onlyLoan([loan])

    expect(state).toMatchObject({
      loanEntryId: loan.id,
      itemLabel: 'eggs',
      lenderDeviceId: rohan.deviceId,
      borrowerDeviceId: mira.deviceId,
      quantityHundredths: 300,
      returnedHundredths: 0,
      remainingHundredths: 300,
      overReturnedByHundredths: 0,
      settled: false,
    })
    expect(state.returns).toEqual([])
  })

  it('lowers the remainder by a partial Return, exact in hundredths', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'rice',
      quantityHundredths: 325,
      unit: 'kg',
      borrowerDeviceId: mira.deviceId,
    })
    const returned = await recordReturn(mira, loan.id, 150)

    const state = onlyLoan([loan, returned])

    expect(state.returnedHundredths).toBe(150)
    expect(state.remainingHundredths).toBe(175)
    expect(state.settled).toBe(false)
    expect(state.returns).toEqual([{ entry: returned, quantityHundredths: 150 }])
  })

  it('sums several Returns exactly and settles at zero', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'rice',
      quantityHundredths: 1000,
      unit: 'g',
      borrowerDeviceId: mira.deviceId,
    })
    const first = await recordReturn(mira, loan.id, 333)
    const second = await recordReturn(rohan, loan.id, 667)

    const state = onlyLoan([loan, first, second])

    expect(state.returnedHundredths).toBe(1000)
    expect(state.remainingHundredths).toBe(0)
    expect(state.overReturnedByHundredths).toBe(0)
    expect(state.settled).toBe(true)
  })

  it('clamps an over-return race at zero and marks how far over it went', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    // Two phones offline: each Returns what it saw left, and together they pass zero.
    const first = await recordReturn(mira, loan.id, 250)
    const second = await recordReturn(rohan, loan.id, 100)

    const state = onlyLoan([loan, first, second])

    expect(state.returnedHundredths).toBe(350)
    expect(state.remainingHundredths).toBe(0)
    expect(state.overReturnedByHundredths).toBe(50)
    expect(state.settled).toBe(true)
  })

  it('yields the same item whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    const first = await recordReturn(mira, loan.id, 250)
    const second = await recordReturn(rohan, loan.id, 100)
    const entries = [loan, first, second]

    expect(foldLoans([...entries].reverse())).toEqual(foldLoans(entries))
    expect(foldLoans([second, loan, first] as typeof entries)).toEqual(foldLoans(entries))
  })

  it('folds the same item no matter what the Entries claim about the clock', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
      occurredAt: '2999-12-31T23:59:59.999Z',
    })
    const returned = await recordReturn(mira, loan.id, 150, '1970-01-01T00:00:00.000Z')

    const state = onlyLoan([loan, returned])

    expect(state.remainingHundredths).toBe(150)
    expect(foldLoans([loan, returned])).toEqual(foldLoans([returned, loan]))
  })

  it('lists Returns in Entry id order, whatever order they arrived in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    const first = await recordReturn(mira, loan.id, 100)
    const second = await recordReturn(mira, loan.id, 50)
    const state = onlyLoan([loan, second, first])

    expect(state.returns.map((returned) => returned.entry.id)).toEqual([first.id, second.id].sort())
  })

  it('ignores a Return naming a Loan that is not in the book', async () => {
    const mira = await makeDevice()
    const orphan = await recordReturn(mira, uuidv7(), 150)

    expect(foldLoans([orphan])).toEqual([])
  })

  it('ignores Loan and Return payloads this version cannot read', async () => {
    const legacyLoan = await makeEntry('legacy loan', {
      type: 'loan',
      payload: { item: 'eggs', taken: 3 },
    })
    const legacyReturn = await makeEntry('legacy return', {
      type: 'return',
      payload: { loan: legacyLoan.id, given: 1 },
    })

    expect(foldLoans([legacyLoan, legacyReturn])).toEqual([])
  })

  it('drops a Voided Loan and its Returns', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    const returned = await recordReturn(mira, loan.id, 150)
    const voidEntry = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: loan.id,
      reason: 'never happened',
    })

    expect(foldLoans([loan, returned, voidEntry])).toEqual([])
  })

  it('reopens the remainder when a Return is Voided', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    const returned = await recordReturn(mira, loan.id, 300)
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: returned.id,
      reason: 'wrong item',
    })

    expect(onlyLoan([loan, returned])).toMatchObject({
      remainingHundredths: 0,
      settled: true,
    })
    expect(onlyLoan([loan, returned, voidEntry])).toMatchObject({
      returnedHundredths: 0,
      remainingHundredths: 300,
      settled: false,
    })
  })

  it('rides the roster-bound admission path like any Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const loan = await lend(rohan, {
      itemLabel: 'eggs',
      quantityHundredths: 300,
      borrowerDeviceId: mira.deviceId,
    })
    const returned = await recordReturn(mira, loan.id, 150)

    const admitted = admitEntries([...roster, loan, returned])

    expect(admitted).toContain(loan)
    expect(admitted).toContain(returned)
    expect(onlyLoan(admitted).remainingHundredths).toBe(150)
  })

  it('is empty for a book with no Loans', async () => {
    const rohan = await makeDevice()

    expect(foldLoans([])).toEqual([])
    expect(foldLoans([await makeMemberEntry(rohan, 'Rohan')])).toEqual([])
  })
})
