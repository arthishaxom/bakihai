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
  openSettleUp,
  setShowHidden,
} from './helpers'

// Every test runs at a phone viewport: the Member list and the Add sheet are mobile surfaces.
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
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

/** Archives the named Member from their row in the active list. */
async function archiveMember(page: Page, displayName: string): Promise<void> {
  await memberRow(page, displayName).getByTestId('archive-member').click()
  await expect.poll(() => archivedMemberNames(page)).toContain(displayName)
}

test('archiving a Member leaves every picker while their Balance stays settleable', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Mira owes Rohan ₹450 on a ₹900 dinner.
  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  await archiveMember(rohan, 'Mira')

  // She leaves the active list on both phones and groups at the bottom marked
  // Archived; her Entry stays exactly where it was.
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan'])
  await expect.poll(() => memberNames(mira)).toEqual(['Rohan'])
  await expect.poll(() => archivedMemberNames(rohan)).toEqual(['Mira'])
  await expect.poll(() => archivedMemberNames(mira)).toEqual(['Mira'])
  await expect(rohan.getByTestId('archived-members')).toContainText('Archived')
  await expect(archivedMemberRow(rohan, 'Mira')).toContainText('Archived')
  await expect(entryRow(rohan, 'expense')).toHaveCount(1)

  // The archive is an Entry like any other, and reads on both phones.
  await expect(rohan.getByTestId('entry-list')).toContainText('Rohan archived Mira')
  await expect
    .poll(() => mira.getByTestId('entry-list').textContent())
    .toContain('Rohan archived Mira')

  // Every picker leaves her out. With no one left to pick, the forms say so.
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText(['Rohan (you)'])
  await expect(sheet.locator('[data-participant-name]')).toHaveCount(1)

  await sheet.getByRole('button', { name: 'Loan', exact: true }).click()
  await expect(sheet.getByLabel('Member').locator('option')).toHaveCount(0)
  await expect(sheet).toContainText('Add another Member before recording a Loan.')

  await sheet.getByRole('button', { name: 'Settlement', exact: true }).click()
  await expect(sheet.getByLabel('Member').locator('option')).toHaveCount(0)
  await expect(sheet).toContainText('Add another Member before recording a Settlement.')

  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The Balance survives her archiving, marked Archived on both phones...
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹450 · Archived'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450 · Archived'])

  // ...and Settle up still works with her.
  const settleSheet = await openSettleUp(rohan)

  await expect(settleSheet.getByTestId('settle-up-net')).toContainText('Mira owes You ₹450')
  await settleSheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect(rohan.getByTestId('entry-list')).toContainText('Mira paid Rohan ₹450')

  await rohanContext.close()
  await miraContext.close()
})

test('Voiding the archive marker restores the Member to the active list and the pickers', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await archiveMember(rohan, 'Mira')
  await expect.poll(() => archivedMemberNames(mira)).toEqual(['Mira'])

  // The other phone can undo it too: the marker syncs like any Entry, and a
  // Void of it is the documented undo.
  await archivedMemberRow(mira, 'Mira').getByTestId('unarchive-member').click()

  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])
  await expect.poll(() => memberNames(mira)).toEqual(['Rohan', 'Mira'])
  await expect(rohan.getByTestId('archived-members')).toHaveCount(0)

  // She is back in every picker.
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText(['Rohan (you)', 'Mira'])
  await sheet.getByRole('button', { name: 'Loan', exact: true }).click()
  await expect(sheet.getByLabel('Member').locator('option')).toHaveText(['Mira'])
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The undo is a Void: the marker and its Void go quiet together, and Show
  // hidden brings the marker back struck through, with the Undo named.
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(0)

  await setShowHidden(rohan, true)
  await expect(rohan.locator('li[data-entry-type="member-archived"]')).toContainText(
    'Rohan archived Mira',
  )
  await expect(rohan.locator('li[data-entry-type="member-archived"]')).toContainText(
    'Voided by Mira',
  )

  await rohanContext.close()
  await miraContext.close()
})

test('a wiped phone rejoins as a new Member while the old identity stays frozen', async ({
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

  // Mira's phone is wiped: Rohan archives her, and that device is gone.
  await archiveMember(rohan, 'Mira')
  await miraContext.close()

  // She rejoins from the invite link on a new phone. The old identity stays
  // frozen: it keeps its name, its Archived mark, and its debt.
  const rejoinedContext = await browser.newContext(PHONE)
  const rejoined = await rejoinedContext.newPage()
  await joinGroup(rejoined, invite, 'Mira (new)')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira (new)'])
  await expect.poll(() => archivedMemberNames(rohan)).toEqual(['Mira'])

  // Pickers offer the new Member, and the old one's Balance still reads.
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText([
    'Rohan (you)',
    'Mira (new)',
  ])
  await sheet.getByRole('button', { name: 'Close' }).click()

  // The new Member takes part in the book while the frozen debt lives on.
  await addExpense(rohan, '100')
  await expect
    .poll(async () => (await balanceTexts(rohan)).sort())
    .toEqual(['Mira (new) owes You ₹50', 'Mira owes You ₹450 · Archived'].sort())

  await rohanContext.close()
  await rejoinedContext.close()
})
