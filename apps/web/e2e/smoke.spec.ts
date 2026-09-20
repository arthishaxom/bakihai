import { expect, test } from '@playwright/test'

test('sends a first run to the create-Group screen', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/welcome$/)
  await expect(page).toHaveTitle('BakiHai')
  await expect(page.getByRole('heading', { name: 'BakiHai' })).toBeVisible()
  await expect(page.getByText('A shared book for who owes what.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create group' })).toBeDisabled()
})
