import { describe, expect, it } from 'vitest'
import { verifyEntryEnvelope } from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import { foldBalances } from '../src/group/balances'
import {
  canVoidEntry,
  createVoidEntry,
  foldVoids,
  readVoidPayload,
  VOID_REASON_MAX_LENGTH,
  voidEntryPayloadSchema,
} from '../src/group/voids'
import { makeDevice, makeEntry, makeExpenseEntry, makeMemberEntry } from './helpers/entries'

describe('createVoidEntry', () => {
  it('writes a signed Void naming its target and its reason', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })

    const voidEntry = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'wrong amount',
    })

    expect(voidEntry.type).toBe('void')
    expect(voidEntry.authorDeviceId).toBe(rohan.deviceId)
    await expect(verifyEntryEnvelope(voidEntry)).resolves.toEqual(voidEntry)
    expect(readVoidPayload(voidEntry)).toEqual({
      targetEntryId: dinner.id,
      reason: 'wrong amount',
    })
  })

  it('trims the reason and leaves it out when it is blank', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const write = (reason: string) =>
      createVoidEntry({
        deviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        privateKey: rohan.keyPair.privateKey,
        targetEntryId: dinner.id,
        reason,
      })

    expect(readVoidPayload(await write('  typo  '))).toEqual({
      targetEntryId: dinner.id,
      reason: 'typo',
    })
    expect(readVoidPayload(await write('   '))).toEqual({ targetEntryId: dinner.id })
  })

  it('refuses a reason longer than the cap', () => {
    expect(() =>
      voidEntryPayloadSchema.parse({
        targetEntryId: '0198c9a0-0000-7000-8000-000000000000',
        reason: 'x'.repeat(VOID_REASON_MAX_LENGTH + 1),
      }),
    ).toThrow()
  })
})

describe('canVoidEntry', () => {
  it('allows any Entry except a Member Entry and a Void', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const member = await makeMemberEntry(rohan, 'Rohan')
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
    })

    expect(canVoidEntry(dinner)).toBe(true)
    expect(canVoidEntry(member)).toBe(false)
    expect(canVoidEntry(voidEntry)).toBe(false)
  })
})

describe('foldVoids', () => {
  it('folds a Void onto the Entry it cancels, whoever wrote it', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'duplicate',
    })

    const voids = foldVoids([dinner, voidEntry])

    expect([...voids.keys()]).toEqual([dinner.id])
    expect(voids.get(dinner.id)).toBe(voidEntry)
  })

  it('is ignored when the target is a Member Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const member = await makeMemberEntry(rohan, 'Rohan')
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: member.id,
    })

    expect(foldVoids([member, voidEntry]).size).toBe(0)
  })

  it('is ignored when the target is another Void', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const first = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
    })
    const second = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: first.id,
    })

    const voids = foldVoids([dinner, first, second])

    expect([...voids.keys()]).toEqual([dinner.id])
    expect(voids.get(dinner.id)).toBe(first)
  })

  it('is ignored when the target is not in the book', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
    })

    expect(foldVoids([voidEntry]).size).toBe(0)
  })

  it('ignores a Void whose payload this version cannot read', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const legacy = await makeEntry('legacy void', {
      type: 'void',
      payload: { target: dinner.id },
    })

    expect(foldVoids([dinner, legacy]).size).toBe(0)
  })

  it('picks one voider deterministically when two Voids name the same Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const kabir = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId, kabir.deviceId],
    })
    const first = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'first',
    })
    const second = await createVoidEntry({
      deviceId: kabir.deviceId,
      signerPublicKey: kabir.signerPublicKey,
      privateKey: kabir.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'second',
    })

    const voids = foldVoids([dinner, first, second])
    const reversed = foldVoids([dinner, second, first])
    const chosen = voids.get(dinner.id)

    expect(chosen).toBe(reversed.get(dinner.id))
    expect([first, second]).toContain(chosen)
  })

  it('is empty for a book with no Voids', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })

    expect(foldVoids([dinner]).size).toBe(0)
  })
})

describe('foldBalances with Voids', () => {
  it('drops the voided Expense and leaves the rest of the book alone', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const chai = await makeExpenseEntry(mira, {
      amountPaise: 3000,
      participantDeviceIds: [rohan.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'duplicate',
    })

    expect(foldBalances([dinner, chai, voidEntry])).toEqual([
      { debtorDeviceId: rohan.deviceId, creditorDeviceId: mira.deviceId, amountPaise: 3000 },
    ])
  })

  it('yields the same Balances whatever order the Void arrives in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
    })

    expect(foldBalances([dinner, voidEntry])).toEqual(foldBalances([voidEntry, dinner]))
    expect(foldBalances([dinner, voidEntry])).toEqual([])
  })

  it('keeps a Balance a Void of a Member Entry cannot touch', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const member = await makeMemberEntry(rohan, 'Rohan')
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: member.id,
    })

    expect(foldBalances([member, dinner, voidEntry])).toEqual([
      { debtorDeviceId: mira.deviceId, creditorDeviceId: rohan.deviceId, amountPaise: 90_000 },
    ])
  })

  it('rides the roster-bound admission path like any Entry', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const roster = [await makeMemberEntry(rohan, 'Rohan'), await makeMemberEntry(mira, 'Mira')]
    const dinner = await makeExpenseEntry(rohan, {
      amountPaise: 90_000,
      participantDeviceIds: [mira.deviceId],
    })
    const voidEntry = await createVoidEntry({
      deviceId: mira.deviceId,
      signerPublicKey: mira.signerPublicKey,
      privateKey: mira.keyPair.privateKey,
      targetEntryId: dinner.id,
      reason: 'duplicate',
    })

    const admitted = admitEntries([...roster, dinner, voidEntry])

    expect(admitted).toContain(voidEntry)
    expect(foldBalances(admitted)).toEqual([])
  })
})
