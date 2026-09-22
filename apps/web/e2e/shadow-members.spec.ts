import { type BrowserContextOptions, expect, type Page, test } from '@playwright/test'
import {
  addShadowMember,
  archivedMemberNames,
  archivedMemberRow,
  balanceTexts,
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  memberRow,
  openAddSheet,
  openEntrySheet,
  openLoanForm,
  openSettlementForm,
  openSettleUp,
} from './helpers'

// Every test runs at a phone viewport: the Member list and the Add sheet are mobile surfaces.
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

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

test('a clock that jumps back between join and add keeps the holder in front', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await rohan.goto('/')
  // Rohan joins at one time...
  await rohan.clock.setFixedTime(new Date('2026-09-23T12:00:00.000Z'))
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  // ...and the clock jumps back an hour before the person without the app is
  // added. Minted from it, their Entry id would sort before Rohan's own Member
  // Entry and the fold would name them the phone (#27); the writer floors
  // their id to Rohan's own instead.
  await rohan.clock.setFixedTime(new Date('2026-09-23T11:00:00.000Z'))
  await addShadowMember(rohan, 'Rohit')

  await expect(memberRow(rohan, 'Rohit')).toContainText('No phone · Added by you')
  await expect(rohan.getByTestId('own-member')).toContainText('Rohan')

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

  // The Archived row keeps the "No phone" marker and the holder's name.
  await expect(archivedMemberRow(rohan, 'Rohit')).toContainText('No phone · Added by you')

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

test('a name an archived Member uses still warns', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')
  await memberRow(rohan, 'Rohit').getByTestId('archive-member').click()
  await expect.poll(() => archivedMemberNames(rohan)).toEqual(['Rohit'])

  await rohan.getByTestId('add-shadow-member').click()

  const sheet = rohan.getByRole('dialog')

  await sheet.getByLabel('Name').fill('rohit')
  await expect(sheet.getByTestId('duplicate-name-warning')).toContainText('already in this Group')
  await sheet.getByRole('button', { name: 'Close' }).click()

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

test('a Settlement to a Shadow Member is confirmed by its key holder', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')

  // Rohan records "I paid Rohit ₹100": he holds Rohit's key, so the receiver's
  // side authored it and nothing waits on a phone that does not exist.
  const settlements = entryRow(rohan, 'settlement')
  const before = await settlements.count()
  const form = await openSettlementForm(rohan)

  await form.getByLabel('Member').selectOption({ label: 'Rohit' })
  await form.getByLabel('Amount (₹)').fill('100')
  await form.getByRole('button', { name: 'Add settlement' }).click()
  await expect(settlements).toHaveCount(before + 1)

  await expect(settlements).toContainText('Rohan paid Rohit ₹100')
  await expect(settlements).not.toContainText('Waiting for')
  await expect(rohan.getByTestId('waiting-count')).toHaveCount(0)

  // The detail sheet names who attested, and offers no Confirm: it is done.
  const sheet = await openEntrySheet(rohan, settlements)

  await expect(sheet.getByTestId('settlement-status')).toHaveText('Confirmed by Rohan')
  await expect(sheet.getByTestId('confirm-settlement')).toHaveCount(0)

  await rohanContext.close()
})

test('a claim against a Shadow Member is confirmed by the holder', async ({ browser }) => {
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

  // Mira claims "I paid Rohit ₹100". Only Rohan, who holds Rohit's key, can
  // attest to it.
  const settlements = entryRow(mira, 'settlement')
  const before = await settlements.count()
  const form = await openSettlementForm(mira)

  await form.getByLabel('Member').selectOption({ label: 'Rohit' })
  await form.getByLabel('Amount (₹)').fill('100')
  await form.getByRole('button', { name: 'Add settlement' }).click()
  await expect(settlements).toHaveCount(before + 1)

  await expect(settlements).toContainText('Waiting for Rohan to confirm')
  await expect(mira.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )
  await expect(rohan.getByTestId('waiting-count')).toHaveText(
    '1 Settlement waiting for confirmation',
  )

  // The payer's phone is never offered the Confirm...
  const payerSheet = await openEntrySheet(mira, settlements)

  await expect(payerSheet.getByTestId('confirm-settlement')).toHaveCount(0)
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // ...the holder's phone is, and confirming clears the wait everywhere.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await sheet.getByTestId('confirm-settlement').click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  await expect(rohan.getByTestId('waiting-count')).toHaveCount(0)
  await expect.poll(() => mira.getByTestId('waiting-count').count()).toBe(0)
  await expect(entryRow(rohan, 'settlement')).not.toContainText('Waiting for')
  await expect(entryRow(rohan, 'settlement-confirm')).toContainText('Rohan confirmed')
  await expect(entryRow(rohan, 'settlement-confirm')).toContainText('Mira paid Rohit ₹100')

  const confirmedSheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(confirmedSheet.getByTestId('settlement-status')).toHaveText('Confirmed by Rohan')

  await rohanContext.close()
  await miraContext.close()
})

test("the book keeps folding and settling a Shadow Member after its holder's key is gone", async ({
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

  // Rohit covered Mira's dinner: she owes him ₹200.
  const sheet = await openAddSheet(mira)

  await sheet.getByLabel('Amount (₹)').fill('200')
  await sheet.getByLabel('Paid by').selectOption({ label: 'Rohit' })
  await sheet.getByRole('checkbox', { name: 'Rohan' }).uncheck()
  await sheet.getByRole('checkbox', { name: 'Rohit' }).uncheck()
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohit ₹200'])

  // Rohan's phone is wiped and Mira marks his device gone. Rohit's id stays
  // bound to Rohan's key, which now authors nothing more.
  await rohanContext.close()
  await memberRow(mira, 'Rohan').getByTestId('archive-member').click()
  await expect.poll(() => archivedMemberNames(mira)).toEqual(['Rohan'])

  // The shadow keeps folding: still in the active list, still marked, with
  // its Balance untouched.
  await expect.poll(async () => (await memberNames(mira)).sort()).toEqual(['Mira', 'Rohit'])
  await expect(memberRow(mira, 'Rohit')).toContainText('No phone · Added by Rohan')
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohit ₹200'])

  // The person gets a new phone and rejoins under his own name. His key is
  // new, so it attests nothing: the shadow's frozen holder stays the old
  // Rohan, who now sits under Archived.
  const successorContext = await browser.newContext(PHONE)
  const successor = await successorContext.newPage()
  await joinGroup(successor, invite, 'Rohan (new)')
  await expect
    .poll(async () => (await memberNames(successor)).sort())
    .toEqual(['Mira', 'Rohan (new)', 'Rohit'])
  await expect(memberRow(successor, 'Rohit')).toContainText('No phone · Added by Rohan')
  await expect.poll(() => archivedMemberNames(successor)).toEqual(['Rohan'])

  // Settling still works: Mira records what she paid.
  const form = await openSettlementForm(mira)

  await form.getByLabel('Member').selectOption({ label: 'Rohit' })
  await form.getByLabel('Amount (₹)').fill('200')
  await form.getByRole('button', { name: 'Add settlement' }).click()
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect(mira.getByTestId('entry-list')).toContainText('Mira paid Rohit ₹200')

  // Attestation ended with Rohan's key: the claim keeps its place in the book
  // and its wait on that frozen key (ADR-0018, ADR-0021), while the rejoin
  // that inherited Rohan's name holds nothing and is offered no Confirm.
  const detail = await openEntrySheet(successor, entryRow(successor, 'settlement'))

  await expect(detail.getByTestId('confirm-settlement')).toHaveCount(0)
  await expect(detail.getByTestId('settlement-status')).toHaveText('Waiting for Rohan to confirm')
  await successor.keyboard.press('Escape')
  await expect(successor.getByRole('dialog')).toHaveCount(0)

  // Neither is the shadow's payer.
  const payerDetail = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await expect(payerDetail.getByTestId('confirm-settlement')).toHaveCount(0)
  await mira.keyboard.press('Escape')
  await expect(mira.getByRole('dialog')).toHaveCount(0)

  // And the shadow is still archivable like any Member: the marker folds, and
  // the frozen holder's name stays on the row.
  await memberRow(mira, 'Rohit').getByTestId('archive-member').click()
  await expect.poll(() => archivedMemberNames(mira)).toEqual(['Rohan', 'Rohit'])
  await expect(archivedMemberRow(mira, 'Rohit')).toContainText('No phone · Added by Rohan')
  await expect(archivedMemberRow(mira, 'Rohit')).toContainText('Archived')

  await miraContext.close()
  await successorContext.close()
})

test('a person who installs the app joins as a new Member while the Shadow Member keeps its history', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  await addShadowMember(rohan, 'Rohit')
  await addExpense(rohan, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['Rohit owes You ₹450'])

  // Rohit installs the app and joins through the ordinary invite as a new
  // Member. There is no link, merge, or handover: the shadow stays as it is
  // (ADR-0020).
  const rohitContext = await browser.newContext(PHONE)
  const rohit = await rohitContext.newPage()
  await joinGroup(rohit, invite, 'Rohit (app)')
  await expect
    .poll(async () => (await memberNames(rohan)).sort())
    .toEqual(['Rohan', 'Rohit', 'Rohit (app)'].sort())

  // On his own phone the tracked person reads as a separate phone-less Member
  // held by Rohan, beside his own Membership row.
  await expect(memberRow(rohit, 'Rohit')).toContainText('No phone · Added by Rohan')
  await expect(rohit.getByTestId('own-member')).toContainText('Rohit (app)')
  await expect(rohit.getByTestId('own-member')).toContainText('(you)')

  // Every picker offers both, and the new Member takes part in the book.
  const sheet = await openAddSheet(rohan)

  await expect(sheet.getByLabel('Paid by').locator('option')).toHaveText([
    'Rohan (you)',
    'Rohit',
    'Rohit (app)',
  ])
  await sheet.getByRole('button', { name: 'Close' }).click()

  const second = await openAddSheet(rohan)

  await second.getByLabel('Amount (₹)').fill('100')
  await second.locator('[data-participant-name="Rohit"] input[type="checkbox"]').uncheck()
  await second.getByRole('button', { name: 'Add expense' }).click()
  await expect
    .poll(async () => (await balanceTexts(rohan)).sort())
    .toEqual(['Rohit (app) owes You ₹50', 'Rohit owes You ₹450'].sort())

  // The shadow keeps its own history and is still archivable; the real Member
  // stays active beside it.
  await memberRow(rohan, 'Rohit').getByTestId('archive-member').click()
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Rohit (app)'])
  await expect.poll(() => archivedMemberNames(rohan)).toEqual(['Rohit'])
  await expect
    .poll(async () => (await balanceTexts(rohan)).sort())
    .toEqual(['Rohit (app) owes You ₹50', 'Rohit owes You ₹450 · Archived'].sort())

  await rohanContext.close()
  await rohitContext.close()
})
