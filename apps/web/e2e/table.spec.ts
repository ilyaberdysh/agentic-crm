// Record table. Objects are seeded before the tests
// (seed-big.ts, idempotent): `big_records` (1,933 rows → two snapshot chunks) and `bulk_records` (30 rows for
// deletes). Seeded here rather than in prepare.ts so earlier specs see the stock sidebar.
import { expect, type Page, type Response, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { seedTableObjects } from './seed-table.ts';
import { signIn } from './support.ts';

const BIG = `/${WORKSPACE_SLUG}/custom/big_records`;
const BULK = `/${WORKSPACE_SLUG}/custom/bulk_records`;

/** The result of procedure `name` in a (possibly batched) tRPC response. */
async function trpcResult<T>(response: Response, name: string): Promise<T> {
  const path = new URL(response.url()).pathname.replace(/^\/trpc\//, '');
  const names = path.split(',');
  const body = (await response.json()) as unknown;
  const entries = Array.isArray(body) ? body : [body];
  const entry = entries[names.indexOf(name)] as { result: { data: T } };
  return entry.result.data;
}

const isCall = (name: string) => (r: Response) =>
  new URL(r.url()).pathname.startsWith('/trpc/') && new URL(r.url()).pathname.split(/[/,]/).includes(name);

const grid = (page: Page) => page.getByRole('grid');
const row = (page: Page, index: number) => page.locator(`[role="row"][aria-rowindex="${index + 2}"]`);
const cell = (page: Page, index: number, col: number) =>
  row(page, index).locator(`[role="gridcell"][aria-colindex="${col + 2}"]`);
const header = (page: Page, title: string) => page.locator('[role="columnheader"]', { hasText: title }).first();

async function columnIndex(page: Page, title: string): Promise<number> {
  return Number(await header(page, title).getAttribute('aria-colindex')) - 2;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => seedTableObjects());

test('a 1,933-row object loads 1,000 ids, then the second chunk on scroll, and shows the total', async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  const first = page.waitForResponse(isCall('snapshots.query'));
  await page.goto(BIG);
  const snapshot = await trpcResult<{ total: number; ids: string[]; snapshotId: string }>(
    await first,
    'snapshots.query',
  );
  expect(snapshot.total).toBe(1933);
  expect(snapshot.ids).toHaveLength(1000);
  await expect(page).toHaveURL(/\/custom\/big_records\/view\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('footer-count')).toHaveText('1,933count');
  await expect(row(page, 0)).toHaveAttribute('data-record-id', snapshot.ids[0] as string);

  const chunk = page.waitForResponse(isCall('snapshots.chunk'));
  await grid(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const second = await trpcResult<{ start: number; ids: string[] }>(await chunk, 'snapshots.chunk');
  expect(second.start).toBe(1000);
  expect(second.ids).toHaveLength(933);
  await expect(row(page, 1932)).toHaveAttribute('data-record-id', second.ids[932] as string);
  // Cells of the last rows hydrate (no skeletons left in the visible rows).
  await expect(row(page, 1932).locator('[data-loading]')).toHaveCount(0);
});

test('edits a cell with the keyboard; the value persists', async ({ page }) => {
  await signIn(page, BIG);
  const code = await columnIndex(page, 'Code');
  await cell(page, 0, code).click();
  await expect(page.getByTestId('active-cell')).toBeVisible();
  await page.keyboard.type('E2E-');
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible();
  await page.keyboard.type('CODE');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, code)).toHaveText('E2E-CODE');
  // Enter moved the active cell down.
  await expect(row(page, 1).getByTestId('active-cell')).toBeVisible();
  await page.reload();
  await expect(cell(page, 0, code)).toHaveText('E2E-CODE');

  // Arrows + Escape-cancel leave the value; mod+C copies the active cell.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await cell(page, 0, code).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('nope');
  await page.keyboard.press('Escape');
  await expect(cell(page, 0, code)).toHaveText('E2E-CODE');
  await page.keyboard.press('ControlOrMeta+c');
  await expect(page.getByText('1 cell copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('E2E-CODE');
});

test('footer calculation: sum over the snapshot, formatted like the cells', async ({ page }) => {
  await signIn(page, BIG);
  const footer = page.getByTestId('table-footer');
  await footer.getByRole('button', { name: 'Add calculation for Amount' }).click();
  await expect(page.getByRole('group', { name: 'Aggregations' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Sum' }).click();
  // amounts seeded as ((i * 37) % 1000) * 100 EUR for i < 1933.
  let sum = 0;
  for (let i = 0; i < 1933; i++) sum += ((i * 37) % 1000) * 100;
  const expected = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(sum);
  await expect(footer.getByRole('button', { name: 'Calculation for Amount' })).toHaveText(`${expected}sum`);
  // Cells use the same locale formatting (X-11).
  const amount = await columnIndex(page, 'Amount');
  await expect(cell(page, 0, amount)).toHaveText(/^€[\d,]+\.\d\d$/);
  // Remove it again ("None").
  await footer.getByRole('button', { name: 'Calculation for Amount' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await expect(footer.getByRole('button', { name: 'Add calculation for Amount' })).toBeVisible();
});

test('one locale for cells and footers (ru-RU browser, X-11)', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1512, height: 945 } });
  const page = await context.newPage();
  await signIn(page, BIG);
  const footer = page.getByTestId('table-footer');
  await footer.getByRole('button', { name: 'Add calculation for Amount' }).click();
  await page.getByRole('menuitemradio', { name: 'Sum' }).click();
  let sum = 0;
  for (let i = 0; i < 1933; i++) sum += ((i * 37) % 1000) * 100;
  const eur = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' });
  const norm = (s: string) => s.replace(/\s/g, ' ');
  await expect(footer.getByRole('button', { name: 'Calculation for Amount' })).toHaveText(
    norm(`${eur.format(sum)}sum`),
  );
  const amount = await columnIndex(page, 'Amount');
  // e.g. "86 200,00 €": the same grouping, decimal comma and symbol position as the footer.
  await expect(cell(page, 0, amount)).toHaveText(/^\d{1,3}(\s\d{3})*,\d\d\s€$/, { useInnerText: true });
  await footer.getByRole('button', { name: 'Calculation for Amount' }).click();
  await page.getByRole('menuitemradio', { name: 'None' }).click();
  await context.close();
});

test('select all, view change shows the frozen banner, bulk delete removes exactly the snapshot ids', async ({
  page,
}) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  const first = page.waitForResponse(isCall('snapshots.query'));
  await page.goto(BULK);
  const snapshot = await trpcResult<{ total: number; ids: string[] }>(await first, 'snapshots.query');
  expect(snapshot.total).toBe(30);

  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  const bar = page.getByTestId('bulk-bar');
  await expect(bar).toContainText('30');
  await expect(page.getByRole('checkbox', { name: 'Select all rows' })).toHaveAttribute('aria-checked', 'true');

  // Change the view (sort draft from the column header menu): the shown snapshot stays frozen.
  const reSorted = page.waitForResponse(isCall('snapshots.query'));
  await header(page, 'Code').click();
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await reSorted;
  await expect(page.getByTestId('frozen-banner')).toHaveText(/View has changed\. Clear selection to update\./);
  await expect(row(page, 0)).toHaveAttribute('data-record-id', snapshot.ids[0] as string);

  // Keep the first row: 29 selected; delete them.
  await row(page, 0)
    .getByRole('checkbox', { name: /^(Select|Deselect) row$/ })
    .click();
  await expect(bar).toContainText('29');
  const deleted = page.waitForResponse(isCall('records.deleteSelection'));
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete records' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete 29 bulk records');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  // One server-side bulk delete over the frozen snapshot: exactly the 29 selected ids.
  const result = await trpcResult<{ deletedIds: string[] }>(await deleted, 'records.deleteSelection');
  expect(result.deletedIds).toEqual(snapshot.ids.slice(1));
  await expect(page.getByText('Successfully deleted 29 bulk records')).toBeVisible({ timeout: 15_000 });

  // The table moves to the newest snapshot: only the kept record remains.
  await expect(page.getByTestId('bulk-bar')).toHaveCount(0);
  await expect(page.getByTestId('footer-count')).toHaveText('1count');
  await expect(row(page, 0)).toHaveAttribute('data-record-id', snapshot.ids[0] as string);
});

test('two tabs: B sees A’s focused cell and live draft, then the committed value', async ({ context }) => {
  const a = await context.newPage();
  await signIn(a, BIG);
  await expect(row(a, 0)).toHaveAttribute('data-record-id', /.+/);
  const b = await context.newPage();
  await b.goto(a.url());
  await expect(row(b, 0)).toHaveAttribute('data-record-id', /.+/);
  await expect(b.getByTestId('view-presence')).toBeVisible();
  await b.waitForTimeout(500);

  const notes = await columnIndex(a, 'Notes');
  await grid(a).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await grid(b).evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await cell(a, 2, notes).click();
  const peer = cell(b, 2, notes).locator('xpath=..').getByTestId('peer-cell');
  await expect(peer).toBeVisible();
  await expect(peer).toContainText('Ada Tester');

  await a.keyboard.type('Live draft');
  await expect(b.getByTestId('peer-draft')).toHaveText('Live draft');
  await a.keyboard.press('Enter');
  await expect(b.getByTestId('peer-draft')).toHaveCount(0);
  await expect(cell(b, 2, notes)).toHaveText('Live draft');
});
