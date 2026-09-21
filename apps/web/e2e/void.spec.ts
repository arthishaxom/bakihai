import { type BrowserContextOptions, expect, type Locator, type Page, test } from '@playwright/test'
import { balanceTexts, createGroup, joinGroup, memberNames } from './helpers'

// Every test runs at a phone viewport: the detail sheet is a mobile surface.
const PHONE_HEIGHT = 844
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: PHONE_HEIGHT },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

/** Adds an Expense from the form and waits for its line to appear. */
async function addExpense(page: Page, amount: string): Promise<void> {
  const entries = page.getByTestId('entry-list').locator('li')
  const before = await entries.count()

  await page.getByLabel('Amount (₹)').fill(amount)
  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(entries).toHaveCount(before + 1)
}

/** The ledger row of a given Entry type. */
function entryRow(page: Page, type: string): Locator {
  return page.getByTestId('entry-list').locator(`li[data-entry-type="${type}"]`)
}

/** Opens a row's detail bottom sheet. */
async function openEntrySheet(page: Page, row: Locator): Promise<Locator> {
  await row.getByRole('button').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()

  return sheet
}

test('an Expense is Voided from its bottom sheet and the Balance clears on both devices', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  // The row opens a bottom sheet: anchored to the bottom of the phone
  // viewport, with every action a thumb-sized target.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'expense'))

  await expect(sheet).toContainText('Rohan paid ₹900')
  await expect(sheet.getByRole('button', { name: 'Void entry' })).toBeVisible()

  const panel = sheet.getByTestId('entry-sheet-panel')
  const panelBox = await panel.boundingBox()

  expect(panelBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThanOrEqual(PHONE_HEIGHT - 2)
  expect(panelBox?.y ?? 0).toBeGreaterThan(PHONE_HEIGHT / 2)

  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox()

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  await sheet.getByLabel('Reason (optional)').fill('wrong amount')
  await sheet.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // Both lines stay in the book: the Void line, and the Expense struck
  // through and annotated with who Voided it and why.
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(2)
  await expect(rohan.locator('li[data-entry-type="void"]')).toContainText('Rohan voided')

  const struck = rohan.locator('li[data-voided="true"]')

  await expect(struck).toHaveCount(1)
  await expect(struck).toContainText('Voided by Rohan — wrong amount')
  await expect(struck.locator('span').first()).toHaveCSS('text-decoration-line', 'line-through')

  // The Balance it moved is gone on both phones.
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect(rohan.getByTestId('no-balances')).toBeVisible()
  await expect(mira.getByTestId('no-balances')).toBeVisible()

  // Mira sees the same struck-through line and the voider's name and reason.
  await expect(mira.locator('li[data-voided="true"]')).toContainText(
    'Voided by Rohan — wrong amount',
  )
  await expect(mira.locator('li[data-entry-type="void"]')).toContainText('Rohan voided')

  await rohanContext.close()
  await miraContext.close()
})

test('a Void, a voided Entry, and a Member Entry offer no Void action', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(rohan, '900')

  // Void the Expense first, so its sheet has something to withhold.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'expense'))

  await sheet.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The Void's own line opens a sheet that names what it Voided and offers
  // no Void action of its own.
  const voidSheet = await openEntrySheet(rohan, entryRow(rohan, 'void'))

  await expect(voidSheet).toContainText('Rohan voided “Rohan paid ₹900')
  await expect(voidSheet.getByRole('button', { name: 'Void entry' })).toHaveCount(0)
  await expect(voidSheet.getByTestId('void-form')).toHaveCount(0)

  // Escape is the keyboard path out of a modal dialog.
  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The already-Voided Expense offers no second Void either.
  const voidedSheet = await openEntrySheet(rohan, rohan.locator('li[data-voided="true"]'))

  await expect(voidedSheet).toContainText('Voided by Rohan')
  await expect(voidedSheet.getByRole('button', { name: 'Void entry' })).toHaveCount(0)

  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // Member Entries are not ledger rows at all, so no sheet can offer to Void one.
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(2)
  await expect(rohan.locator('li[data-entry-type="member"]')).toHaveCount(0)
  await expect(rohan.getByTestId('member-list')).toContainText('Rohan')

  await rohanContext.close()
  await miraContext.close()
})

test('a Void recorded offline converges and stops counting on both devices', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  // Both phones lose the network; Rohan corrects the Expense while offline.
  await rohanContext.setOffline(true)
  await miraContext.setOffline(true)

  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'expense'))

  await sheet.getByLabel('Reason (optional)').fill('offline correction')
  await sheet.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The correction holds on the phone that made it; Mira's copy has not heard.
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])
  await expect(mira.locator('li[data-voided="true"]')).toHaveCount(0)

  // Back online: the Void reaches Mira and the target stops counting there too.
  await rohanContext.setOffline(false)
  await miraContext.setOffline(false)

  await expect.poll(() => balanceTexts(mira), { timeout: 15_000 }).toEqual([])
  await expect(mira.locator('li[data-voided="true"]')).toContainText(
    'Voided by Rohan — offline correction',
  )
  await expect(mira.locator('li[data-entry-type="void"]')).toContainText('Rohan voided')

  await rohanContext.close()
  await miraContext.close()
})
