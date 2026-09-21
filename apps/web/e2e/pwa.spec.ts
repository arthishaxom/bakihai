import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import { createGroup, joinGroup, memberNames, openAddSheet } from './helpers'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Waits until a service worker is active and controlling this page. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          await navigator.serviceWorker.ready

          return navigator.serviceWorker.controller !== null
        }),
      { timeout: 15_000 },
    )
    .toBe(true)
}

/** Creates a Group on one device, joins it from a second, and writes one ₹900 dinner. */
async function bookWithADinner(browser: Browser): Promise<{
  rohanContext: BrowserContext
  rohan: Page
  miraContext: BrowserContext
}> {
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

  return { rohanContext, rohan, miraContext }
}

/** The Group, its Member, the dinner Entry, and the Balance it folds. */
async function expectBookVisible(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(page.getByTestId('member-list')).toContainText('Rohan')
  await expect(page.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('balance-list')).toContainText('Mira owes You ₹450')
}

test('the manifest, icons, and service worker meet the installability criteria', async ({
  page,
}) => {
  await page.goto('/')

  // An active service worker that controls the page is part of the criteria.
  await waitForServiceWorker(page)

  const controllerScript = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? '',
  )

  expect(controllerScript).toContain('/sw.js')

  const cdp = await page.context().newCDPSession(page)
  const { errors, data, url } = await cdp.send('Page.getAppManifest')

  // The browser itself parsed the shipped manifest without an error.
  expect(url).toContain('/manifest.webmanifest')
  expect(errors).toEqual([])

  const manifest = JSON.parse(data ?? '{}') as {
    name?: string
    short_name?: string
    display?: string
    start_url?: string
    scope?: string
    theme_color?: string
    prefer_related_applications?: boolean
    icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[]
  }

  expect(manifest.name).toBe('BakiHai')
  expect(manifest.short_name).toBe('BakiHai')
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
  expect(manifest.scope).toBe('/')
  expect(manifest.theme_color).toBe('#1b2130')
  expect(manifest.prefer_related_applications ?? false).toBe(false)

  // Every declared icon is a real PNG of exactly the declared size, and one
  // icon is maskable for Android.
  const icons = manifest.icons ?? []

  expect(icons.some((icon) => icon.sizes === '192x192')).toBe(true)
  expect(icons.some((icon) => icon.sizes === '512x512')).toBe(true)
  expect(icons.some((icon) => icon.purpose?.includes('maskable'))).toBe(true)

  for (const icon of icons) {
    const response = await page.request.get(new URL(icon.src ?? '', page.url()).toString())

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')

    const body = await response.body()

    expect(body.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE)
    expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`).toBe(icon.sizes)
  }
})

test('the installed app opens offline and shows the book', async ({ browser }) => {
  const { rohanContext, rohan, miraContext } = await bookWithADinner(browser)

  await waitForServiceWorker(rohan)

  // The metro: no network at all. The shell comes from the service worker's
  // precache and the book from IndexedDB (ADR-0001).
  await rohanContext.setOffline(true)
  await expect.poll(() => rohan.evaluate(() => navigator.onLine)).toBe(false)

  const response = await rohan.reload()

  expect(response?.fromServiceWorker()).toBe(true)
  await expectBookVisible(rohan)

  await rohanContext.setOffline(false)
  await rohanContext.close()
  await miraContext.close()
})

test('a deployed update replaces the shell and keeps the local book', async ({ browser }) => {
  const { rohanContext, rohan, miraContext } = await bookWithADinner(browser)

  await waitForServiceWorker(rohan)

  // A deploy serves a new service worker. Registering a second script URL at
  // the same scope is the browser lifecycle the deploy goes through: install,
  // activate, and claim this open page. The new worker owns the shell now; the
  // book must not have moved.
  await rohan.evaluate(() => {
    void navigator.serviceWorker.register('/sw.js?deploy=2', { scope: '/' })
  })

  await expect
    .poll(() => rohan.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? ''), {
      timeout: 15_000,
    })
    .toContain('deploy=2')

  await expectBookVisible(rohan)

  // The new shell serves a cold, offline start and reads the same book.
  await rohanContext.setOffline(true)
  const response = await rohan.reload()

  expect(response?.fromServiceWorker()).toBe(true)
  await expectBookVisible(rohan)

  await rohanContext.setOffline(false)
  await rohanContext.close()
  await miraContext.close()
})
