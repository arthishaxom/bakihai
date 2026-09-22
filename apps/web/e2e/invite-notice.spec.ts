import { type BrowserContextOptions, expect, test } from '@playwright/test'
import { createGroup, invitePayload } from './helpers'

// The notice lands on the Book screen, so these run at a phone viewport.
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
}

test.use(PHONE)

test('another Group’s invite shows a dismissible notice naming both Groups', async ({
  browser,
}) => {
  const rohanContext = await browser.newContext(PHONE)
  const rohan = await rohanContext.newPage()
  const ownInvite = await createGroup(rohan, 'Flat 3B', 'Rohan')

  // An invite for a different Group, made on another phone.
  const miraContext = await browser.newContext(PHONE)
  const mira = await miraContext.newPage()
  const otherInvite = await createGroup(mira, 'Beach House', 'Mira')

  await rohan.goto(otherInvite)

  // The invite explains itself and names both Groups, while the book stays the
  // one this phone already had.
  const notice = rohan.getByTestId('invite-notice')

  await expect(notice).toBeVisible()
  await expect(notice).toContainText('Beach House')
  await expect(notice).toContainText('Flat 3B')
  await expect(rohan.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(rohan.getByTestId('member-list')).toContainText('Rohan')

  // Dismissing it leaves the book and this device's identity untouched.
  await rohan.getByRole('button', { name: 'Dismiss' }).click()
  await expect(notice).toHaveCount(0)

  const ownInviteAfter = await rohan.getByLabel('Invite link').inputValue()

  expect(invitePayload(ownInviteAfter)).toEqual(invitePayload(ownInvite))
  await expect(rohan.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(rohan.getByTestId('member-list')).toContainText('Rohan')

  await rohanContext.close()
  await miraContext.close()
})

test('your own Group’s invite shows no notice', async ({ page }) => {
  const invite = await createGroup(page, 'Flat 3B', 'Rohan')

  await page.goto(invite)

  // This is the book, not the join screen.
  await expect(page.getByLabel('Invite link')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(page.getByTestId('invite-notice')).toHaveCount(0)
})

test('the create-Group screen on an onboarded phone lands home without a notice', async ({
  page,
}) => {
  await createGroup(page, 'Flat 3B', 'Rohan')

  await page.goto('/welcome')

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByLabel('Invite link')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(page.getByTestId('invite-notice')).toHaveCount(0)
})
