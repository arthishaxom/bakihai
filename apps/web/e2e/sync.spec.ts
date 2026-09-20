import { randomBytes, randomUUID, webcrypto } from 'node:crypto'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

interface Group {
  room: string
  key: string
}

const RELAY_URL = 'http://localhost:8790'
const HARNESS_PATH = '/e2e/harness/harness.html'
// Mirrored from packages/shared on purpose: the wire-format test re-derives
// the key and opens the frames itself, so it fails if those constants drift.
const HKDF_SALT = new TextEncoder().encode('bakihai/v1/group-key')
const HKDF_INFO = new TextEncoder().encode('book-update/v1')
const IV_BYTES = 12

function newGroup(): Group {
  return {
    room: `e2e-${randomUUID()}`,
    key: Buffer.from(randomBytes(32)).toString('base64url'),
  }
}

function harnessUrl(group: Group, options: { autoconnect?: boolean } = {}): string {
  const query = new URLSearchParams({ room: group.room, key: group.key, relay: RELAY_URL })

  if (options.autoconnect === false) {
    query.set('autoconnect', '0')
  }

  return `${HARNESS_PATH}?${query.toString()}`
}

async function openHarness(
  context: BrowserContext,
  group: Group,
  options: { autoconnect?: boolean } = {},
): Promise<Page> {
  const page = await context.newPage()

  await page.goto(harnessUrl(group, options))
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')

  return page
}

function entryLocator(page: Page, id: string) {
  return page.locator(`[data-entry-id="${id}"]`)
}

function statusLocator(page: Page) {
  return page.getByTestId('sync-status')
}

async function deriveSyncKey(groupKey: string): Promise<webcrypto.CryptoKey> {
  const material = await webcrypto.subtle.importKey(
    'raw',
    Buffer.from(groupKey, 'base64url'),
    'HKDF',
    false,
    ['deriveBits'],
  )
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    material,
    256,
  )

  return webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['decrypt'])
}

async function decryptSealed(sealed: Buffer, key: webcrypto.CryptoKey): Promise<Uint8Array> {
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES) },
    key,
    sealed.subarray(IV_BYTES),
  )

  return new Uint8Array(plaintext)
}

test('two devices in the same room see each other\u2019s Entry after reconnecting', async ({
  browser,
}) => {
  const group = newGroup()
  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openHarness(contextA, group)
  const pageB = await openHarness(contextB, group)

  await expect(statusLocator(pageA)).toHaveAttribute('data-status', 'connected')
  await expect(statusLocator(pageB)).toHaveAttribute('data-status', 'connected')

  // Both phones lose the network and A writes an Entry while offline.
  await contextA.setOffline(true)
  await contextB.setOffline(true)
  await pageA.evaluate(() => window.harness.disconnect())
  await pageB.evaluate(() => window.harness.disconnect())

  const offlineId = await pageA.evaluate(() =>
    window.harness.addEntry({ note: 'offline dinner', amountPaise: 90_000 }),
  )
  await expect(entryLocator(pageA, offlineId)).toBeVisible()
  await expect(entryLocator(pageB, offlineId)).toHaveCount(0)

  // Back online: the offline Entry reaches B, and live updates flow again.
  await contextA.setOffline(false)
  await contextB.setOffline(false)
  await pageB.evaluate(() => window.harness.reconnect())
  await pageA.evaluate(() => window.harness.reconnect())

  await expect(entryLocator(pageB, offlineId)).toBeVisible()

  const liveId = await pageB.evaluate(() =>
    window.harness.addEntry({ note: 'live chai', amountPaise: 3_000 }),
  )
  await expect(entryLocator(pageA, liveId)).toBeVisible()

  await contextA.close()
  await contextB.close()
})

test('a reload keeps the whole book from IndexedDB', async ({ browser }) => {
  const group = newGroup()
  const context = await browser.newContext()
  const page = await openHarness(context, group)
  const id = await page.evaluate(() =>
    window.harness.addEntry({ note: 'persisted dinner', amountPaise: 90_000 }),
  )
  await expect(entryLocator(page, id)).toBeVisible()

  // Reload with the network switched off: the book comes from IndexedDB.
  await page.goto(harnessUrl(group, { autoconnect: false }))
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')

  await expect(statusLocator(page)).toHaveAttribute('data-status', 'disconnected')
  await expect(entryLocator(page, id)).toBeVisible()

  await context.close()
})

test('a fresh device rebuilds the book from the relay', async ({ browser }) => {
  const group = newGroup()
  const contextA = await browser.newContext()
  const pageA = await openHarness(contextA, group)
  const id = await pageA.evaluate(() =>
    window.harness.addEntry({ note: 'relay dinner', amountPaise: 60_000 }),
  )

  // A second device with an empty IndexedDB sees the Entry through the relay.
  const contextB = await browser.newContext()
  const pageB = await openHarness(contextB, group)
  await expect(entryLocator(pageB, id)).toBeVisible()

  // The author leaves; a third fresh device still rebuilds the book from the
  // relay's stored log alone.
  await contextA.close()
  const contextC = await browser.newContext()
  const pageC = await openHarness(contextC, group)
  await expect(entryLocator(pageC, id)).toBeVisible()

  await contextB.close()
  await contextC.close()
})

test('the relay only ever carries sealed updates', async ({ browser }) => {
  const group = newGroup()
  const context = await browser.newContext()
  const page = await context.newPage()
  const frames: Buffer[] = []

  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      frames.push(
        Buffer.isBuffer(event.payload) ? event.payload : Buffer.from(event.payload, 'utf8'),
      )
    })
  })

  await page.goto(harnessUrl(group))
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true')
  await expect(statusLocator(page)).toHaveAttribute('data-status', 'connected')

  const note = 'sealed dinner'
  const id = await page.evaluate(
    ({ note }) => window.harness.addEntry({ note, amountPaise: 90_000 }),
    { note },
  )
  await expect(entryLocator(page, id)).toBeVisible()

  // One frame publishes the book on connect, the next carries the live Entry.
  await expect.poll(() => frames.length).toBeGreaterThanOrEqual(2)

  const groupKey = await deriveSyncKey(group.key)
  const strangerKey = await deriveSyncKey(Buffer.from(randomBytes(32)).toString('base64url'))

  for (const frame of frames) {
    const text = frame.toString('utf8')

    expect(text).not.toContain(note)
    expect(text).not.toContain('90000')

    const parsed = JSON.parse(text) as { t: string; d: string }

    expect(parsed.t).toBe('update')
    expect(parsed.d).toMatch(/^[A-Za-z0-9_-]+$/)

    const sealed = Buffer.from(parsed.d, 'base64url')

    expect(sealed.toString('utf8')).not.toContain(note)

    // The Group key opens it; anyone else, including the relay, cannot.
    await expect(decryptSealed(sealed, groupKey)).resolves.toBeInstanceOf(Uint8Array)
    await expect(decryptSealed(sealed, strangerKey)).rejects.toThrow()
  }

  expect(await page.getByTestId('sync-errors').textContent()).toBe('0')

  await context.close()
})
