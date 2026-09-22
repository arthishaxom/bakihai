import { type BrowserContextOptions, expect, type Locator, type Page, test } from '@playwright/test'
import jsQR from 'jsqr'
import { PNG } from 'pngjs'
import {
  balanceTexts,
  createGroup,
  entryRow,
  joinGroup,
  memberNames,
  openAddSheet,
  openEntrySheet,
  openSettleUp,
} from './helpers'

// Every test runs at a phone viewport, at phone pixel density: the sheets and
// the QR are mobile surfaces.
const PHONE_WIDTH = 390
const PHONE_HEIGHT = 844
const PHONE: BrowserContextOptions = {
  viewport: { width: PHONE_WIDTH, height: PHONE_HEIGHT },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
}

test.use(PHONE)

/** The UPI ID a Member's row shows, on whatever phone is looking. */
function memberUpi(page: Page, name: string): Locator {
  return page.locator(`li[data-member-name="${name}"]`).getByTestId('member-upi')
}

/** Sets a Payment address from your own Member row and waits for the sheet to close. */
async function setPaymentAddress(page: Page, upiId: string, payeeName: string): Promise<void> {
  await page.getByTestId('own-member').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()
  await sheet.getByLabel('UPI ID').fill(upiId)
  await sheet.getByLabel('Payee name').fill(payeeName)
  await sheet.getByRole('button', { name: /^(Save|Update) UPI ID$/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Adds an Expense from the Add sheet and waits for its line to appear. */
async function addExpense(page: Page, amount: string): Promise<void> {
  const expenses = entryRow(page, 'expense')
  const before = await expenses.count()
  const sheet = await openAddSheet(page)

  await sheet.getByLabel('Amount (₹)').fill(amount)
  await sheet.getByRole('button', { name: 'Add expense' }).click()
  await expect(expenses).toHaveCount(before + 1)
}

/** Settles up a Balance with the prefilled net and an optional note. */
async function settleUp(page: Page, note?: string): Promise<void> {
  const settlements = entryRow(page, 'settlement')
  const before = await settlements.count()
  const sheet = await openSettleUp(page)

  if (note !== undefined) {
    await sheet.getByLabel('Note (optional)').fill(note)
  }

  await sheet.getByRole('button', { name: 'Record settlement' }).click()
  await expect(settlements).toHaveCount(before + 1)
}

/** Decodes the rendered QR, so the test reads what a scanner would. */
async function decodeQr(qr: Locator): Promise<string | null> {
  const image = PNG.sync.read(await qr.screenshot())

  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null
}

test('setting a payment address syncs to the other phone, and editing replaces it everywhere', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Rohan's own row offers to set an address; no one has one yet, so Mira's
  // view of him carries none.
  await expect(memberUpi(rohan, 'Rohan')).toHaveText('Set UPI ID')
  await expect(memberUpi(mira, 'Rohan')).toHaveCount(0)

  // The sheet prefills the payee name from his display name, and refuses
  // anything that does not read like name@bank without closing.
  await rohan.getByTestId('own-member').click()

  const sheet = rohan.getByRole('dialog')

  await expect(sheet).toBeVisible()
  await expect(sheet.getByLabel('Payee name')).toHaveValue('Rohan')
  await sheet.getByLabel('UPI ID').fill('rohan')
  await sheet.getByRole('button', { name: 'Save UPI ID' }).click()
  await expect(sheet.getByRole('alert')).toHaveText('Enter a UPI ID like name@bank')

  await sheet.getByLabel('UPI ID').fill('rohan@okhdfcbank')
  await sheet.getByLabel('Payee name').fill('Rohan Pothal')
  await sheet.getByRole('button', { name: 'Save UPI ID' }).click()
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // The address is an Entry: it lands on both phones without Rohan asking.
  await expect(memberUpi(rohan, 'Rohan')).toHaveText('rohan@okhdfcbank')
  await expect.poll(() => memberUpi(mira, 'Rohan').textContent()).toBe('rohan@okhdfcbank')

  // Editing writes another Entry, and the latest one replaces the old address
  // on every phone rather than adding a second.
  await setPaymentAddress(rohan, 'rohan@ybl', 'Rohan Pothal')
  await expect(memberUpi(rohan, 'Rohan')).toHaveText('rohan@ybl')
  await expect.poll(() => memberUpi(mira, 'Rohan').textContent()).toBe('rohan@ybl')

  await rohanContext.close()
  await miraContext.close()
})

test('Pay via UPI prefills the payee, amount, and note, and the QR is the same intent on a phone', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await setPaymentAddress(mira, 'mira@ybl', 'Mira Nair')

  // Mira paid ₹900 split with Rohan, so he owes her ₹450 and settles up.
  await addExpense(mira, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹450'])
  await settleUp(rohan, 'dinner')

  // Rohan, the payer, opens the Settlement he recorded: the payee, amount, and
  // note are all in the UPI deep link.
  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))
  const intent = 'upi://pay?pa=mira%40ybl&pn=Mira%20Nair&am=450&cu=INR&tn=dinner'

  await expect(sheet.getByTestId('upi-payment')).toContainText('Pay Mira ₹450 to mira@ybl.')
  await expect(sheet.getByTestId('pay-via-upi')).toHaveAttribute('href', intent)

  // The QR action shows the same intent, at a size a phone can scan.
  await sheet.getByTestId('show-upi-qr').click()

  const qr = sheet.getByTestId('upi-qr')

  await expect(qr).toBeVisible()

  const qrBox = await qr.boundingBox()

  expect(qrBox).not.toBeNull()
  expect(qrBox?.width ?? 0).toBeGreaterThanOrEqual(200)
  expect((qrBox?.x ?? 0) + (qrBox?.width ?? 0)).toBeLessThanOrEqual(PHONE_WIDTH)
  expect(await decodeQr(qr)).toBe(intent)

  // The sheet stays a thumb-sized bottom sheet with the QR open.
  const panelBox = await sheet.getByTestId('entry-sheet-panel').boundingBox()

  expect(panelBox).not.toBeNull()
  expect((panelBox?.y ?? 0) + (panelBox?.height ?? 0)).toBeGreaterThanOrEqual(PHONE_HEIGHT - 2)

  for (const button of await sheet.getByRole('button').all()) {
    const box = await button.boundingBox()

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }

  // A second tap hides the same QR again.
  await sheet.getByTestId('show-upi-qr').click()
  await expect(sheet.getByTestId('upi-qr')).toHaveCount(0)

  await rohan.keyboard.press('Escape')
  await expect(rohan.getByRole('dialog')).toHaveCount(0)

  // Mira, the receiver, is never offered the payer's action, but she can show
  // the same intent as a QR for an in-person scan.
  const receiverSheet = await openEntrySheet(mira, entryRow(mira, 'settlement'))

  await expect(receiverSheet.getByTestId('pay-via-upi')).toHaveCount(0)
  await expect(receiverSheet.getByTestId('upi-payment')).toContainText(
    'Show the QR to be paid ₹450 at mira@ybl.',
  )

  await receiverSheet.getByTestId('show-upi-qr').click()
  expect(await decodeQr(receiverSheet.getByTestId('upi-qr'))).toBe(intent)

  // Once the receiver confirms the claim the money has moved, so neither phone
  // offers the UPI actions again.
  await receiverSheet.getByTestId('confirm-settlement').click()
  await expect(mira.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => rohan.getByTestId('waiting-count').count()).toBe(0)

  const confirmedSheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(confirmedSheet.getByTestId('upi-payment')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})

test('a Member with no payment address offers no Pay via UPI action', async ({ browser }) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(mira, '900')
  await expect.poll(() => balanceTexts(rohan)).toEqual(['You owe Mira ₹450'])
  await settleUp(rohan)

  const sheet = await openEntrySheet(rohan, entryRow(rohan, 'settlement'))

  await expect(sheet.getByTestId('settlement-status')).toBeVisible()
  await expect(sheet.getByTestId('upi-payment')).toHaveCount(0)
  await expect(sheet.getByTestId('pay-via-upi')).toHaveCount(0)
  await expect(sheet.getByTestId('show-upi-qr')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})
