import { describe, expect, it } from 'vitest'
import {
  ENTRY_SCHEMA_VERSION,
  type EntryEnvelope,
  signEntryEnvelope,
  verifyEntryEnvelope,
} from '../src/entry-envelope'
import { admitEntries } from '../src/group/admission'
import { createMemberEntry, foldMembers } from '../src/group/members'
import {
  createPaymentAddressEntry,
  foldPaymentAddresses,
  PAYMENT_ADDRESS_ENTRY_TYPE,
  type PaymentAddress,
  paymentAddressEntryPayloadSchema,
  readPaymentAddressPayload,
} from '../src/group/payment-addresses'
import { createVoidEntry } from '../src/group/voids'
import { uuidv7 } from '../src/uuidv7'
import { makeDevice, type TestDevice } from './helpers/entries'

const OCCURRED_AT = '2026-09-22T10:00:00.000Z'

let addressClock = 0

/**
 * Writes a Payment address Entry with a rising id, so a test's "latest" is
 * decided by Entry id rather than by the wall clock, which two calls inside one
 * millisecond would leave to chance.
 */
function addressEntry(
  device: TestDevice,
  upiId: string,
  payeeName: string,
  occurredAt = OCCURRED_AT,
): Promise<EntryEnvelope> {
  addressClock += 1

  return signEntryEnvelope(
    {
      id: uuidv7(addressClock),
      schemaVersion: ENTRY_SCHEMA_VERSION,
      authorDeviceId: device.deviceId,
      signerPublicKey: device.signerPublicKey,
      occurredAt,
      type: PAYMENT_ADDRESS_ENTRY_TYPE,
      payload: paymentAddressEntryPayloadSchema.parse({ upiId, payeeName }),
    },
    device.keyPair.privateKey,
  )
}

/** Voids an Entry as `device`. */
function voidEntry(device: TestDevice, targetEntryId: string): Promise<EntryEnvelope> {
  return createVoidEntry({
    deviceId: device.deviceId,
    signerPublicKey: device.signerPublicKey,
    privateKey: device.keyPair.privateKey,
    targetEntryId,
  })
}

describe('createPaymentAddressEntry', () => {
  it('writes a signed Payment address carrying the UPI ID and payee name', async () => {
    const rohan = await makeDevice()

    const address = await createPaymentAddressEntry({
      deviceId: rohan.deviceId,
      signerPublicKey: rohan.signerPublicKey,
      privateKey: rohan.keyPair.privateKey,
      upiId: 'rohan@okhdfcbank',
      payeeName: 'Rohan Pothal',
    })

    expect(address.type).toBe(PAYMENT_ADDRESS_ENTRY_TYPE)
    expect(address.authorDeviceId).toBe(rohan.deviceId)
    await expect(verifyEntryEnvelope(address)).resolves.toEqual(address)
    expect(address.payload).toEqual({ upiId: 'rohan@okhdfcbank', payeeName: 'Rohan Pothal' })
    expect(readPaymentAddressPayload(address)).toEqual({
      upiId: 'rohan@okhdfcbank',
      payeeName: 'Rohan Pothal',
    })
  })

  it('trims the typed values and refuses anything that is not a UPI ID', async () => {
    const rohan = await makeDevice()
    const write = (upiId: string, payeeName: string) =>
      createPaymentAddressEntry({
        deviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        privateKey: rohan.keyPair.privateKey,
        upiId,
        payeeName,
      })

    expect((await write('  rohan@ybl  ', '  Rohan  ')).payload).toEqual({
      upiId: 'rohan@ybl',
      payeeName: 'Rohan',
    })

    await expect(write('rohan', 'Rohan')).rejects.toThrow()
    await expect(write('rohan@', 'Rohan')).rejects.toThrow()
    await expect(write('@ybl', 'Rohan')).rejects.toThrow()
    await expect(write('rohan@y@bl', 'Rohan')).rejects.toThrow()
    await expect(write('rohan@ybl', '   ')).rejects.toThrow()
    await expect(write('rohan@ybl', 'R'.repeat(61))).rejects.toThrow()
  })

  it('reads no payload from another Entry type or an unreadable one', async () => {
    const rohan = await makeDevice()
    const stranger = await makeDevice()
    const address = await addressEntry(rohan, 'rohan@ybl', 'Rohan')
    const forged = await signEntryEnvelope(
      {
        id: uuidv7(),
        schemaVersion: ENTRY_SCHEMA_VERSION,
        authorDeviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        occurredAt: OCCURRED_AT,
        type: PAYMENT_ADDRESS_ENTRY_TYPE,
        payload: { upiId: 7, payeeName: 'Rohan' },
      },
      rohan.keyPair.privateKey,
    )

    expect(readPaymentAddressPayload(address)?.upiId).toBe('rohan@ybl')
    expect(readPaymentAddressPayload(forged)).toBeUndefined()
    expect(readPaymentAddressPayload({ ...address, type: 'mystery' })).toBeUndefined()
    expect(readPaymentAddressPayload(await addressEntry(stranger, 'x@y', 'X'))).toBeDefined()
  })
})

describe('foldPaymentAddresses', () => {
  it('folds one address per Member, the latest Entry by id winning so an edit replaces the old one', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const first = await addressEntry(rohan, 'rohan@old', 'Rohan')
    const edited = await addressEntry(rohan, 'rohan@new', 'Rohan Pothal')
    const miraAddress = await addressEntry(mira, 'mira@ybl', 'Mira Nair')

    expect(foldPaymentAddresses([first, edited, miraAddress])).toEqual(
      new Map<string, PaymentAddress>([
        [
          rohan.deviceId,
          { deviceId: rohan.deviceId, upiId: 'rohan@new', payeeName: 'Rohan Pothal' },
        ],
        [mira.deviceId, { deviceId: mira.deviceId, upiId: 'mira@ybl', payeeName: 'Mira Nair' }],
      ]),
    )
  })

  it('attributes every address to its author, so a payload naming another Member is ignored', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const honest = await addressEntry(rohan, 'rohan@ybl', 'Rohan')
    // A modified client signs a payload that names Mira as the address's owner.
    const forged = await signEntryEnvelope(
      {
        id: uuidv7(),
        schemaVersion: ENTRY_SCHEMA_VERSION,
        authorDeviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        occurredAt: OCCURRED_AT,
        type: PAYMENT_ADDRESS_ENTRY_TYPE,
        payload: { upiId: 'rohan@evil', payeeName: 'Rohan', deviceId: mira.deviceId },
      },
      rohan.keyPair.privateKey,
    )
    const folded = foldPaymentAddresses([honest, forged])

    expect(folded.get(rohan.deviceId)?.upiId).toBe('rohan@ybl')
    expect(folded.has(mira.deviceId)).toBe(false)
  })

  it('drops a Voided address, standing aside for the address it replaced', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const first = await addressEntry(rohan, 'rohan@old', 'Rohan')
    const second = await addressEntry(rohan, 'rohan@new', 'Rohan Pothal')
    const voidSecond = await voidEntry(mira, second.id)

    expect(foldPaymentAddresses([first, second, voidSecond]).get(rohan.deviceId)).toEqual({
      deviceId: rohan.deviceId,
      upiId: 'rohan@old',
      payeeName: 'Rohan',
    })

    const voidFirst = await voidEntry(mira, first.id)

    expect(foldPaymentAddresses([first, second, voidFirst, voidSecond]).has(rohan.deviceId)).toBe(
      false,
    )
  })

  it('is the same whatever order the Entries arrive in', async () => {
    const rohan = await makeDevice()
    const mira = await makeDevice()
    const entries = [
      await addressEntry(rohan, 'rohan@old', 'Rohan'),
      await addressEntry(mira, 'mira@ybl', 'Mira'),
      await addressEntry(rohan, 'rohan@new', 'Rohan Pothal'),
    ]
    const expected = foldPaymentAddresses(entries)

    const toSorted = (folded: Map<string, PaymentAddress>) =>
      [...folded.values()].sort((left, right) => left.deviceId.localeCompare(right.deviceId))

    expect(toSorted(foldPaymentAddresses([...entries].reverse()))).toEqual(toSorted(expected))
    expect(
      toSorted(foldPaymentAddresses([entries[2], entries[0], entries[1]] as EntryEnvelope[])),
    ).toEqual(toSorted(expected))
  })

  it('ignores addresses from a device the roster does not bind', async () => {
    const rohan = await makeDevice()
    const stranger = await makeDevice()
    const entries = [
      await createMemberEntry({
        deviceId: rohan.deviceId,
        signerPublicKey: rohan.signerPublicKey,
        privateKey: rohan.keyPair.privateKey,
        displayName: 'Rohan',
      }),
      await addressEntry(rohan, 'rohan@ybl', 'Rohan'),
      await addressEntry(stranger, 'stranger@ybl', 'Stranger'),
    ]
    const admitted = admitEntries(entries)
    const folded = foldPaymentAddresses(admitted)

    expect(folded.size).toBe(1)
    expect(folded.get(rohan.deviceId)?.upiId).toBe('rohan@ybl')
    expect(foldMembers(admitted).map((member) => member.displayName)).toEqual(['Rohan'])
  })
})
