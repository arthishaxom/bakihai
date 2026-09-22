import { type BrowserContextOptions, expect, type Locator, type Page, test } from '@playwright/test'
import {
  balanceTexts,
  createGroup,
  entryRow,
  entryTypes,
  filterEntries,
  joinGroup,
  memberNames,
  openAddSheet,
  openEntrySheet,
  openLoanForm,
  openSettlementForm,
  setShowHidden,
} from './helpers'

// Every test runs at a phone viewport: the Entries list and its chips are a mobile surface.
const PHONE_HEIGHT = 844
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: PHONE_HEIGHT },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

const DAY = 24 * 60 * 60 * 1000
const START = new Date('2026-01-01T10:00:00.000Z')
const FIFTEEN_DAYS_ON = new Date(START.getTime() + 15 * DAY)

/** Adds an Expense from the Add sheet and waits for its line to appear. */
async function addExpense(page: Page, amount: string): Promise<void> {
  const entries = page.getByTestId('entry-list').locator('li')
  const before = await entries.count()
  const sheet = await openAddSheet(page)

  await sheet.getByLabel('Amount (₹)').fill(amount)
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(entries).toHaveCount(before + 1)
}

/** The ledger rows whose text names this line. */
function rowFor(page: Page, text: string): Locator {
  return page.getByTestId('entry-list').locator('li').filter({ hasText: text })
}

/** Settles a participant's whole share of an Expense from its detail sheet, tagged. */
async function settleShare(page: Page, row: Locator): Promise<void> {
  const detail = await openEntrySheet(page, row)

  await detail.getByTestId('settle-share').click()
  await detail.getByRole('button', { name: 'Record settlement' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** The Entry types in the list, as a set, so same-millisecond ordering does not matter. */
async function entryTypeSet(page: Page): Promise<string[]> {
  return (await entryTypes(page)).sort()
}

test('filter chips narrow the Entries list by type and survive a reload', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // One of each kind of line: an Expense, a Loan, and an untagged Settlement.
  await addExpense(rohan, '900')

  const loanSheet = await openLoanForm(rohan)

  await loanSheet.getByLabel('Member').selectOption({ label: 'Mira' })
  await loanSheet.getByLabel('Item').fill('eggs')
  await loanSheet.getByLabel('Quantity').fill('3')
  await loanSheet.getByRole('button', { name: 'Add loan' }).click()
  await expect(entryRow(rohan, 'loan')).toHaveCount(1)

  const settlementSheet = await openSettlementForm(rohan)

  await settlementSheet.getByLabel('Member').selectOption({ label: 'Mira' })
  await settlementSheet.getByRole('radio', { name: 'They paid me' }).check()
  await settlementSheet.getByLabel('Amount (₹)').fill('50')
  await settlementSheet.getByRole('button', { name: 'Add settlement' }).click()
  await expect(entryRow(rohan, 'settlement')).toHaveCount(1)

  expect(await entryTypeSet(rohan)).toEqual(['expense', 'loan', 'settlement'])

  await filterEntries(rohan, 'expenses')
  expect(await entryTypes(rohan)).toEqual(['expense'])

  // The chip is a device preference: a reload comes back on the same cut.
  await rohan.reload()
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(
    rohan.getByTestId('ledger-filters').locator('button[data-filter="expenses"]'),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await entryTypes(rohan)).toEqual(['expense'])

  await filterEntries(rohan, 'loans')
  expect(await entryTypes(rohan)).toEqual(['loan'])

  await filterEntries(rohan, 'payments')
  expect(await entryTypes(rohan)).toEqual(['settlement'])

  await filterEntries(rohan, 'all')
  expect(await entryTypeSet(rohan)).toEqual(['expense', 'loan', 'settlement'])

  // The other phone never chose a chip, so it still reads the whole book.
  expect(await entryTypeSet(mira)).toEqual(['expense', 'loan', 'settlement'])

  await rohanContext.close()
  await miraContext.close()
})

test('a Settled Expense archives after 14 days while a fresh one and an open one stay', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  // Pin the device clocks so the deadline can be moved by a fortnight, not waited out.
  await rohan.goto('/')
  await rohan.clock.setFixedTime(START)

  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await mira.goto('/')
  await mira.clock.setFixedTime(START)
  await joinGroup(mira, invite, 'Mira')
  // The pinned clock makes both Member Entries share a joinedAt, so the roster
  // order falls to the device ids and the two names are a set, not a sequence.
  await expect.poll(async () => (await memberNames(rohan)).sort()).toEqual(['Mira', 'Rohan'])

  // At START: a ₹900 dinner Mira covers in full, and a ₹200 taxi left open.
  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])
  await settleShare(mira, rowFor(mira, 'Rohan paid ₹900'))
  await expect.poll(() => rowFor(rohan, 'Rohan paid ₹900').textContent()).toContain('Settled')

  await addExpense(rohan, '200')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹100'])
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(3)

  // A fortnight and a day later, the dinner and the Settlement that settled it
  // have Archived. The taxi is older still, but it is open, so it never hides.
  await rohan.clock.setFixedTime(FIFTEEN_DAYS_ON)
  await mira.clock.setFixedTime(FIFTEEN_DAYS_ON)
  await rohan.reload()
  await mira.reload()

  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(rowFor(rohan, 'Rohan paid ₹200')).toBeVisible()
  await expect(rowFor(rohan, 'Rohan paid ₹900')).toHaveCount(0)
  await expect(rowFor(rohan, 'Mira paid Rohan ₹450')).toHaveCount(0)

  // Balances fold the whole book, so hiding moved nothing.
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹100'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹100'])

  // A dinner settled today is fourteen days away from hiding: it stays, with the
  // Settlement that settled it, while the older pair is still gone.
  await addExpense(rohan, '300')
  await settleShare(mira, rowFor(mira, 'Rohan paid ₹300'))

  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(3)
  await expect(rowFor(rohan, 'Rohan paid ₹300')).toContainText('Settled')
  await expect(rowFor(rohan, 'Mira paid Rohan ₹150')).toBeVisible()
  await expect(rowFor(rohan, 'Rohan paid ₹900')).toHaveCount(0)

  // Show hidden brings the Archived pair back, and turning it off quiets them again.
  await setShowHidden(rohan, true)
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(5)
  await expect(rowFor(rohan, 'Rohan paid ₹900')).toContainText('Settled')
  await expect(rowFor(rohan, 'Mira paid Rohan ₹450')).toBeVisible()
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹100'])

  await setShowHidden(rohan, false)
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(3)
  await expect(rowFor(rohan, 'Rohan paid ₹900')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})
