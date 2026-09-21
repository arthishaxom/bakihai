import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import {
  balanceTexts,
  createGroup,
  type InvitePayload,
  invitePayload,
  joinGroup,
  memberNames,
  openAddSheet,
} from './helpers'

const HARNESS_PATH = '/e2e/harness/harness.html'

interface StoredIdentity {
  deviceId: string
  signerPublicKey: string
  privateKeyPkcs8?: string
}

/** The identity record this device stored in local storage, exactly as stored. */
function storedIdentity(page: Page): Promise<StoredIdentity> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('bakihai/identity') ?? 'null') as StoredIdentity,
  )
}

async function openHarness(context: BrowserContext, invite: InvitePayload): Promise<Page> {
  const page = await context.newPage()
  const query = new URLSearchParams({ room: invite.room, key: invite.key, relay: invite.relay })

  await page.goto(`${HARNESS_PATH}?${query.toString()}`)
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected')

  return page
}

async function deviceKeyInIndexedDb(page: Page, deviceId: string): Promise<boolean> {
  return page.evaluate(
    (id) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('bakihai/identity', 1)

        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          const request = database
            .transaction('device-keys', 'readonly')
            .objectStore('device-keys')
            .get(id)

          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            resolve(request.result instanceof CryptoKey)
            database.close()
          }
        }
      }),
    deviceId,
  )
}

test('a modified client cannot slip a forged, tampered, or malformed Entry into another phone', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  const sheet = await openAddSheet(rohan)

  await sheet.getByLabel('Amount (₹)').fill('900')
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  const rohanIdentity = await storedIdentity(rohan)
  const miraIdentity = await storedIdentity(mira)
  const harness = await openHarness(rohanContext, invitePayload(invite))

  // The dinner reaches the harness before anything is tampered with.
  await expect
    .poll(() =>
      harness.evaluate(() =>
        (window.harness.entryValues() as { payload?: { amountPaise?: number } }[]).some(
          (value) => value.payload?.amountPaise === 90_000,
        ),
      ),
    )
    .toBe(true)

  // A forged Entry claims Rohan's device id but is signed by a fresh key: the
  // signature itself is real, so only the roster binding can reject it.
  const forgedId = await harness.evaluate(
    ({ authorDeviceId, participantDeviceId }) =>
      window.harness.addForgedEntry({
        authorDeviceId,
        type: 'expense',
        payload: {
          amountPaise: 999_900,
          payerDeviceId: authorDeviceId,
          participantDeviceIds: [participantDeviceId],
        },
      }),
    { authorDeviceId: rohanIdentity.deviceId, participantDeviceId: miraIdentity.deviceId },
  )

  // A tampered copy of the dinner keeps its stale signature under a fresh id.
  const tamperedId = await harness.evaluate(() => {
    const values = window.harness.entryValues() as {
      id: string
      type: string
      payload?: { amountPaise?: number }
    }[]
    const dinner = values.find(
      (value) => value.type === 'expense' && value.payload?.amountPaise === 90_000,
    )

    if (!dinner) {
      throw new Error('the dinner Entry is not in the book')
    }

    const id = window.harness.newId()

    window.harness.injectRaw(id, { ...dinner, id, payload: { ...dinner.payload, amountPaise: 1 } })

    return id
  })

  // Malformed values, and the dinner copied under a key that is not its id.
  await harness.evaluate(() => {
    const values = window.harness.entryValues() as {
      type: string
      payload?: { amountPaise?: number }
    }[]
    const dinner = values.find(
      (value) => value.type === 'expense' && value.payload?.amountPaise === 90_000,
    )

    window.harness.injectRaw('garbage-null', null)
    window.harness.injectRaw('garbage-shape', { nope: true })
    window.harness.injectRaw('garbage-string', 'not an Entry')
    window.harness.injectRaw('garbage-copy', dinner)
  })

  // The harness then joins as a Member. Its Member Entry is written after all
  // the garbage, so seeing it on Mira's screen proves the garbage arrived and
  // was processed without breaking anything.
  await harness.evaluate(() => window.harness.joinAs('Seed'))
  await expect.poll(() => memberNames(mira)).toEqual(['Rohan', 'Mira', 'Seed'])

  await expect(mira.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(mira.locator(`[data-entry-id="${forgedId}"]`)).toHaveCount(0)
  await expect(mira.locator(`[data-entry-id="${tamperedId}"]`)).toHaveCount(0)
  await expect(mira.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  // Rohan's own phone sees the same clean book.
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira', 'Seed'])
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(rohan.locator(`[data-entry-id="${forgedId}"]`)).toHaveCount(0)
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹450'])

  // The honest phone keeps working: a new Expense still writes and folds.
  const miraSheet = await openAddSheet(mira)

  await miraSheet.getByLabel('Amount (₹)').fill('100')
  await miraSheet.getByRole('checkbox', { name: 'Seed' }).uncheck()
  await miraSheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(mira.getByTestId('entry-list').locator('li')).toHaveCount(2)
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹400'])

  await rohanContext.close()
  await miraContext.close()
})

test('a payload rewritten under a known id and signature never hits the verification cache', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // An honest ₹900 dinner first verifies and folds on Mira's phone, so her
  // page has checked exactly this id and signature once already.
  const sheet = await openAddSheet(rohan)

  await sheet.getByLabel('Amount (₹)').fill('900')
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  const harness = await openHarness(rohanContext, invitePayload(invite))

  // The harness waits for the dinner, then rewrites its payload as a modified
  // client would, keeping the id and the now-stale signature. A cache keyed by
  // id + signature would answer from memory and fold ₹4999.50.
  const rewrittenId = await harness.evaluate(async () => {
    const findDinner = () =>
      (
        window.harness.entryValues() as {
          id: string
          type: string
          payload?: { amountPaise?: number }
        }[]
      ).find((value) => value.type === 'expense' && value.payload?.amountPaise === 90_000)

    for (let attempt = 0; attempt < 100 && !findDinner(); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    const dinner = findDinner()

    if (!dinner) {
      throw new Error('the dinner Entry never reached the harness')
    }

    window.harness.injectRaw(dinner.id, {
      ...dinner,
      payload: { ...dinner.payload, amountPaise: 499_950 },
    })

    return dinner.id
  })

  // Joining after the rewrite gives the states an order: when Mira's screen
  // shows the Seed Member, the rewritten value has been delivered and read.
  await harness.evaluate(() => window.harness.joinAs('Seed'))
  await expect.poll(() => memberNames(mira)).toEqual(['Rohan', 'Mira', 'Seed'])

  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect(mira.getByTestId('no-balances')).toBeVisible()
  await expect(mira.locator(`[data-entry-id="${rewrittenId}"]`)).toHaveCount(0)
  await expect(mira.locator('body')).not.toContainText('₹4999.50')
  // The stale-cache bug would fold the rewritten payload as this Balance.
  await expect(mira.locator('body')).not.toContainText('₹2499.75')
  await expect(mira.getByRole('alert')).toHaveCount(0)

  // The honest phone keeps working: a new Expense still writes.
  const miraSheet = await openAddSheet(mira)

  await miraSheet.getByLabel('Amount (₹)').fill('100')
  await miraSheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(mira.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(mira.locator('body')).not.toContainText('₹4999.50')

  await rohanContext.close()
  await miraContext.close()
})

test('the device signing key lives in IndexedDB, not in local storage', async ({ browser }) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  const identity = await storedIdentity(rohan)

  expect(identity.privateKeyPkcs8).toBeUndefined()
  expect(await deviceKeyInIndexedDb(rohan, identity.deviceId)).toBe(true)

  // A reload restores the key from IndexedDB: signing still works.
  await rohan.reload()
  await expect(rohan.getByTestId('member-list')).toContainText('Rohan')

  const sheet = await openAddSheet(rohan)

  await sheet.getByLabel('Amount (₹)').fill('100')
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)

  const miraIdentity = await storedIdentity(mira)

  expect(miraIdentity.privateKeyPkcs8).toBeUndefined()
  expect(await deviceKeyInIndexedDb(mira, miraIdentity.deviceId)).toBe(true)

  await rohanContext.close()
  await miraContext.close()
})

test('a legacy PKCS8 key moves into IndexedDB on first use', async ({ page }) => {
  const invite = await createGroup(page, 'Flat 3B', 'Rohan')
  const group = invitePayload(invite)

  // Fabricate what an install made before the move stored: PKCS8 in local
  // storage and no IndexedDB record.
  const legacy = await page.evaluate(async (inviteGroup) => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const base64url = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '')
    const identity = {
      version: 1,
      groupId: inviteGroup.room,
      groupName: inviteGroup.name,
      relayUrl: inviteGroup.relay,
      groupKey: inviteGroup.key,
      deviceId: crypto.randomUUID(),
      displayName: 'Legacy',
      signerPublicKey: base64url(raw),
      privateKeyPkcs8: base64url(pkcs8),
    }

    localStorage.setItem('bakihai/identity', JSON.stringify(identity))

    return identity
  }, group)

  await page.reload()

  await expect.poll(() => memberNames(page)).toEqual(['Rohan', 'Legacy'])
  expect(await page.evaluate(() => localStorage.getItem('bakihai/identity') ?? '')).not.toContain(
    'privateKeyPkcs8',
  )
  expect(await deviceKeyInIndexedDb(page, legacy.deviceId)).toBe(true)

  // The migrated key signs as before.
  const sheet = await openAddSheet(page)

  await sheet.getByLabel('Amount (₹)').fill('100')
  await sheet.getByRole('checkbox', { name: 'Legacy' }).uncheck()
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByTestId('entry-list').locator('li')).toHaveCount(1)
})
