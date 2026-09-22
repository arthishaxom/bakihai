import { type BrowserContextOptions, expect, type Locator, type Page, test } from '@playwright/test'
import {
  balanceTexts,
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  openAddSheet,
  openEntrySheet,
  openLoanForm,
  openSettlementForm,
  openSettleUp,
  setShowHidden,
} from './helpers'

// Every test runs at a phone viewport: the sheets are mobile surfaces.
const PHONE_HEIGHT = 844
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: PHONE_HEIGHT },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

/** Adds an Expense from the Add sheet and waits for its line to appear. */
async function addExpense(page: Page, amount: string): Promise<void> {
  const expenses = entryRow(page, 'expense')
  const before = await expenses.count()
  const sheet = await openAddSheet(page)

  await sheet.getByLabel('Amount (₹)').fill(amount)
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(expenses).toHaveCount(before + 1)
}

/** Records a Loan from the Add sheet and waits for its line to appear. */
async function addLoan(
  page: Page,
  {
    member,
    item,
    quantity,
    unit,
  }: { member: string; item: string; quantity: string; unit?: string },
): Promise<void> {
  const entries = page.getByTestId('entry-list').locator('li')
  const before = await entries.count()
  const sheet = await openLoanForm(page)

  await sheet.getByLabel('Member').selectOption({ label: member })
  await sheet.getByLabel('Item').fill(item)
  await sheet.getByLabel('Quantity').fill(quantity)

  if (unit !== undefined) {
    await sheet.getByLabel('Unit (optional)').fill(unit)
  }

  await sheet.getByRole('button', { name: 'Add loan' }).click()
  await expect(entries).toHaveCount(before + 1)
}

/** The first tag option's value in the Settlement form: the newest open item. */
async function newestTagValue(scope: Page | Locator): Promise<string> {
  const value = await scope
    .getByTestId('settlement-tag')
    .locator('option')
    .nth(1)
    .getAttribute('value')

  expect(value).not.toBeNull()

  return value ?? ''
}

test('tagging a payment to an Expense moves its progress on both phones, and full coverage reads Settled', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Rohan paid ₹900 for dinner, split with Mira: her share is ₹450, and no
  // payment has been tagged to it yet.
  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])
  await expect(entryRow(rohan, 'expense')).not.toContainText('repaid')

  // Mira pays ₹200 and tags it to the dinner. The tag picker offers the open
  // Expense and says the payment counts toward its coverage.
  const sheet = await openSettlementForm(mira)

  await expect(sheet.getByLabel('Tag (optional)')).toBeVisible()
  await sheet.getByLabel('Member').selectOption({ label: 'Rohan' })
  await sheet.getByLabel('Amount (₹)').fill('200')

  // The picker only offers items the chosen pair can cover: Rohan paying Mira
  // is not a payment toward Mira's dinner share.
  await sheet.getByRole('radio', { name: 'They paid me' }).check()
  await expect(sheet.getByTestId('settlement-tag')).toHaveCount(0)
  await sheet.getByRole('radio', { name: 'I paid' }).check()
  await expect(sheet.getByTestId('settlement-tag')).toBeVisible()

  await sheet.getByTestId('settlement-tag').selectOption(await newestTagValue(sheet))
  await expect(sheet.getByTestId('settlement-tag-notice')).toContainText(
    'Tagged to Rohan paid ₹900 · split between Rohan, Mira',
  )
  await sheet.getByRole('button', { name: 'Add settlement' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // The partial payment shows as paid-of-total on both phones, and the
  // Balance drops by exactly what was paid.
  await expect(entryRow(mira, 'expense')).toContainText('₹200 of ₹450 repaid')
  await expect.poll(() => entryRow(rohan, 'expense').textContent()).toContain('₹200 of ₹450 repaid')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹250'])
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹250'])

  // The Expense's detail sheet names the per-participant progress and offers
  // the rest of that share, prefilled and tagged.
  const detail = await openEntrySheet(mira, entryRow(mira, 'expense'))

  await expect(detail.getByTestId('expense-participant')).toContainText('Mira repaid ₹200 of ₹450')
  await expect(detail.getByTestId('settle-share')).toHaveText('Settle ₹250')

  await detail.getByTestId('settle-share').click()
  await expect(detail.getByTestId('settlement-form')).toBeVisible()
  await expect(detail.getByTestId('settlement-tag-notice')).toContainText(
    'Tagged to Rohan paid ₹900',
  )
  await expect(detail.getByLabel('Amount (₹)')).toHaveValue('250')
  await expect(detail.getByTestId('settlement-summary')).toHaveText('You paid Rohan ₹250')

  await detail.getByRole('button', { name: 'Record settlement' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // Every share is covered, so the Expense reads Settled and the Balance is
  // clear on both phones.
  await expect(entryRow(mira, 'expense')).toContainText('Settled')
  await expect.poll(() => entryRow(rohan, 'expense').textContent()).toContain('Settled')
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect.poll(() => balanceTexts(rohan)).toEqual([])

  // A covered participant offers no further share to settle; the payer's own
  // sheet names the payment as tagged to the dinner it closed.
  const rohanDetail = await openEntrySheet(rohan, entryRow(rohan, 'expense'))

  await expect(rohanDetail.getByTestId('expense-participant')).toContainText('Mira Settled')
  await expect(rohanDetail.getByTestId('settle-share')).toHaveCount(0)
  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  const settlementSheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement').first())

  await expect(settlementSheet.getByTestId('settlement-tag')).toContainText(
    'Tagged to “Rohan paid ₹900',
  )
  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The dinner is fully covered, so it is no longer offered as a tag: the very
  // pair that paid it sees no option.
  const lateSheet = await openSettlementForm(rohan)

  await lateSheet.getByRole('radio', { name: 'They paid me' }).check()
  await lateSheet.getByLabel('Member').selectOption({ label: 'Mira' })
  await expect(lateSheet.getByTestId('settlement-tag')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('an untagged payment moves the Balance and never changes an item state', async ({
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

  // Mira settles up from her Balance row, leaving the tag on "None": the
  // Balance clears and the dinner is untouched.
  const sheet = await openSettleUp(mira)

  await expect(sheet.getByLabel('Tag (optional)')).toBeVisible()
  await expect(sheet.getByTestId('settlement-tag')).toHaveValue('')
  await expect(sheet.getByTestId('settlement-untagged-notice')).toBeVisible()
  await sheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect(entryRow(mira, 'expense')).not.toContainText('repaid')
  await expect(entryRow(mira, 'expense')).not.toContainText('Settled')
  await expect.poll(() => entryRow(rohan, 'expense').textContent()).not.toContain('repaid')

  // The detail sheet still reads her share as owing, and the Settlement shows
  // no tag of its own.
  const detail = await openEntrySheet(mira, entryRow(mira, 'expense'))

  await expect(detail.getByTestId('expense-participant')).toContainText('Mira owes ₹450')
  await expect(detail.getByTestId('settle-share')).toHaveText('Settle ₹450')
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  const settlementSheet = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await expect(settlementSheet.getByTestId('settlement-tag')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('Voiding a tagged Settlement reopens the Expense coverage on both phones', async ({
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

  // Mira records the full ₹450 tagged to the dinner: it reads Settled and the
  // Balance is clear on both phones.
  const sheet = await openSettlementForm(mira)

  await sheet.getByLabel('Member').selectOption({ label: 'Rohan' })
  await sheet.getByLabel('Amount (₹)').fill('450')
  await sheet.getByTestId('settlement-tag').selectOption(await newestTagValue(sheet))
  await sheet.getByRole('button', { name: 'Add settlement' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  await expect(entryRow(mira, 'expense')).toContainText('Settled')
  await expect.poll(() => balanceTexts(mira)).toEqual([])

  // Rohan disputes the claim and Voids it: the tagged coverage reopens, the
  // debt comes back, and both lines stay in the book.
  const settlementDetail = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))
  const panel = settlementDetail.getByTestId('entry-sheet-panel')

  await expect(panel.getByTestId('settlement-tag')).toContainText('Tagged to “Rohan paid ₹900')
  await panel.getByLabel('Reason (optional)').fill('never arrived')
  await panel.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹450'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])
  await expect(entryRow(rohan, 'expense')).not.toContainText('Settled')
  await expect.poll(() => entryRow(mira, 'expense').textContent()).not.toContain('Settled')

  // The Voided Settlement's own sheet still names the tag it carried.
  await setShowHidden(rohan, true)

  const voidedDetail = await openEntrySheet(rohan, rohan.locator('li[data-voided="true"]'))

  await expect(voidedDetail.getByTestId('settlement-tag')).toContainText(
    'Tagged to “Rohan paid ₹900',
  )
  await expect(voidedDetail.getByTestId('expense-coverage')).toHaveCount(0)
  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The Expense itself is live again: the detail sheet offers the share.
  const expenseDetail = await openEntrySheet(rohan, entryRow(rohan, 'expense'))

  await expect(expenseDetail.getByTestId('expense-participant')).toContainText('Mira owes ₹450')
  await expect(expenseDetail.getByTestId('settle-share')).toHaveText('Settle ₹450')

  await rohanContext.close()
  await miraContext.close()
})

test('Loan Settle with an amount writes the closing Return and a Settlement tagged to the Loan', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addLoan(rohan, { member: 'Mira', item: 'rice', quantity: '1.5', unit: 'kg' })
  await expect.poll(() => entryRow(mira, 'loan').textContent()).toContain('1.5 kg rice')

  // While the Loan is open, the Settlement form offers it as a tag to the pair
  // that owes it: the borrower paying the lender.
  const addSheet = await openSettlementForm(mira)

  await addSheet.getByLabel('Member').selectOption({ label: 'Rohan' })
  await expect(addSheet.getByTestId('settlement-tag').locator('option').nth(1)).toHaveText(
    /Rohan lent 1\.5 kg rice to Mira/,
  )
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // Rohan settles the remainder and records the ₹90 Mira paid for it: one
  // action writes the closing Return and the tagged Settlement.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await sheet.getByLabel('Amount (₹, optional)').fill('90')
  await expect(sheet.getByRole('radio', { name: 'Mira paid Rohan' })).toBeChecked()
  await sheet.getByRole('button', { name: 'Settle with ₹90' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await expect(entryRow(rohan, 'loan')).toContainText('Settled')
  await expect(entryRow(rohan, 'return')).toContainText('Rohan settled 1.5 kg of rice')
  await expect(entryRow(rohan, 'settlement')).toContainText('Mira paid Rohan ₹90')

  // The money is a real Settlement and counts in the pairwise Balance like any
  // other (ADR-0004). The Loan itself never entered that Balance, so with no
  // other debts the payer ends up the creditor — and both phones agree.
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹90'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['Rohan owes You ₹90'])
  await expect.poll(() => entryRow(mira, 'loan').textContent()).toContain('Settled')
  await expect(entryRow(mira, 'settlement')).toContainText('Mira paid Rohan ₹90')

  // Both phones read the Settlement as tagged to the Loan it closed.
  const settlementDetail = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await expect(settlementDetail.getByTestId('settlement-tag')).toContainText(
    'Tagged to “Rohan lent 1.5 kg rice to Mira',
  )
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // A settled Loan offers no further Settle.
  const loanDetail = await openEntrySheet(mira, entryRow(mira, 'loan'))

  await expect(loanDetail.getByTestId('settle-button')).toHaveCount(0)
  await expect(loanDetail.getByTestId('return-form')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})
