import { describe, expect, it } from 'vitest'
import { foldBalances } from '../src/group/balances'
import { createSettlementEntry } from '../src/group/settlements'
import { createVoidEntry } from '../src/group/voids'
import { uuidv7 } from '../src/uuidv7'
import { makeDevice, makeEntry, makeExpenseEntry, type TestDevice } from './helpers/entries'

/** Writes a Settlement as `device`, defaulting the payer to the device itself. */
function pay(
  device: TestDevice,
  payload: { toDeviceId: string; amountPaise: number; fromDeviceId?: string },
): Promise<Awaited<ReturnType<typeof createSettlementEntry>>> {
  return createSettlementEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    fromDeviceId: device.deviceId,
    ...payload,
  })
}

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

  it('subtracts a Settlement from what the payer owes', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, { amountPaise: 90_000, participantDeviceIds: [mira.deviceId] }),
      await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 90_000 }),
    ]

    expect(foldBalances(entries)).toEqual([])
  })

  it('counts a payer-written claim and a receiver-written Settlement alike, and immediately', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const expense = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    // Mira, the payer, claims she paid half; nothing is confirmed yet, but the
    // Balance moves all the same (ADR-0007).
    const claim = await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 45_000 })
    // Rohan, the receiver, records the other half himself: already confirmed
    // (ADR-0015), and the arithmetic is the same either way.
    const received = await pay(rohan, {
      fromDeviceId: mira.deviceId,
      toDeviceId: rohan.deviceId,
      amountPaise: 45_000,
    })

    expect(foldBalances([expense, claim])).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 45_000 },
    ])
    expect(foldBalances([expense, received])).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 45_000 },
    ])
    expect(foldBalances([expense, claim, received])).toEqual([])
  })

  it('flips the direction when a Settlement overpays', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, { amountPaise: 10_000, participantDeviceIds: [mira.deviceId] }),
      await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 12_000 }),
    ]

    expect(foldBalances(entries)).toEqual([
      { debtorDeviceId: rohan.deviceId, creditorDeviceId: mira.deviceId, amountPaise: 2000 },
    ])
  })

  it('creates a reverse Balance for a Settlement against no Expense', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()

    // Money moved from Mira to Rohan, so Rohan is the one who owes now.
    expect(
      foldBalances([await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 5000 })]),
    ).toEqual([
      { debtorDeviceId: rohan.deviceId, creditorDeviceId: mira.deviceId, amountPaise: 5000 },
    ])
  })

  it('drops a Voided Settlement from the net', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const expense = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const settlement = await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 90_000 })
    const voidEntry = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: settlement.id,
      reason: 'never arrived',
    })

    expect(foldBalances([expense, settlement])).toEqual([])
    expect(foldBalances([expense, settlement, voidEntry])).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 90_000 },
    ])
  })

  it('yields the same Balances whatever order Settlements arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: 90_000,
        participantDeviceIds: [rohan.deviceId, mira.deviceId, kabir.deviceId],
      }),
      await pay(mira, { toDeviceId: rohan.deviceId, amountPaise: 10_000 }),
      await pay(kabir, { toDeviceId: rohan.deviceId, amountPaise: 5000 }),
      await pay(rohan, {
        fromDeviceId: mira.deviceId,
        toDeviceId: rohan.deviceId,
        amountPaise: 2000,
      }),
    ]
    const expected = foldBalances(entries)

    expect(foldBalances([...entries].reverse())).toEqual(expected)
    expect(
      foldBalances([entries[2], entries[0], entries[3], entries[1]] as typeof entries),
    ).toEqual(expected)
  })

  it('saturates a net that leaves exact integer arithmetic, in any order', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    // Two crafted Expenses can each claim the largest amount the schema holds,
    // so their sum leaves the range where integer arithmetic is exact. The net
    // saturates at the ceiling instead of handing the screens a number no
    // formatter can read.
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: Number.MAX_SAFE_INTEGER,
        participantDeviceIds: [mira.deviceId],
      }),
      await makeExpenseEntry(rohan, {
        amountPaise: Number.MAX_SAFE_INTEGER,
        participantDeviceIds: [mira.deviceId],
      }),
    ]
    const expected = [
      {
        debtorDeviceId: mira.deviceId,
        creditorDeviceId: rohan.deviceId,
        amountPaise: Number.MAX_SAFE_INTEGER,
      },
    ]

    expect(foldBalances(entries)).toEqual(expected)
    expect(foldBalances([...entries].reverse())).toEqual(expected)
  })

  it('saturates an absurd net between a Member and their person with no phone', async () => {
    const rohan = await makeDevice()
    const rohitId = uuidv7()
    // The same crafted pair, with one side a Shadow Member: the fold treats
    // the id like any other, so the pair saturates rather than blanking.
    const entries = [
      await makeExpenseEntry(rohan, {
        amountPaise: Number.MAX_SAFE_INTEGER,
        participantDeviceIds: [rohitId],
      }),
      await makeExpenseEntry(rohan, {
        amountPaise: Number.MAX_SAFE_INTEGER,
        participantDeviceIds: [rohitId],
      }),
    ]
    const expected = [
      {
        debtorDeviceId: rohitId,
        creditorDeviceId: rohan.deviceId,
        amountPaise: Number.MAX_SAFE_INTEGER,
      },
    ]

    expect(foldBalances(entries)).toEqual(expected)
    expect(foldBalances([...entries].reverse())).toEqual(expected)
  })

  it('ignores a Settlement payload this version cannot read', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await makeEntry('legacy settlement payload', {
        type: 'settlement',
        payload: { from: mira.deviceId, to: rohan.deviceId, rupees: 120 },
      }),
    ]

    expect(foldBalances(entries)).toEqual([])
  })

  it('is empty for a book with no Expenses', () => {
    expect(foldBalances([])).toEqual([])
  })
})
