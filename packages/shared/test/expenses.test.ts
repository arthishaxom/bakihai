import { describe, expect, it } from 'vitest'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { EXPENSE_ENTRY_TYPE, splitExpense } from '../src/group/expenses'
import { makeDevice, makeExpenseEntry } from './helpers/entries'

const OCCURRED_AT = '2026-09-20T10:00:00.000Z'

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
