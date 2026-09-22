import { type BrowserContextOptions, expect, type Page, test } from '@playwright/test'
import {
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  openAddSheet,
  openEntrySheet,
  openLoanForm,
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

test('a Loan created on one phone appears on the other, and Returns lower the remainder on both', async ({
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

  // The item, the direction, and what is still outstanding on both phones.
  await expect(entryRow(rohan, 'loan')).toContainText('Rohan lent 1.5 kg rice to Mira')
  await expect(entryRow(rohan, 'loan')).toContainText('1.5 kg left')
  await expect
    .poll(() => entryRow(mira, 'loan').textContent())
    .toContain('Rohan lent 1.5 kg rice to Mira')
  await expect(entryRow(mira, 'loan')).toContainText('1.5 kg left')

  // Mira gives half the rice back from the item's detail sheet.
  const sheet = await openEntrySheet(mira, entryRow(mira, 'loan'))

  await expect(sheet).toContainText('1.5 kg of rice is still out.')
  await expect(sheet.getByRole('button', { name: 'Record return' })).toBeVisible()

  await sheet.getByLabel('Quantity returned').fill('0.5')
  await sheet.getByRole('button', { name: 'Record return' }).click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // The remainder drops on both phones, and the Return line names what came back.
  await expect(entryRow(mira, 'return')).toContainText('Mira returned 0.5 kg of rice to Rohan')
  await expect(entryRow(mira, 'loan')).toContainText('1 kg left')
  await expect.poll(() => entryRow(rohan, 'loan').textContent()).toContain('1 kg left')
  await expect(entryRow(rohan, 'return')).toContainText('Mira returned 0.5 kg of rice to Rohan')

  // Rohan settles the remainder with one tap. No money is involved, so the
  // only Entry written is the closing Return.
  const settleSheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await settleSheet.getByTestId('settle-button').click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(3)
  await expect(entryRow(rohan, 'return')).toHaveCount(2)
  await expect(entryRow(rohan, 'loan')).toContainText('Settled')
  // The closing Return is under Rohan's name: the lender tapped Settle, so it
  // reads as settled rather than as Rohan returning something to himself.
  await expect(entryRow(rohan, 'return').first()).toContainText('Rohan settled 1 kg of rice')
  await expect.poll(() => entryRow(mira, 'loan').textContent()).toContain('Settled')
  await expect(entryRow(mira, 'return')).toHaveCount(2)
  await expect(entryRow(mira, 'return').first()).toContainText('Rohan settled 1 kg of rice')

  await rohanContext.close()
  await miraContext.close()
})

test('the Return form refuses more than what is left outstanding', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addLoan(rohan, { member: 'Mira', item: 'eggs', quantity: '3' })

  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await sheet.getByLabel('Quantity returned').fill('4')
  await sheet.getByRole('button', { name: 'Record return' }).click()

  // The form refuses it and nothing is written.
  await expect(sheet.getByRole('alert')).toContainText('Only 3 is left to return')
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  await expect(entryRow(rohan, 'return')).toHaveCount(0)

  // A quantity that is not a number is refused with its own explanation.
  await sheet.getByLabel('Quantity returned').fill('two')
  await sheet.getByRole('button', { name: 'Record return' }).click()
  await expect(sheet.getByRole('alert')).toContainText('Enter a quantity like 1 or 1.5')
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)

  await rohanContext.close()
  await miraContext.close()
})

test('two offline Returns that together exceed the quantity fold to zero with an over-returned marker', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addLoan(rohan, { member: 'Mira', item: 'eggs', quantity: '3' })
  await expect.poll(() => entryRow(mira, 'loan').textContent()).toContain('3 left')

  // Both phones lose the network and each returns two eggs, the amount each
  // one saw left while apart.
  await rohanContext.setOffline(true)
  await miraContext.setOffline(true)

  const rohanSheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await rohanSheet.getByLabel('Quantity returned').fill('2')
  await rohanSheet.getByRole('button', { name: 'Record return' }).click()

  const miraSheet = await openEntrySheet(mira, entryRow(mira, 'loan'))

  await miraSheet.getByLabel('Quantity returned').fill('2')
  await miraSheet.getByRole('button', { name: 'Record return' }).click()

  // Each phone's own copy is believable on its own: one egg left.
  await expect(entryRow(rohan, 'loan')).toContainText('1 left')
  await expect(entryRow(mira, 'loan')).toContainText('1 left')

  // Back online, the two Returns together pass zero: both phones fold the
  // remainder to zero and mark how far over it went, identically.
  await rohanContext.setOffline(false)
  await miraContext.setOffline(false)

  await expect
    .poll(() => entryRow(rohan, 'loan').textContent(), { timeout: 15_000 })
    .toContain('over-returned by 1')
  await expect(entryRow(mira, 'loan')).toContainText('over-returned by 1')
  await expect(entryRow(rohan, 'return')).toHaveCount(2)
  await expect(entryRow(mira, 'return')).toHaveCount(2)

  // A closed item offers neither Return nor Settle.
  const closedSheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await expect(closedSheet).toContainText('over-returned')
  await expect(closedSheet.getByTestId('return-form')).toHaveCount(0)
  await expect(closedSheet.getByTestId('settle-button')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('either Member may record either direction', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Mira records that she borrowed Rohan's drill: the same Loan the lender
  // would have recorded, written from the borrower's side.
  const sheet = await openLoanForm(mira)

  await sheet.getByRole('radio', { name: 'Borrowed from' }).check()
  await sheet.getByLabel('Member').selectOption({ label: 'Rohan' })
  await sheet.getByLabel('Item').fill('drill')
  await sheet.getByLabel('Quantity').fill('1')
  await sheet.getByRole('button', { name: 'Add loan' }).click()

  await expect(entryRow(mira, 'loan')).toContainText('Rohan lent 1 drill to Mira')
  await expect
    .poll(() => entryRow(rohan, 'loan').textContent())
    .toContain('Rohan lent 1 drill to Mira')

  await rohanContext.close()
  await miraContext.close()
})

test('voiding a Loan keeps both lines and names the item on both phones', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addLoan(rohan, { member: 'Mira', item: 'eggs', quantity: '3' })
  await expect
    .poll(() => entryRow(mira, 'loan').textContent())
    .toContain('Rohan lent 3 eggs to Mira')

  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'loan'))

  await sheet.getByLabel('Reason (optional)').fill('never happened')
  await sheet.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await setShowHidden(rohan, true)

  // The Loan line stays, struck through, and both the line and the Void name
  // the item rather than the Entry type.
  const struck = rohan.locator('li[data-voided="true"]')

  await expect(struck).toContainText('Rohan lent 3 eggs to Mira')
  await expect(struck).toContainText('Voided by Rohan — never happened')
  await expect(entryRow(rohan, 'void')).toContainText('Rohan voided “Rohan lent 3 eggs to Mira”')

  // The Voided item offers neither Return nor Settle.
  const voidedSheet = await openEntrySheet(rohan, struck)

  await expect(voidedSheet).toContainText('Rohan lent 3 eggs to Mira')
  await expect(voidedSheet.getByTestId('return-form')).toHaveCount(0)
  await expect(voidedSheet.getByTestId('settle-button')).toHaveCount(0)
  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // Mira reads the same two lines once she asks for them.
  await setShowHidden(mira, true)
  await expect(mira.locator('li[data-voided="true"]')).toContainText('Rohan lent 3 eggs to Mira')
  await expect(mira.locator('li[data-entry-type="void"]')).toContainText(
    'Rohan voided “Rohan lent 3 eggs to Mira”',
  )

  await rohanContext.close()
  await miraContext.close()
})

test('Add is a bottom sheet with a mode switch and thumb-sized targets', async ({ page }) => {
  await createGroup(page, 'Flat 3B', 'Rohan')

  const sheet = await openAddSheet(page)

  await expect(sheet.getByRole('heading', { name: 'Add to the book' })).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Expense', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet.getByLabel('Amount (₹)')).toBeVisible()

  // The sheet is anchored to the bottom of the phone viewport, and every
  // action in it is a thumb-sized target.
  const panel = sheet.getByTestId('add-sheet-panel')
  const panelBox = await panel.boundingBox()

  expect(panelBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThanOrEqual(PHONE_HEIGHT - 2)
  // Anchored to the bottom, not filling the screen.
  expect(panelBox?.height ?? PHONE_HEIGHT).toBeLessThan(PHONE_HEIGHT)

  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox()

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  // The mode switch swaps the form without leaving the sheet.
  await sheet.getByRole('button', { name: 'Loan', exact: true }).click()
  await expect(sheet.getByRole('button', { name: 'Loan', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet.getByTestId('loan-form')).toBeVisible()
  await expect(sheet.getByLabel('Item')).toBeVisible()
  await expect(sheet.getByLabel('Quantity')).toBeVisible()
  await expect(sheet.getByLabel('Unit (optional)')).toBeVisible()

  await sheet.getByRole('button', { name: 'Expense', exact: true }).click()
  await expect(sheet.getByLabel('Amount (₹)')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
