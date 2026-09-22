import { expect, type Locator, type Page } from '@playwright/test'

/** The decoded contents of an invite link's `#invite=` fragment. */
export interface InvitePayload {
  room: string
  key: string
  relay: string
  name: string
}

/** Decodes an invite link's `#invite=` fragment. */
export function invitePayload(inviteUrl: string): InvitePayload {
  const payload = new URL(inviteUrl).hash.replace('#invite=', '')

  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as InvitePayload
}

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

/** The `data-member-name`s of the rows in a Member list, in list order. */
function memberNamesIn(page: Page, listTestId: string): Promise<string[]> {
  return page
    .getByTestId(listTestId)
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-member-name') ?? ''))
}

/** The row for a display name inside a Member list, on whichever phone is looking. */
function memberRowIn(page: Page, listTestId: string, displayName: string): Locator {
  return page
    .getByTestId(listTestId)
    .locator('li')
    .filter({ has: page.getByText(displayName, { exact: true }) })
}

/** The display names in a device's folded Member list, in fold order. */
export function memberNames(page: Page): Promise<string[]> {
  return memberNamesIn(page, 'member-list')
}

/** The display names in a device's Archived Member list, in fold order. */
export function archivedMemberNames(page: Page): Promise<string[]> {
  return memberNamesIn(page, 'archived-member-list')
}

/** The active Member row for a display name, on whichever phone is looking. */
export function memberRow(page: Page, displayName: string): Locator {
  return memberRowIn(page, 'member-list', displayName)
}

/** The Archived Member row for a display name, on whichever phone is looking. */
export function archivedMemberRow(page: Page, displayName: string): Locator {
  return memberRowIn(page, 'archived-member-list', displayName)
}

/** The text of each Balance row on a device, in fold order. */
export function balanceTexts(page: Page): Promise<string[]> {
  return page
    .getByTestId('balance-list')
    .locator('li')
    .evaluateAll((items) =>
      items.map((item) => item.querySelector('[data-balance-text]')?.textContent?.trim() ?? ''),
    )
}

/** Opens the Add bottom sheet and returns it. */
export async function openAddSheet(page: Page): Promise<Locator> {
  await page.getByTestId('add-entry').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()

  return sheet
}

/** Adds a person without the app from the Members list and waits for their row. */
export async function addShadowMember(page: Page, displayName: string): Promise<void> {
  await page.getByTestId('add-shadow-member').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Name').fill(displayName)
  await sheet.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => memberNames(page)).toContain(displayName)
}

/** Opens the Add bottom sheet on its Loan form and returns the sheet. */
export async function openLoanForm(page: Page): Promise<Locator> {
  const sheet = await openAddSheet(page)

  await sheet.getByRole('button', { name: 'Loan', exact: true }).click()

  return sheet
}

/** Opens the Add bottom sheet on its Settlement form and returns the sheet. */
export async function openSettlementForm(page: Page): Promise<Locator> {
  const sheet = await openAddSheet(page)

  await sheet.getByRole('button', { name: 'Settlement', exact: true }).click()

  return sheet
}

/** Opens the Settle up bottom sheet from a Balance row and returns the sheet. */
export async function openSettleUp(page: Page, row?: Locator): Promise<Locator> {
  const balanceRow = row ?? page.getByTestId('balance-list').locator('li').first()

  await balanceRow.getByTestId('settle-up').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()

  return sheet
}

/** The ledger row of a given Entry type. */
export function entryRow(page: Page, type: string): Locator {
  return page.getByTestId('entry-list').locator(`li[data-entry-type="${type}"]`)
}

/** Opens a row's detail bottom sheet. */
export async function openEntrySheet(page: Page, row: Locator): Promise<Locator> {
  await row.getByRole('button').click()

  const sheet = page.getByRole('dialog')

  await expect(sheet).toBeVisible()

  return sheet
}

/** Turns the Entries list's Show hidden toggle to `shown`, so Archived and Voided lines read. */
export async function setShowHidden(page: Page, shown: boolean): Promise<void> {
  const toggle = page.getByTestId('show-hidden')
  const pressed = shown ? 'true' : 'false'

  await expect(toggle).not.toHaveAttribute('aria-pressed', pressed)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', pressed)
}

/** Picks one of the Entries list's filter chips, by its name in the ledger filters. */
export async function filterEntries(page: Page, filter: string): Promise<void> {
  const chip = page.getByTestId('ledger-filters').locator(`button[data-filter="${filter}"]`)

  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
}

/** The Entry types in a device's Entries list, in display order. */
export function entryTypes(page: Page): Promise<string[]> {
  return page
    .getByTestId('entry-list')
    .locator('li')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-entry-type') ?? ''))
}
