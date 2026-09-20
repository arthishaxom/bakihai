import { expect, type Page, test } from '@playwright/test'

const HARNESS_PATH = '/e2e/harness/harness.html'

async function createGroup(page: Page, groupName: string, displayName: string): Promise<string> {
  await page.goto('/')
  await expect(page).toHaveURL(/\/welcome$/)
  await page.getByLabel('Group name').fill(groupName)
  await page.getByLabel('Your name').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected')

  return page.getByLabel('Invite link').inputValue()
}

async function joinGroup(page: Page, inviteUrl: string, displayName: string): Promise<void> {
  await page.goto(inviteUrl)
  await page.getByLabel('Your name').fill(displayName)
  await page.getByRole('button', { name: 'Join group' }).click()
  await expect(page.getByLabel('Invite link')).toBeVisible()
}

function memberNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('member-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-member-name') ?? ''))
}

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
  const invitePayload = JSON.parse(
    Buffer.from(new URL(invite).hash.replace('#invite=', ''), 'base64url').toString('utf8'),
  ) as { room: string; key: string; relay: string }
  const seed = await creatorContext.newPage()
  await seed.goto(
    `${HARNESS_PATH}?room=${invitePayload.room}&key=${invitePayload.key}&relay=${invitePayload.relay}`,
  )
  await seed.waitForFunction(() => document.documentElement.dataset.ready === 'true')
  await expect(seed.getByTestId('sync-status')).toHaveAttribute('data-status', 'connected')
  const entryId = await seed.evaluate(() =>
    window.harness.addEntry({ note: 'dinner before you joined', amountPaise: 90_000 }),
  )
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
