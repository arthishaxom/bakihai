import { describe, expect, it } from 'vitest'
import { compareText } from '../src/compare'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import {
  createSettlementConfirmEntry,
  createSettlementEntry,
  foldSettlements,
  foldSettlementsAwaitingConfirmation,
  readSettlementConfirmPayload,
  readSettlementPayload,
  type SettlementState,
  type SettlementTag,
  settlementEntryPayloadSchema,
} from '../src/group/settlements'
import { createVoidEntry } from '../src/group/voids'
import { uuidv7 } from '../src/uuidv7'
import {
  makeDevice,
  makeEntry,
  makeExpenseEntry,
  makeMemberEntry,
  type TestDevice,
} from './helpers/entries'

/** Writes a Settlement as `device`, defaulting the payer to the device itself. */
function pay(
  device: TestDevice,
  payload: {
    toDeviceId: string
    amountPaise: number
    fromDeviceId?: string
    note?: string
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

/** Writes a Confirm as `device`. */
function confirm(
  device: TestDevice,
  settlementEntryId: string,
  occurredAt?: string,
): Promise<Awaited<ReturnType<typeof createSettlementConfirmEntry>>> {
  return createSettlementConfirmEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    settlementEntryId,
    ...(occurredAt === undefined ? {} : { occurredAt }),
  })
}

/** Voids an Entry as `device`. */
function voidEntry(
  device: TestDevice,
  targetEntryId: string,
  reason?: string,
): Promise<Awaited<ReturnType<typeof createVoidEntry>>> {
  return createVoidEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    targetEntryId,
    ...(reason === undefined ? {} : { reason }),
  })
}

/** The fold's one Settlement, failing loudly when the book holds none or several. */
function onlySettlement(entries: Parameters<typeof foldSettlements>[0]): SettlementState {
  const states = foldSettlements(entries)

  expect(states).toHaveLength(1)

  return states[0] as SettlementState
}

describe('createSettlementEntry', () => {
  it('writes a signed Settlement carrying its payer, receiver, amount, and note', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()

    const settlement = await pay(rohan, {
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
      note: 'for dinner',
    })

    expect(settlement.type).toBe('settlement')
    expect(settlement.authorDeviceId).toBe(rohan.deviceId)
    await expect(verifyEntryEnvelope(settlement)).resolves.toEqual(settlement)
    expect(settlement.payload).toEqual({
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
      note: 'for dinner',
    })
    expect(readSettlementPayload(settlement)).toEqual({
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
      note: 'for dinner',
    })
  })

  it('trims the note and leaves a blank one out entirely', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const write = (note: string) =>
      pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 500, note })

    expect(settlementEntryPayloadSchema.parse((await write('  chai  ')).payload)).toEqual({
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 500,
      note: 'chai',
    })
    expect(settlementEntryPayloadSchema.parse((await write('   ')).payload)).toEqual({
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 500,
    })
  })

  it('refuses a Settlement to the payer themselves and an amount that is not positive paise', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const write = (toDeviceId: string, amountPaise: number) =>
      pay(rohan, { toDeviceId, amountPaise })

    await expect(write(rohan.deviceId, 500)).rejects.toThrow()
    await expect(write(mira.deviceId, 0)).rejects.toThrow()
    await expect(write(mira.deviceId, -100)).rejects.toThrow()
    await expect(write(mira.deviceId, 1.5)).rejects.toThrow()
    await expect(write(mira.deviceId, Number.NaN)).rejects.toThrow()
  })

  it('carries an optional tag naming the Expense or Loan it pays off', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })

    const tagged = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    expect(tagged.payload).toEqual({
      fromDeviceId: mira.deviceId,
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })
    expect(readSettlementPayload(tagged)?.tag).toEqual({ kind: 'expense', entryId: dinner.id })
  })

  it('leaves a missing tag out of the payload and refuses a tag this version cannot read', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const write = (tag: unknown) =>
      createSettlementEntry({
        deviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        privateKey: rohan.keyPair.privateKey,
        fromDeviceId: rohan.deviceId,
        toDeviceId: mira.deviceId,
        amountPaise: 500,
        ...(tag === undefined ? {} : { tag: tag as never }),
      })

    expect((await write(undefined)).payload).toEqual({
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 500,
    })
    await expect(write({ kind: 'item', entryId: uuidv7() })).rejects.toThrow()
    await expect(write({ kind: 'expense', entryId: 'not-an-entry-id' })).rejects.toThrow()
  })
})

describe('createSettlementConfirmEntry', () => {
  it('writes a signed Confirm naming its Settlement', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })

    const confirmed = await confirm(mira, settlement.id)

    expect(confirmed.type).toBe('settlement-confirm')
    expect(confirmed.authorDeviceId).toBe(mira.deviceId)
    await expect(verifyEntryEnvelope(confirmed)).resolves.toEqual(confirmed)
    expect(confirmed.payload).toEqual({ settlementEntryId: settlement.id })
    expect(readSettlementConfirmPayload(confirmed)).toEqual({ settlementEntryId: settlement.id })
  })

  it('reads nothing from an Entry of another type or an unreadable payload', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const legacySettlement = await makeEntry('legacy settlement', {
      type: 'settlement',
      payload: { from: rohan.deviceId, to: mira.deviceId, rupees: 120 },
    })
    const legacyConfirm = await makeEntry('legacy confirm', {
      type: 'settlement-confirm',
      payload: { settlement: dinner.id },
    })
    const legacyTag = await makeEntry('legacy tag', {
      type: 'settlement',
      payload: {
        fromDeviceId: rohan.deviceId,
        toDeviceId: mira.deviceId,
        amountPaise: 100,
        tag: 'dinner',
      },
    })

    expect(readSettlementPayload(dinner)).toBeUndefined()
    expect(readSettlementPayload(legacySettlement)).toBeUndefined()
    expect(readSettlementConfirmPayload(dinner)).toBeUndefined()
    expect(readSettlementConfirmPayload(legacyConfirm)).toBeUndefined()
    expect(readSettlementPayload(legacyTag)).toBeUndefined()
  })
})

describe('foldSettlements', () => {
  it('marks a Settlement its payer wrote as unconfirmed', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })

    const state = onlySettlement([settlement])

    expect(state).toMatchObject({
      settlementEntryId: settlement.id,
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
      confirmed: false,
    })
    expect(state.confirmation).toBeUndefined()
  })

  it("marks a Settlement the receiver's own device wrote as already confirmed", async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    // The receiver records "Rohan paid me": nothing is left to attest (ADR-0015).
    const settlement = await pay(mira, {
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
    })

    const state = onlySettlement([...roster, settlement])

    expect(state.fromDeviceId).toBe(rohan.deviceId)
    expect(state.toDeviceId).toBe(mira.deviceId)
    expect(state.confirmed).toBe(true)
  })

  it('exposes the tag naming the Expense or Loan the Settlement pays off', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const tagged = await pay(mira, {
      toDeviceId: rohan.deviceId,
      amountPaise: 30_000,
      tag: { kind: 'expense', entryId: dinner.id },
    })

    expect(onlySettlement([tagged]).tag).toEqual({ kind: 'expense', entryId: dinner.id })
    // The tagging participant paid the other Member, so it is a claim like any
    // payer-written Settlement; coverage never waits on a Confirm (ADR-0007).
    expect(onlySettlement([tagged]).confirmed).toBe(false)
  })

  it('marks a payer-written Settlement confirmed once its receiver writes a Confirm', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const confirmed = await confirm(mira, settlement.id)

    const state = onlySettlement([...roster, settlement, confirmed])

    expect(state.confirmed).toBe(true)
    expect(state.confirmation).toEqual(confirmed)
  })

  it('ignores a Confirm from a device that is not the receiver', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const roster = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await makeMemberEntry(kabir, 'Kabir'),
    ]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const fromPayer = await confirm(rohan, settlement.id)
    const fromBystander = await confirm(kabir, settlement.id)

    expect(onlySettlement([...roster, settlement, fromPayer]).confirmed).toBe(false)
    expect(onlySettlement([...roster, settlement, fromBystander]).confirmed).toBe(false)
  })

  it('confirms a Settlement to a person with no phone when its key holder wrote it', async () => {
    const rohan = await makeDevice()
    const rohitId = uuidv7()
    const roster = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
    ]
    // Rohan records "I paid Rohit": he holds Rohit's key, so his authorship is
    // the receiver's side of the book (ADR-0021).
    const settlement = await pay(rohan, { toDeviceId: rohitId, amountPaise: 12_000 })

    expect(onlySettlement([...roster, settlement]).confirmed).toBe(true)
    expect(foldSettlementsAwaitingConfirmation([...roster, settlement])).toEqual([])
  })

  it('accepts a Confirm the key holder writes for a claim someone else recorded', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const rohitId = uuidv7()
    const roster = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
    ]
    // Mira claims she paid Rohit; only Rohan, who holds Rohit's key, can attest.
    const settlement = await pay(mira, {
      fromDeviceId: mira.deviceId,
      toDeviceId: rohitId,
      amountPaise: 12_000,
    })
    const confirmed = await confirm(rohan, settlement.id)

    expect(onlySettlement([...roster, settlement]).confirmed).toBe(false)
    expect(onlySettlement([...roster, settlement, confirmed]).confirmed).toBe(true)
    expect(foldSettlementsAwaitingConfirmation([...roster, settlement, confirmed])).toEqual([])
  })

  it('ignores a Confirm for a person with no phone from a device that does not hold its key', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const rohitId = uuidv7()
    const roster = [
      await makeMemberEntry(rohan, 'Rohan'),
      await makeMemberEntry(mira, 'Mira'),
      await makeMemberEntry(kabir, 'Kabir'),
      await makeMemberEntry({ ...rohan, deviceId: rohitId }, 'Rohit'),
    ]
    const settlement = await pay(mira, {
      fromDeviceId: mira.deviceId,
      toDeviceId: rohitId,
      amountPaise: 12_000,
    })
    const fromBystander = await confirm(kabir, settlement.id)

    expect(onlySettlement([...roster, settlement, fromBystander]).confirmed).toBe(false)
  })

  it('ignores a Confirm naming a Settlement that is not in the book', async () => {
    const mira = await makeDevice()
    const orphan = await confirm(mira, uuidv7())

    expect(foldSettlements([orphan])).toEqual([])
  })

  it('picks the earliest Confirm by Entry id when two name one Settlement', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const first = await confirm(mira, settlement.id)
    const second = await confirm(mira, settlement.id)
    const earliestId = [first.id, second.id].sort(compareText)[0]

    expect(onlySettlement([...roster, settlement, first, second]).confirmation?.id).toBe(earliestId)
    expect(onlySettlement([...roster, settlement, second, first]).confirmation?.id).toBe(earliestId)
  })

  it('drops a Voided Settlement and ignores a Confirm naming it', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const voided = await voidEntry(rohan, settlement.id, 'wrong amount')
    const lateConfirm = await confirm(mira, settlement.id)

    expect(foldSettlements([settlement, voided])).toEqual([])
    expect(foldSettlements([settlement, voided, lateConfirm])).toEqual([])
  })

  it('reopens an unconfirmed Settlement when its Confirm is Voided', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const confirmed = await confirm(mira, settlement.id)
    const voidedConfirm = await voidEntry(mira, confirmed.id)

    expect(onlySettlement([...roster, settlement, confirmed]).confirmed).toBe(true)
    expect(onlySettlement([...roster, settlement, confirmed, voidedConfirm]).confirmed).toBe(false)
  })

  it('yields the same states whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const confirmed = await confirm(mira, settlement.id)
    const entries = [settlement, confirmed]

    expect(foldSettlements([...entries].reverse())).toEqual(foldSettlements(entries))
  })

  it('folds the same states no matter what the Entries claim about the clock', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, {
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
      occurredAt: '2999-12-31T23:59:59.999Z',
    })
    const confirmed = await confirm(mira, settlement.id, '1970-01-01T00:00:00.000Z')

    expect(onlySettlement([...roster, settlement, confirmed]).confirmed).toBe(true)
    expect(foldSettlements([...roster, settlement, confirmed])).toEqual(
      foldSettlements([...roster, confirmed, settlement]),
    )
  })

  it('ignores Settlement and Confirm payloads this version cannot read', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const legacySettlement = await makeEntry('legacy settlement', {
      type: 'settlement',
      payload: { from: rohan.deviceId, to: mira.deviceId, rupees: 120 },
    })
    const legacyConfirm = await makeEntry('legacy confirm', {
      type: 'settlement-confirm',
      payload: { settlement: legacySettlement.id },
    })

    expect(foldSettlements([legacySettlement, legacyConfirm])).toEqual([])
  })

  it('rides the roster-bound admission path like any Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const confirmed = await confirm(mira, settlement.id)

    const admitted = admitEntries([...roster, settlement, confirmed])

    expect(admitted).toContain(settlement)
    expect(admitted).toContain(confirmed)
    expect(onlySettlement(admitted).confirmed).toBe(true)
  })

  it('is empty for a book with no Settlements', async () => {
    const rohan = await makeDevice()

    expect(foldSettlements([])).toEqual([])
    expect(foldSettlements([await makeMemberEntry(rohan, 'Rohan')])).toEqual([])
  })
})

describe('foldSettlementsAwaitingConfirmation', () => {
  it('lists a payer-written claim until its receiver confirms', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(rohan, { toDeviceId: mira.deviceId, amountPaise: 12_000 })
    const confirmed = await confirm(mira, settlement.id)

    expect(foldSettlementsAwaitingConfirmation([...roster, settlement])).toHaveLength(1)
    expect(foldSettlementsAwaitingConfirmation([...roster, settlement, confirmed])).toEqual([])
  })

  it('never lists a Settlement its receiver wrote', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const settlement = await pay(mira, {
      fromDeviceId: rohan.deviceId,
      toDeviceId: mira.deviceId,
      amountPaise: 12_000,
    })

    expect(foldSettlementsAwaitingConfirmation([...roster, settlement])).toEqual([])
  })

  it('is empty for a book with no Settlements', () => {
    expect(foldSettlementsAwaitingConfirmation([])).toEqual([])
  })
})
