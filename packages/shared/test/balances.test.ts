import { describe, expect, it } from 'vitest'
import { foldBalances } from '../src/group/balances'
import { makeDevice, makeEntry, makeExpenseEntry } from './helpers/entries'

describe('foldBalances', () => {
  it('shows each other participant owing the payer their share of a shared dinner', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
      }),
    ]

    const balances = foldBalances(entries)

    expect(balances).toHaveLength(2)
    expect(balances).toEqual(
      expect.arrayContaining([
        { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 30_000 },
        { debtorDeviceId: kabir.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 30_000 },
      ]),
    )
  })

  it('charges the full amount to others when the payer is not in the split', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [mira.deviceId, kabir.deviceId],
      }),
    ]

    expect(foldBalances(entries)).toEqual(
      expect.arrayContaining([
        { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 45_000 },
        { debtorDeviceId: kabir.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 45_000 },
      ]),
    )
  })

  it('nets what two Members owe each other across Entries', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 10_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId],
      }),
      await makeExpenseEntry(mira, {
        amountPaise: 4000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId],
      }),
    ]

    expect(foldBalances(entries)).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 3000 },
    ])
  })

  it('drops a pair whose balance nets to zero', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, { amountPaise: 5000, participantDeviceIds: [mira.deviceId] }),
      await makeExpenseEntry(mira, { amountPaise: 5000, participantDeviceIds: [rohan.deviceId] }),
    ]

    expect(foldBalances(entries)).toEqual([])
  })

  it('yields the same Balances whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
      }),
      await makeExpenseEntry(mira, { amountPaise: 3000, participantDeviceIds: [rohan.deviceId] }),
      await makeExpenseEntry(kabir, {
        amountPaise: 1500,
        participantDeviceIds: [mira.deviceId, kabir.deviceId],
      }),
    ]
    const expected = foldBalances(entries)

    expect(foldBalances([...entries].reverse())).toEqual(expected)
    expect(foldBalances([entries[2], entries[0], entries[1]] as typeof entries)).toEqual(expected)
  })

  it('folds the same Balances no matter what the Entries claim about the clock', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId],
        occurredAt: '1970-01-01T00:00:00.000Z',
      }),
      await makeExpenseEntry(mira, {
        amountPaise: 4000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId],
        occurredAt: '2999-12-31T23:59:59.999Z',
      }),
    ]

    // Time orders the ledger for reading; it never moves a paise.
    expect(foldBalances(entries)).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 43_000 },
    ])
    expect(foldBalances([...entries].reverse())).toEqual(foldBalances(entries))
  })

  it('creates no balance for an Expense only its payer shares', async () => {
    const rohan = await makeDevice()

    expect(
      foldBalances([
        await makeExpenseEntry(rohan, {
          amountPaise: 5000,
          participantDeviceIds: [rohan.deviceId],
        }),
      ]),
    ).toEqual([])
  })

  it('ignores Entries that are not readable Expenses', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeEntry('legacy expense payload', {
        type: 'expense',
        payload: { note: 'dinner', amountPaise: 90_000 },
      }),
      await makeEntry('not an expense at all', { type: 'mystery', payload: { amountPaise: 100 } }),
      await makeExpenseEntry(rohan, { amountPaise: 10_000, participantDeviceIds: [mira.deviceId] }),
    ]

    expect(foldBalances(entries)).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 10_000 },
    ])
  })

  it('is empty for a book with no Expenses', () => {
    expect(foldBalances([])).toEqual([])
  })
})
