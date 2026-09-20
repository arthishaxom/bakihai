import { expect, type Page } from '@playwright/test'

/** Creates a Group on this device and returns its invite link. */
export async function createGroup(
  page: Page,
  groupName: string,
  displayName: string,
): Promise<string> {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await page.getByLabel('Group name').fill(groupName)
  await page.getByLabel('Your name').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected')

  return page.getByLabel('Invite link').inputValue()
}

/** Opens an invite link on a second device and joins the Group under this name. */
export async function joinGroup(page: Page, inviteUrl: string, displayName: string): Promise<void> {
  await page.goto(inviteUrl)
  await page.getByLabel('Your name').fill(displayName)
  await page.getByRole('button', { name: 'Join group' }).click()
  await expect(page.getByLabel('Invite link')).toBeVisible()
}

/** The display names in a device's folded Member list, in fold order. */
export function memberNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('member-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-member-name') ?? ''))
}
