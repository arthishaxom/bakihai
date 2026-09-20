import { expect, test } from '@playwright/test'
import { createGroup, invitePayload, joinGroup, memberNames } from './helpers'

const HARNESS_PATH = '/e2e/harness/harness.html'

test('the creator lands on an empty book with an invite action', async ({ page }) => {
  const invite = await createGroup(page, 'Flat 3B', 'Rohan')

  await expect(page.getByText('No entries yet.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  await expect(page.getByTestId('member-list')).toContainText('Rohan')
  expect(invite).toContain('/join#invite=')
})

test('a second device joins from the invite link and both see the same Members', async ({
  browser,
}) => {
  const creatorContext = await browser.newContext()
  const creator = await creatorContext.newPage()
  const invite = await createGroup(creator, 'Flat 3B', 'Rohan')

  const friendContext = await browser.newContext()
  const friend = await friendContext.newPage()
  await friend.goto(invite)
  await expect(friend.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await friend.getByLabel('Your name').fill('Mira')
  await friend.getByRole('button', { name: 'Join group' }).click()

  // The invite fragment is dropped from the URL once joined.
  await expect(friend).toHaveURL(new URL('/', invite).toString())
  await expect(friend.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()

  await expect.poll(() => memberNames(friend)).toEqual(['Rohan', 'Mira'])
  await expect.poll(() => memberNames(creator)).toEqual(['Rohan', 'Mira'])

  await creatorContext.close()
  await friendContext.close()
})

test('a joiner rebuilds Entries made before it joined', async ({ browser }) => {
  const creatorContext = await browser.newContext()
  const creator = await creatorContext.newPage()
  const invite = await createGroup(creator, 'Flat 3B', 'Rohan')

  // The creator's phone writes an Entry through the sync harness before the
  // second device has ever opened the link.
  const inviteGroup = invitePayload(invite)
  const seed = await creatorContext.newPage()
  await seed.goto(
    `${HARNESS_PATH}?room=${inviteGroup.room}&key=${inviteGroup.key}&relay=${inviteGroup.relay}`,
  )
  await seed.waitForFunction(() => document.documentElement.dataset.ready === 'true')
  await expect(seed.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected')
  const entryId = await seed.evaluate(async () => {
    // The harness announces itself as a Member first, so the app admits its
    // Entries: an Entry from a device that never joined is ignored (#8).
    await window.harness.joinAs('Seed')

    return window.harness.addEntry({ note: 'dinner before you joined', amountPaise: 90_000 })
  })
  await expect(seed.locator(`[data-entry-id="${entryId}"]`)).toBeVisible()

  const friendContext = await browser.newContext()
  const friend = await friendContext.newPage()
  await joinGroup(friend, invite, 'Mira')

  await expect(friend.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(friend.locator(`[data-entry-id="${entryId}"]`)).toBeVisible()
  await expect(friend.getByTestId('member-list')).toContainText('Rohan')

  await creatorContext.close()
  await friendContext.close()
})

test('a reload keeps the Group and its Members', async ({ page }) => {
  await createGroup(page, 'Flat 3B', 'Rohan')

  await page.reload()

  await expect(page.getByRole('heading', { name: 'Flat 3B' })).toBeVisible()
  await expect(page.getByTestId('member-list')).toContainText('Rohan')
  await expect(page).not.toHaveURL(/\/welcome$/)
})

test('an invalid invite link explains itself', async ({ page }) => {
  await page.goto('/join#invite=not-a-real-invite')

  await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible()
  await expect(page.getByText(/not valid/i)).toBeVisible()
})
