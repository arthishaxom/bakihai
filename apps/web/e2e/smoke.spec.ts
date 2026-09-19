import { expect, test } from '@playwright/test'

test('serves the app shell', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('BakiHai')
  await expect(page.getByRole('heading', { name: 'BakiHai' })).toBeVisible()
  await expect(page.getByText('A shared book for who owes what.')).toBeVisible()
})
