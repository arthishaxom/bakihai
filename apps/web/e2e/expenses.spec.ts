import { expect, type Page, test } from '@playwright/test'
import { createGroup, joinGroup, memberNames } from './helpers'

function balanceTexts(page: Page): Promise<string[]> {
  return page
    .getByTestId('balance-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))
}

/**
 * Adds an Expense from the form: the payer is whoever is using the device, and
 * everyone shares unless a name is passed in `excluding` (the treat case).
 */
async function addExpense(
  page: Page,
  { amount, excluding = [] }: { amount: string; excluding?: string[] },
): Promise<void> {
  const entries = page.getByTestId('entry-list').locator('li')
  const before = await entries.count()

  await page.getByLabel('Amount (₹)').fill(amount)

  for (const name of excluding) {
    await page.getByRole('checkbox', { name }).uncheck()
  }

  await page.getByRole('button', { name: 'Add expense' }).click()
  await expect(entries).toHaveCount(before + 1)
}

test('a ₹900 dinner split three ways shows each other participant owing the payer ₹300', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')

  const kabirContext = await browser.newContext()
  const kabir = await kabirContext.newPage()
  await joinGroup(kabir, invite, 'Kabir')

  // The payer's device needs the whole roster before choosing who shares.
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira', 'Kabir'])

  await addExpense(rohan, { amount: '900' })

  await expect
    .poll(async () => (await balanceTexts(rohan)).sort())
    .toEqual(['Kabir owes You ₹300', 'Mira owes You ₹300'])
  await expect
    .poll(async () => (await balanceTexts(mira)).sort())
    .toEqual(['Kabir owes Rohan ₹300', 'You owe Rohan ₹300'])
  await expect
    .poll(async () => (await balanceTexts(kabir)).sort())
    .toEqual(['Mira owes Rohan ₹300', 'You owe Rohan ₹300'])

  await rohanContext.close()
  await miraContext.close()
  await kabirContext.close()
})

test('paying for others without sharing the cost charges each of them their share', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Rohan treats Mira: he pays, but only Mira shares the cost.
  await addExpense(rohan, { amount: '300', excluding: ['Rohan'] })

  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹300'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹300'])

  await rohanContext.close()
  await miraContext.close()
})

test('a pair that has squared up shows no Balance', async ({ browser }) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  // Each treats the other once, so the pair's balance nets to zero.
  await addExpense(rohan, { amount: '100', excluding: ['Rohan'] })
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹100'])
  await addExpense(mira, { amount: '100', excluding: ['Mira'] })

  await expect.poll(() => balanceTexts(rohan)).toEqual([])
  await expect(rohan.getByTestId('no-balances')).toBeVisible()
  await expect.poll(() => balanceTexts(mira)).toEqual([])
  await expect(mira.getByTestId('no-balances')).toBeVisible()

  await rohanContext.close()
  await miraContext.close()
})

test('the book shows Entries newest first', async ({ page }) => {
  await createGroup(page, 'Flat 3B', 'Rohan')

  await addExpense(page, { amount: '100' })
  await page.waitForTimeout(20)
  await addExpense(page, { amount: '250' })

  const entries = await page
    .getByTestId('entry-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))

  expect(entries).toHaveLength(2)
  expect(entries[0]).toContain('₹250')
  expect(entries[1]).toContain('₹100')
})

test('an amount that is not rupees is refused with an explanation', async ({ page }) => {
  await createGroup(page, 'Flat 3B', 'Rohan')

  await page.getByLabel('Amount (₹)').fill('12.345')
  await page.getByRole('button', { name: 'Add expense' }).click()

  await expect(page.getByRole('alert')).toContainText('Enter an amount in rupees')
  await expect(page.getByTestId('entry-list')).toHaveCount(0)
})
