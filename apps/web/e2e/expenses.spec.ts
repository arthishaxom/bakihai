import { expect, type Page, test } from '@playwright/test'
import { createGroup, joinGroup, memberNames } from './helpers'

function balanceTexts(page: Page): Promise<string[]> {
  return page
    .getByTestId('balance-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))
}

/** One Member's pill in the Add Expense form, addressed by display name. */
function pill(page: Page, name: string) {
  return page.locator(`[data-participant-name="${name}"]`)
}

/** The exact paise the pills show, sorted so the device-id remainder order does not matter. */
function sharePaise(page: Page): Promise<number[]> {
  return page
    .locator('[data-share-paise]')
    .evaluateAll((pills) =>
      pills
        .map((pill) => Number(pill.getAttribute('data-share-paise')))
        .sort((left, right) => left - right),
    )
}

/**
 * Adds an Expense from the form: the payer is whoever is using the device, and
 * everyone shares unless a name is passed in `excluding` (the payer is then
 * fronting the cost for them).
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

test('the form previews each exact share and redistributes when a Member is unselected', async ({
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

  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira', 'Kabir'])

  // A pill is a real checkbox: Space toggles it from the keyboard.
  await rohan.getByRole('checkbox', { name: 'Mira' }).focus()
  await rohan.keyboard.press('Space')
  await expect(rohan.getByRole('checkbox', { name: 'Mira' })).not.toBeChecked()
  await rohan.keyboard.press('Space')
  await expect(rohan.getByRole('checkbox', { name: 'Mira' })).toBeChecked()

  await rohan.getByLabel('Amount (₹)').fill('900')
  await expect(rohan.getByTestId('split-summary')).toHaveText('Rohan paid ₹900 · ₹300 each')
  await expect(pill(rohan, 'Mira')).toHaveAttribute('data-share-paise', '30000')
  await expect(pill(rohan, 'Kabir')).toHaveAttribute('data-share-paise', '30000')

  // ₹100 three ways leaves a remainder: one pill carries the extra paise.
  await rohan.getByLabel('Amount (₹)').fill('100')
  await expect.poll(() => sharePaise(rohan)).toEqual([3333, 3333, 3334])
  await expect(rohan.getByTestId('split-summary')).toContainText('₹33.34')
  await expect(rohan.getByTestId('split-summary')).toContainText('₹33.33')

  // Unselecting Mira splits ₹100 between the two who remain.
  await rohan.getByRole('checkbox', { name: 'Mira' }).uncheck()
  await expect(pill(rohan, 'Mira')).not.toHaveAttribute('data-share-paise')
  await expect(pill(rohan, 'Rohan')).toHaveAttribute('data-share-paise', '5000')
  await expect(pill(rohan, 'Kabir')).toHaveAttribute('data-share-paise', '5000')
  await expect(rohan.getByTestId('split-summary')).toHaveText('Rohan paid ₹100 · ₹50 each')

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

  // Rohan fronts Mira's cost: he pays, but only Mira shares it.
  await rohan.getByLabel('Amount (₹)').fill('300')
  await rohan.getByRole('checkbox', { name: 'Rohan' }).uncheck()
  await expect(rohan.getByTestId('split-summary')).toHaveText('Rohan paid ₹300 · Mira owes ₹300')

  await addExpense(rohan, { amount: '300', excluding: ['Rohan'] })

  await expect.poll(() => balanceTexts(rohan)).toEqual(['Mira owes You ₹300'])
  await expect.poll(() => balanceTexts(mira)).toEqual(['You owe Rohan ₹300'])

  await rohanContext.close()
  await miraContext.close()
})

test('excluding the payer names what each of the others owes', async ({ browser }) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')

  const kabirContext = await browser.newContext()
  const kabir = await kabirContext.newPage()
  await joinGroup(kabir, invite, 'Kabir')

  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira', 'Kabir'])

  await rohan.getByLabel('Amount (₹)').fill('900')
  await rohan.getByRole('checkbox', { name: 'Rohan' }).uncheck()

  await expect(rohan.getByTestId('split-summary')).toHaveText(
    'Rohan paid ₹900 · Mira and Kabir each owe ₹450',
  )
  await expect(pill(rohan, 'Rohan')).not.toHaveAttribute('data-share-paise')
  await expect(pill(rohan, 'Mira')).toHaveAttribute('data-share-paise', '45000')
  await expect(pill(rohan, 'Kabir')).toHaveAttribute('data-share-paise', '45000')

  await rohan.getByRole('button', { name: 'Add expense' }).click()
  await expect(rohan.getByTestId('entry-list').locator('li')).toHaveCount(1)
  // The payer is fronting a cost the others owe, so the word is gone from every screen.
  await expect(rohan.locator('body')).not.toContainText(/treat/i)
  await expect
    .poll(async () => (await balanceTexts(rohan)).sort())
    .toEqual(['Kabir owes You ₹450', 'Mira owes You ₹450'])

  await rohanContext.close()
  await miraContext.close()
  await kabirContext.close()
})

test('a split only the payer shares cannot be submitted and the form says why', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await rohan.getByLabel('Amount (₹)').fill('300')
  await expect(rohan.getByTestId('split-summary')).toHaveText('Rohan paid ₹300 · ₹150 each')

  // Only the payer left in the split: blocked, with the reason on screen.
  await rohan.getByRole('checkbox', { name: 'Mira' }).uncheck()
  await expect(rohan.getByTestId('split-explanation')).toContainText(
    'Only Rohan is in the split, so nothing is owed.',
  )
  await expect(rohan.getByRole('button', { name: 'Add expense' })).toBeDisabled()
  await expect(rohan.getByTestId('entry-list')).toHaveCount(0)

  // Someone shares again: submittable once more.
  await rohan.getByRole('checkbox', { name: 'Mira' }).check()
  await expect(rohan.getByTestId('split-summary')).toHaveText('Rohan paid ₹300 · ₹150 each')
  await expect(rohan.getByRole('button', { name: 'Add expense' })).toBeEnabled()

  // An empty split is blocked too.
  await rohan.getByRole('checkbox', { name: 'Rohan' }).uncheck()
  await rohan.getByRole('checkbox', { name: 'Mira' }).uncheck()
  await expect(rohan.getByTestId('split-explanation')).toContainText('Nobody is in the split.')
  await expect(rohan.getByRole('button', { name: 'Add expense' })).toBeDisabled()
  await expect(rohan.getByTestId('entry-list')).toHaveCount(0)

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

  // Each fronts the other's cost once, so the pair's balance nets to zero.
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

test('the book shows Entries newest first', async ({ browser }) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await addExpense(rohan, { amount: '100' })
  await rohan.waitForTimeout(20)
  await addExpense(rohan, { amount: '250' })

  const entries = await rohan
    .getByTestId('entry-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''))

  expect(entries).toHaveLength(2)
  expect(entries[0]).toContain('₹250')
  expect(entries[1]).toContain('₹100')

  await rohanContext.close()
  await miraContext.close()
})

test('an amount that is not rupees is refused with an explanation', async ({ browser }) => {
  const rohanContext = await browser.newContext()
  const rohan = await rohanContext.newPage()
  const invite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  const miraContext = await browser.newContext()
  const mira = await miraContext.newPage()
  await joinGroup(mira, invite, 'Mira')
  await expect.poll(() => memberNames(rohan)).toEqual(['Rohan', 'Mira'])

  await rohan.getByLabel('Amount (₹)').fill('12.345')
  await rohan.getByRole('button', { name: 'Add expense' }).click()

  await expect(rohan.getByRole('alert')).toContainText('Enter an amount in rupees')
  await expect(rohan.getByTestId('entry-list')).toHaveCount(0)

  await rohanContext.close()
  await miraContext.close()
})
