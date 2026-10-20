// Attribute editors against the real API, through the record table (BACKLOG 2.03; contract): every commit is an
// optimistic `values.set` write (values.put / retire / reorder with client value ids) that survives a reload.
// Data: the seeded "Projects" object (apps/api src/seed/demo.ts), view "All Projects".
import { expect, type Page, type Response, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { signIn } from './support.ts';
import { trpc } from './views-support.ts';

const PROJECTS = `/${WORKSPACE_SLUG}/custom/projects`;

const isCall = (name: string) => (r: Response) =>
  new URL(r.url()).pathname.startsWith('/trpc/') && new URL(r.url()).pathname.split(/[/,]/).includes(name);

const header = (page: Page, title: string) => page.locator('[role="columnheader"]', { hasText: title }).first();

async function columnIndex(page: Page, title: string): Promise<number> {
  return Number(await header(page, title).getAttribute('aria-colindex'));
}

const recordIds = new Map<string, string>();

/** The cell of the project with this code in the column titled `title` (rows found by record id, so they stay
 * addressable when the Code column scrolls out of the horizontally virtualised range). */
async function cellOf(page: Page, code: string, title: string) {
  let id = recordIds.get(code);
  if (!id) {
    const byCode = page.locator('[role="row"]', { has: page.locator('[role="gridcell"]', { hasText: code }) }).first();
    await expect(byCode).toBeVisible();
    id = (await byCode.getAttribute('data-record-id')) ?? '';
    recordIds.set(code, id);
  }
  const row = page.locator(`[role="row"][data-record-id="${id}"]`);
  await expect(row).toBeVisible();
  return row.locator(`[role="gridcell"][aria-colindex="${await columnIndex(page, title)}"]`);
}

/** Tags is the last column: bring it into the horizontally virtualised range. */
async function scrollToEnd(page: Page) {
  await page.getByRole('grid').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
}

test.describe.configure({ mode: 'serial' });

/** Put SEED-003 back as seeded (Review, Mobile, 5 stars, €18,000): later specs filter on these values. */
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await signIn(page, PROJECTS);
  const id = recordIds.get('SEED-003');
  if (id) {
    const attrs = await trpc<{ id: string; apiSlug: string }[]>(page, 'schema.attributes.list', {
      entityDefinitionId: 'projects',
    });
    const attr = (slug: string) => attrs.find((a) => a.apiSlug === slug)?.id as string;
    const stages = await trpc<{ id: string; title: string }[]>(page, 'schema.statuses.list', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: attr('phase'),
    });
    const options = await trpc<{ id: string; title: string }[]>(page, 'schema.options.list', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: attr('tags'),
    });
    await trpc(page, 'records.patch', {
      entityDefinitionId: 'projects',
      entityInstanceId: id,
      values: {
        phase: [{ value: { pipelineStageId: stages.find((s) => s.title === 'Review')?.id } }],
        tags: [{ value: { selectOptionId: options.find((o) => o.title === 'Mobile')?.id } }],
        health: [{ value: 5 }],
        budget: [{ value: { currencyValue: 18000 } }],
      },
    });
  }
  await page.close();
});

test('multi-select: each toggle is written at once and the picker stays open', async ({ page }) => {
  await signIn(page, PROJECTS);
  await cellOf(page, 'SEED-003', 'Code');
  await scrollToEnd(page);
  const tags = await cellOf(page, 'SEED-003', 'Tags');
  await expect(tags).toHaveText('Mobile');
  await tags.click();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('listbox', { name: 'Tags' });
  await expect(picker).toBeVisible();
  // Selected options first, then the rest.
  await expect(picker.getByRole('option').first()).toHaveText('Mobile');
  // Writes each click immediately: the table runs the editor with liveCommit.
  const write = page.waitForResponse(isCall('values.put'));
  await picker.getByRole('option', { name: 'CRM' }).click();
  expect((await write).ok()).toBe(true);
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option', { name: 'CRM' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(tags).toContainText('Mobile');
  await expect(tags).toContainText('CRM');
  await page.reload();
  await cellOf(page, 'SEED-003', 'Code');
  await scrollToEnd(page);
  await expect(await cellOf(page, 'SEED-003', 'Tags')).toContainText('CRM');
});

test('status: search and pick a stage', async ({ page }) => {
  await signIn(page, PROJECTS);
  const phase = await cellOf(page, 'SEED-003', 'Phase');
  await expect(phase).toHaveText('Review');
  await phase.click();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Phase' })).toBeVisible();
  await page.keyboard.type('don');
  const write = page.waitForResponse(isCall('values.put'));
  await page.keyboard.press('Enter');
  await expect(phase).toHaveText('Done');
  expect((await write).ok()).toBe(true);
  await page.reload();
  await expect(await cellOf(page, 'SEED-003', 'Phase')).toHaveText('Done');
});

test('rating keys and currency typing append to the amount', async ({ page }) => {
  await signIn(page, PROJECTS);
  const health = await cellOf(page, 'SEED-003', 'Health');
  // Beside the stars: a click on a star sets that rating in place.
  const box = (await health.boundingBox()) as { width: number; height: number };
  await health.click({ position: { x: box.width - 8, y: box.height / 2 } });
  await page.keyboard.type('2');
  await expect(health.locator('[data-filled]')).toHaveCount(2);

  const budget = await cellOf(page, 'SEED-003', 'Budget');
  await budget.click();
  await page.keyboard.type('5');
  const input = page.getByRole('textbox', { name: 'Budget' });
  await expect(input).toHaveValue('180005');
  await page.keyboard.press('Enter');
  // EUR, no decimals (seed configuration), en-US browser locale: one formatter for cells and footers (X-11).
  await expect(budget).toHaveText('€180,005');

  await page.reload();
  await expect((await cellOf(page, 'SEED-003', 'Health')).locator('[data-filled]')).toHaveCount(2);
  await expect(await cellOf(page, 'SEED-003', 'Budget')).toHaveText('€180,005');
});
