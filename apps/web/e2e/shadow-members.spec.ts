import { type BrowserContextOptions, expect, type Page, test } from '@playwright/test'
import {
  archivedMemberNames,
  archivedMemberRow,
  balanceTexts,
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  memberRow,
  openAddSheet,
  openLoanForm,
  openSettleUp,
} from './helpers'

// Every test runs at a phone viewport: the Member list and the Add sheet are mobile surfaces.
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

/** Adds a person without the app from the Members list and waits for their row. */
async function addShadowMember(page: Page, name: string): Promise<void> {
  await page.getByTestId('add-shadow-member').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Name').fill(name)
  await sheet.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => memberNames(page)).toContain(name)
}

/** Adds an Expense from the Add sheet: the viewer pays and everyone shares. */
async function addExpense(page: Page, amount: string): Promise<void> {
  const entries = page.getByTestId('entry-list').locator('li')
  const before = await entries.count()
  const sheet = await openAddSheet(page)

  await sheet.getByLabel('Amount (₹)').fill(amount)
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(entries).toHaveCount(before + 1)
}

test('a person without the app is tracked end to end', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')

  // Their row says what they are and who holds their key.
  await expect(memberRow(rohan, 'Rohit')).toContainText('No phone · Added by you')

  // Every picker offers them: payer and participants here, counterparty below.
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText(['Rohan (you)', 'Rohit'])
  await expect(sheet.getByRole('checkbox', { name: 'Rohit' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // A dinner Rohan paid for leaves Rohit owing him half, on the Balances screen.
  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Rohit owes You ₹450'])

  // An item Loan names them too, and shows what is still out.
  const loanSheet = await openLoanForm(rohan)

  await loanSheet.getByLabel('Member').selectOption({ label: 'Rohit' })
  await loanSheet.getByLabel('Item').fill('rice')
  await loanSheet.getByLabel('Quantity').fill('1.5')
  await loanSheet.getByLabel('Unit (optional)').fill('kg')
  await loanSheet.getByRole('button', { name: 'Add loan' }).click()
  await expect(entryRow(rohan, 'loan')).toContainText('Rohan lent 1.5 kg rice to Rohit')

  // Settle up prefills what Rohit owes and records the payment both ways.
  const settleSheet = await openSettleUp(rohan)

  await expect(settleSheet.getByTestId('settle-up-net')).toContainText('Rohit owes You ₹450')
  await settleSheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect(rohan.getByTestId('entry-list')).toContainText('Rohit paid Rohan ₹450')

  await rohanContext.close()
})

test('archiving a person without the app keeps their Balance settleable', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')
  await addExpense(rohan, '100')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Rohit owes You ₹50'])

  await memberRow(rohan, 'Rohit').getByTestId('archive-member').click()
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan'])
  await expect.poll(() => archivedMemberNames(rohan)).toEqual(['Rohit'])

  // Pickers leave them out...
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText(['Rohan (you)'])
  await sheet.getByRole('button', { name: 'Close' }).click()

  // ...while the Balance stays, marked Archived, and still settles.
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Rohit owes You ₹50 · Archived'])

  const settleSheet = await openSettleUp(rohan)

  await expect(settleSheet.getByTestId('settle-up-net')).toContainText('Rohit owes You ₹50')
  await settleSheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect.poll(() => balanceTexts(rohan)).toEqual([])

  // Unarchiving brings them back to every picker.
  await archivedMemberRow(rohan, 'Rohit').getByTestId('unarchive-member').click()
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Rohit'])

  const back = await openAddSheet(rohan)

  await expect(back.getByLabel('Paid by').locator('option')).toHaveText(['Rohan (you)', 'Rohit'])
  await back.getByRole('button', { name: 'Close' }).click()

  await rohanContext.close()
})

test('adding a name the Group already uses warns softly and still adds', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')

  await rohan.getByTestId('add-shadow-member').click()

  const sheet = rohan.getByRole('dialog')

  await expect(sheet.getByTestId('duplicate-name-warning')).toHaveCount(0)
  await sheet.getByLabel('Name').fill('rohit')
  await expect(sheet.getByTestId('duplicate-name-warning')).toContainText('already in this Group')
  await sheet.getByRole('button', { name: 'Add person' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)
  await expect
    .poll(async () => (await memberNames(rohan)).sort())
    .toEqual(['Rohan', 'Rohit', 'rohit'])

  await rohanContext.close()
})

test('a person added on one phone reads on the other and takes Entries from both', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect
    .poll(async () => (await memberNames(mira)).sort())
    .toEqual(['Mira', 'Rohan', 'Rohit'])

  // Each phone names the holder: Rohan on his, Rohan's name on Mira's.
  await expect(memberRow(rohan, 'Rohit')).toContainText('No phone · Added by you')
  await expect(memberRow(mira, 'Rohit')).toContainText('No phone · Added by Rohan')

  // Mira records a dinner she paid for Rohit alone; the Balance converges.
  const sheet = await openAddSheet(mira)

  await sheet.getByLabel('Amount (₹)').fill('200')
  await sheet.getByRole('checkbox', { name: 'Rohan' }).uncheck()
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => balanceTexts(mira)).toEqual(['Rohit owes You ₹100'])
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Rohit owes Mira ₹100'])

  await rohanContext.close()
  await miraContext.close()
})
