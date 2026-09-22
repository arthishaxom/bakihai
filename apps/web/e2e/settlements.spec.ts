import { type BrowserContextOptions, expect, type Page, test } from '@playwright/test'
import {
  balanceTexts,
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  openAddSheet,
  openEntrySheet,
  openSettlementForm,
  openSettleUp,
  setShowHidden,
} from './helpers'

// Every test runs at a phone viewport: the Settlement surfaces are mobile sheets.
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

/** Records a Settlement from the Add sheet's Settlement form and waits for its line. */
async function addSettlement(
  page: Page,
  {
    direction,
    member,
    amount,
    note,
  }: { direction: 'paid' | 'received'; member: string; amount: string; note?: string },
): Promise<void> {
  const settlements = entryRow(page, 'settlement')
  const before = await settlements.count()
  const sheet = await openSettlementForm(page)

  if (direction === 'received') {
    await sheet.getByRole('radio', { name: 'They paid me' }).check()
  }

  await sheet.getByLabel('Member').selectOption({ label: member })
  await sheet.getByLabel('Amount (₹)').fill(amount)

  if (note !== undefined) {
    await sheet.getByLabel('Note (optional)').fill(note)
  }

  await sheet.getByRole('button', { name: 'Add settlement' }).click()
  await expect(settlements).toHaveCount(before + 1)
}

test('a claim shows as unconfirmed on both phones, moves the Balance, and clears when the receiver confirms', async ({
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

  // Mira, the payer, claims "I paid Rohan ₹450" with a note.
  await addSettlement(mira, { direction: 'paid', member: 'Rohan', amount: '450', note: 'dinner' })

  // The claim counts toward the Balance immediately, on both phones.
  await expect(entryRow(mira, 'settlement')).toContainText('Mira paid Rohan ₹450 · dinner')
  await expect(entryRow(mira, 'settlement')).toContainText('Waiting for Rohan to confirm')
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect.poll(() => balanceTexts(rohan)).toEqual([])

  // Both phones see the unconfirmed line and the waiting count.
  await expect
    .poll(() => entryRow(rohan, 'settlement').textContent())
    .toContain('Waiting for Rohan to confirm')
  await expect(mira.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )
  await expect(rohan.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )

  // Rohan, the receiver, opens the Settlement's detail sheet: it is a phone
  // sheet pinned to the bottom with thumb-sized targets.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(sheet).toContainText('Mira paid Rohan ₹450 · dinner')
  await expect(sheet.getByTestId('settlement-status')).toHaveText('Waiting for Rohan to confirm')

  const panel = sheet.getByTestId('entry-sheet-panel')
  const panelBox = await panel.boundingBox()

  expect(panelBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThanOrEqual(PHONE_HEIGHT - 2)
  // Anchored to the bottom, not filling the screen.
  expect(panelBox?.height ?? PHONE_HEIGHT).toBeLessThan(PHONE_HEIGHT)

  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox()

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  // The payer's own device is never offered the Confirm action.
  const payerSheet = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await expect(payerSheet.getByTestId('confirm-settlement')).toHaveCount(0)
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  await sheet.getByTestId('confirm-settlement').click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The waiting count clears on both phones and the line stops reading as
  // unconfirmed; the confirmed state is named in the detail sheet.
  await expect(rohan.getByTestId('waiting-count')).toHaveCount(0)
  await expect.poll(() => mira.getByTestId('waiting-count').count()).toBe(0)
  await expect(entryRow(rohan, 'settlement')).not.toContainText('Waiting for')

  // The Confirm is an Entry of its own: its line names what it attested to,
  // and both phones read it the same way.
  await expect(entryRow(rohan, 'settlement-confirm')).toContainText(
    'Rohan confirmed “Mira paid Rohan ₹450 · dinner”',
  )
  await expect
    .poll(() => entryRow(mira, 'settlement-confirm').textContent())
    .toContain('Rohan confirmed “Mira paid Rohan ₹450 · dinner”')

  const confirmedSheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(confirmedSheet.getByTestId('settlement-status')).toHaveText('Confirmed by Rohan')
  await expect(confirmedSheet.getByTestId('confirm-settlement')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('a Settlement the receiver records is confirmed from the start and never waits', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(mira, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹450'])

  // Mira, the receiver, records "Rohan paid me ₹450": there is nothing left to
  // attest, so it is confirmed the moment it is written (ADR-0015).
  await addSettlement(mira, { direction: 'received', member: 'Rohan', amount: '450' })

  await expect(entryRow(mira, 'settlement')).toContainText('Rohan paid Mira ₹450')
  await expect(entryRow(mira, 'settlement')).not.toContainText('Waiting for')
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect.poll(() => balanceTexts(mira)).toEqual([])

  // The waiting count never appears on either phone.
  await expect(mira.getByTestId('waiting-count')).toHaveCount(0)
  await expect(rohan.getByTestId('waiting-count')).toHaveCount(0)

  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(sheet.getByTestId('settlement-status')).toHaveText('Confirmed by Mira')
  await expect(sheet.getByTestId('confirm-settlement')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('Settle up prefills the net, accepts a partial amount, and both phones agree after sync', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(mira, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹450'])

  // Rohan, the debtor, settles up from his Balance row: the sheet names the
  // net and prefills it, owing side to owed side.
  const sheet = await openSettleUp(rohan)

  await expect(sheet.getByTestId('settle-up-net')).toHaveText('You owe Mira ₹450')
  await expect(sheet.getByLabel('Amount (₹)')).toHaveValue('450')

  // A partial payment is normal: he pays ₹200 and leaves ₹250 outstanding.
  await sheet.getByLabel('Amount (₹)').fill('200')
  await expect(sheet.getByTestId('settlement-summary')).toHaveText('You paid Mira ₹200')
  await sheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The claim counts immediately and waits for Mira; both phones agree.
  await expect(entryRow(rohan, 'settlement')).toContainText('Rohan paid Mira ₹200')
  await expect(entryRow(rohan, 'settlement')).toContainText('Waiting for Mira to confirm')
  await expect(rohan.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹250'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['Rohan owes You ₹250'])

  // Mira confirms the partial payment from its detail sheet; the count clears
  // on both phones and the net stays where the partial payment left it.
  const miraSheet = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await miraSheet.getByTestId('confirm-settlement').click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  await expect.poll(() => rohan.getByTestId('waiting-count').count()).toBe(0)
  await expect(mira.getByTestId('waiting-count')).toHaveCount(0)
  await expect(balanceTexts(rohan)).resolves.toEqual(['You owe Mira ₹250'])
  await expect(balanceTexts(mira)).resolves.toEqual(['Rohan owes You ₹250'])

  await rohanContext.close()
  await miraContext.close()
})

test('an offline Settlement converges and nets identically on both phones', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(mira, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹450'])

  // Both phones lose the network and each records what it saw: Rohan claims he
  // paid ₹100, Mira records that he paid her ₹50.
  await rohanContext.setOffline(true)
  await miraContext.setOffline(true)

  await addSettlement(rohan, { direction: 'paid', member: 'Mira', amount: '100' })
  await addSettlement(mira, { direction: 'received', member: 'Rohan', amount: '50' })

  // Each phone's own copy is believable on its own: ₹350 and ₹400 left.
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹350'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['Rohan owes You ₹400'])

  // Back online, both Settlements land on both phones and the net converges.
  await rohanContext.setOffline(false)
  await miraContext.setOffline(false)

  await expect.poll(() => balanceTexts(rohan), { timeout: 15_000 }).toEqual(['You owe Mira ₹300'])
  await expect.poll(() => balanceTexts(mira), { timeout: 15_000 }).toEqual(['Rohan owes You ₹300'])

  // Both lines are there for everyone: the claim waits, the receiver's record
  // is confirmed, and the count agrees on both phones.
  await expect(entryRow(rohan, 'settlement')).toHaveCount(2)
  await expect(entryRow(mira, 'settlement')).toHaveCount(2)
  await expect(rohan.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )
  await expect(mira.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )

  await rohanContext.close()
  await miraContext.close()
})

test('Voiding a Settlement puts the Balance back on both phones', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])

  await addSettlement(mira, { direction: 'paid', member: 'Rohan', amount: '450' })
  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect(rohan.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )

  // Rohan, the receiver, disputes the claim and Voids it instead of confirming.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(sheet.getByTestId('confirm-settlement')).toBeVisible()
  await sheet.getByLabel('Reason (optional)').fill('never arrived')
  await sheet.getByRole('button', { name: 'Void entry' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The Settlement stops counting toward Balances and stops waiting; both
  // lines stay in the book, the claim struck through.
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹450'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹450'])
  await expect.poll(() => rohan.getByTestId('waiting-count').count()).toBe(0)
  await expect.poll(() => mira.getByTestId('waiting-count').count()).toBe(0)

  const struck = rohan.locator('li[data-voided="true"]')

  await setShowHidden(rohan, true)

  await expect(struck).toContainText('Mira paid Rohan ₹450')
  await expect(struck).toContainText('Voided by Rohan — never arrived')
  await expect(entryRow(rohan, 'void')).toContainText('Rohan voided “Mira paid Rohan ₹450”')

  await setShowHidden(mira, true)
  await expect(mira.locator('li[data-voided="true"]')).toContainText(
    'Voided by Rohan — never arrived',
  )

  // A Voided Settlement offers no Confirm.
  const voidedSheet = await openEntrySheet(rohan, struck)

  await expect(voidedSheet.getByTestId('confirm-settlement')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('Add is a bottom sheet with a Settlement mode that says what an untagged Settlement does', async ({
  browser,
  page,
}) => {
  const invite = await createGroup(page, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(page)).toEqual(['Rohan', 'Mira'])

  const sheet = await openSettlementForm(page)

  await expect(sheet.getByRole('button', { name: 'Settlement', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(sheet.getByTestId('settlement-form')).toBeVisible()
  await expect(sheet.getByRole('radio', { name: 'I paid' })).toBeChecked()
  await expect(sheet.getByRole('radio', { name: 'They paid me' })).not.toBeChecked()
  await expect(sheet.getByLabel('Amount (₹)')).toBeVisible()
  await expect(sheet.getByLabel('Note (optional)')).toBeVisible()
  await expect(sheet.getByTestId('settlement-untagged-notice')).toHaveText(
    'Not attached to an Expense or Loan — this Settlement only moves the Balance.',
  )

  // The sheet is anchored to the bottom of the phone viewport, and every
  // action in it is a thumb-sized target.
  const panel = sheet.getByTestId('add-sheet-panel')
  const panelBox = await panel.boundingBox()

  expect(panelBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThanOrEqual(PHONE_HEIGHT - 2)

  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox()

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  // A Settlement typed into the form reads back from this device's side, and
  // the direction flips with the pills.
  await sheet.getByLabel('Amount (₹)').fill('120')
  await expect(sheet.getByTestId('settlement-summary')).toHaveText('You paid Mira ₹120')

  await sheet.getByRole('radio', { name: 'They paid me' }).check()
  await expect(sheet.getByTestId('settlement-summary')).toHaveText('Mira paid you ₹120')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await miraContext.close()
})
