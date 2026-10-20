// Views behaviour (BACKLOG 2.04–2.07, acceptance 3) on the dev route: drafts survive in-app navigation but not
// "Discard changes", "Save for everyone" replaces the whole filter and sort arrays, "Save as new view" leaves the
// source as saved, column edits save immediately, view CRUD from the switcher, relationship drill-down columns.
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { createSeedView, DEV_PATH, openDevView, signInTo, tableRows, trpc } from './views-support.ts';

interface ViewShape {
  id: string;
  title: string;
  filter: unknown;
  sorts: { path: { attributeDefinitionId: string }[]; field?: string; direction: string }[];
  columns: { id: string; title: string | null; path: { attributeDefinitionId: string }[]; sortOrder: string }[];
}

const getView = (page: Page, viewId: string) => trpc<ViewShape>(page, 'views.get', { viewId });

async function setup(page: Page, title: string) {
  await signInTo(page, `${DEV_PATH}?object=projects`);
  const seed = await createSeedView(page, title);
  await openDevView(page, seed.id);
  return seed;
}

async function sortBy(page: Page, attribute: string) {
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('combobox').fill(attribute);
  await page.getByRole('option', { name: attribute, exact: true }).click();
}

async function filterBy(page: Page, attribute: string, operator: string) {
  await page
    .getByTestId('filter-bar')
    .getByRole('button', { name: /^(Filter|Add filter)$/ })
    .click();
  await page.getByRole('combobox').fill(attribute);
  await page.getByRole('option', { name: attribute, exact: true }).first().click();
  await page.getByRole('menuitem', { name: operator, exact: true }).click();
}

/** Code is the seed view's first column. */
const firstCode = (page: Page) => page.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="2"]');

test('filter and sort drafts survive in-app navigation, not "Discard changes"', async ({ page }) => {
  const seed = await setup(page, '[e2e] drafts');
  const saveBar = page.getByTestId('save-view-bar');
  await expect(saveBar).toHaveCount(0);

  await sortBy(page, 'Budget');
  await expect(page.getByTestId('sort-pill')).toContainText('Sorted by');
  await expect(page.getByTestId('sort-pill')).toContainText('Budget');
  await expect(saveBar).toBeVisible();
  // Ascending budget puts the cheapest project first (SEED-005, 9 000).
  await expect(firstCode(page)).toHaveText('SEED-005');

  await filterBy(page, 'Budget', 'greater than');
  await page.getByLabel('Number').fill('50000');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('filter-pill')).toContainText('greater than');
  await expect(tableRows(page)).toHaveCount(5);

  // In-app navigation away and back: the drafts are still applied.
  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home`));
  await page.goBack();
  await expect(page.getByTestId('sort-pill')).toContainText('Budget');
  await expect(page.getByTestId('filter-pill')).toContainText('50,000');
  await expect(tableRows(page)).toHaveCount(5);
  await expect(saveBar).toBeVisible();

  // Nothing was saved.
  const saved = await getView(page, seed.id);
  expect(saved.filter).toBeNull();
  expect(saved.sorts).toEqual([]);

  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(saveBar).toHaveCount(0);
  await expect(page.getByTestId('sort-pill')).toHaveCount(0);
  await expect(page.getByTestId('filter-pill')).toHaveCount(0);
  await expect(tableRows(page)).toHaveCount(12);
});

test('"Save for everyone" replaces the whole filter and sort arrays', async ({ page }) => {
  const seed = await setup(page, '[e2e] full replace');
  await sortBy(page, 'Budget');
  await filterBy(page, 'Budget', 'greater than');
  await page.getByLabel('Number').fill('50000');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Save for everyone' }).click();
  await expect(page.getByTestId('save-view-bar')).toHaveCount(0);

  await expect
    .poll(async () => {
      const v = await getView(page, seed.id);
      return { sorts: v.sorts.length, hasFilter: v.filter !== null };
    })
    .toEqual({ sorts: 1, hasFilter: true });
  const saved = await getView(page, seed.id);
  expect(saved.sorts[0]).toMatchObject({ field: 'raw_value', direction: 'asc' });
  expect(saved.filter).toMatchObject({
    and: [{ mode: 'must', constraints: [{ field: 'raw_value', operator: 'gt', value: 50000 }] }],
  });

  // A reload shows the saved state without a draft.
  await page.reload();
  await expect(page.getByTestId('sort-pill')).toContainText('Budget');
  await expect(tableRows(page)).toHaveCount(5);
  await expect(page.getByTestId('save-view-bar')).toHaveCount(0);

  // Removing everything and saving leaves an empty filter and no sorts (full replace).
  await page.getByTestId('filter-pill').getByRole('button', { name: 'Filter options' }).click();
  await page.getByRole('menuitem', { name: 'Delete filter' }).click();
  await page.getByTestId('sort-pill').getByRole('button').click();
  await page.getByRole('button', { name: 'Remove sort' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save for everyone' }).click();
  await expect.poll(async () => (await getView(page, seed.id)).sorts.length).toBe(0);
  expect((await getView(page, seed.id)).filter).toBeNull();
});

test('"Save as new view" duplicates with the drafts and leaves the source as saved', async ({ page }) => {
  const seed = await setup(page, '[e2e] save as');
  await sortBy(page, 'Headcount');
  await page.getByRole('button', { name: 'More save options' }).click();
  await page.getByRole('menuitem', { name: 'Save as new view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as new view' });
  await expect(dialog.getByLabel('Title')).toHaveValue('[e2e] save as (2)');
  await dialog.getByRole('button', { name: /^Create view/ }).click();

  await expect(page).not.toHaveURL(new RegExp(seed.id));
  await expect(page.getByTestId('view-switcher')).toContainText('[e2e] save as (2)');
  await expect(page.getByTestId('sort-pill')).toContainText('Headcount');
  await expect(page.getByTestId('save-view-bar')).toHaveCount(0);

  const source = await getView(page, seed.id);
  expect(source.sorts).toEqual([]);
  const copyId = /\/view\/([0-9a-f-]{36})/.exec(page.url())?.[1] as string;
  const copy = await getView(page, copyId);
  expect(copy.sorts).toHaveLength(1);
  expect(copy.columns).toHaveLength(source.columns.length);
});

test('column edits save immediately: add (with relationship drill-down), label, move, hide', async ({ page }) => {
  const seed = await setup(page, '[e2e] columns');
  const before = await getView(page, seed.id);

  // Add "Client › Name": a two-hop path column.
  await page.getByRole('button', { name: 'Add column' }).click();
  await page.getByRole('combobox').fill('');
  await page.getByRole('option', { name: /^Client/ }).click();
  await expect(page.getByPlaceholder('Search company attributes...')).toBeVisible();
  await page.getByRole('option', { name: 'Name', exact: true }).click();
  await expect(page.getByTestId('column-header').filter({ hasText: 'Client › Name' })).toBeVisible();
  await expect.poll(async () => (await getView(page, seed.id)).columns.length).toBe(before.columns.length + 1);
  const added = (await getView(page, seed.id)).columns.find((c) => c.path.length === 2);
  expect(added).toBeTruthy();
  // "+ Add column" sits after the last column: back to the first columns (horizontally virtualised grid).
  await page.getByRole('grid').evaluate((el) => {
    el.scrollLeft = 0;
  });

  // Edit column label.
  await page
    .getByTestId('column-header')
    .filter({ hasText: /^Summary$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Edit column label' }).click();
  await page.getByRole('dialog').getByLabel('Column label').fill('Pitch');
  await page.getByRole('button', { name: /^Save label/ }).click();
  await expect(page.getByTestId('column-header').filter({ hasText: /^Pitch$/ })).toBeVisible();
  await expect.poll(async () => (await getView(page, seed.id)).columns.some((c) => c.title === 'Pitch')).toBe(true);

  // Move right: Code moves after Pitch.
  await page
    .getByTestId('column-header')
    .filter({ hasText: /^Code$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Move right' }).click();
  await expect(page.getByRole('menu', { name: 'Column options' })).toHaveCount(0);
  await expect(page.getByTestId('column-header').nth(0)).toHaveText('Pitch');
  await expect(page.getByTestId('column-header').nth(1)).toHaveText('Code');

  // Hide from view.
  await page
    .getByTestId('column-header')
    .filter({ hasText: /^Headcount$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Hide from view' }).click();
  await expect(page.getByTestId('column-header').filter({ hasText: /^Headcount$/ })).toHaveCount(0);
  await expect.poll(async () => (await getView(page, seed.id)).columns.length).toBe(before.columns.length);
  // Column edits never show the unsaved-changes bar.
  await expect(page.getByTestId('save-view-bar')).toHaveCount(0);
});

test('view switcher: v, create, rename, duplicate, delete', async ({ page }) => {
  await setup(page, '[e2e] switcher');
  await page.locator('body').click({ position: { x: 900, y: 800 } });
  await page.keyboard.press('v');
  await expect(page.getByPlaceholder('Search views...')).toBeFocused();
  await page.getByText('Create new view').click();
  const create = page.getByRole('dialog', { name: 'Create view' });
  await create.getByRole('button', { name: /^Confirm/ }).click();
  await expect(create.getByText('Please provide a title for this view.')).toBeVisible();
  await create.getByLabel('Title').fill('[e2e] created');
  await page.keyboard.press('Meta+Enter');
  await expect(page.getByTestId('view-switcher')).toContainText('[e2e] created');
  await expect(page.getByText('Add your first attribute column')).toBeVisible();

  // Rename
  await page.getByTestId('view-switcher').click();
  let row = page.getByRole('option', { name: '[e2e] created' });
  await row.hover();
  await row.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Edit [e2e] created' });
  await rename.getByLabel('Title').fill('[e2e] renamed');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('view-switcher')).toContainText('[e2e] renamed');

  // Duplicate (navigates to the copy, toast)
  await page.getByTestId('view-switcher').click();
  row = page.getByRole('option', { name: '[e2e] renamed' });
  await row.hover();
  await row.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('View successfully duplicated')).toBeVisible();
  await expect(page.getByTestId('view-switcher')).toContainText('[e2e] renamed (2)');

  // Delete the copy (confirm) → back on another view
  await page.getByTestId('view-switcher').click();
  row = page.getByRole('option', { name: '[e2e] renamed (2)' });
  await row.hover();
  await row.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete view' }).click();
  await expect(page.getByText('[e2e] renamed (2) was deleted successfully')).toBeVisible();
  await expect(page.getByTestId('view-switcher')).not.toContainText('(2)');
});

test('advanced filter: convert a pill, OR group, relative date', async ({ page }) => {
  await setup(page, '[e2e] advanced');
  await filterBy(page, 'Phase', 'is');
  await page.getByRole('option', { name: 'Build' }).click();
  await filterBy(page, 'Strategic', 'is true');
  await page.getByTestId('filter-pill').first().getByRole('button', { name: 'Filter options' }).click();
  await page.getByRole('menuitem', { name: 'Convert to advanced filter' }).click();
  const editor = page.getByTestId('advanced-filter-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('advanced-filter-pill')).toContainText('1');

  await editor.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('combobox').fill('Start date');
  await page.getByRole('option', { name: 'Start date', exact: true }).click();
  // First operator pre-selected ("is"); switch to "before" → relative menu.
  await page.keyboard.press('Escape');
  await editor.getByRole('button', { name: /^is$/ }).last().click();
  await page.getByRole('menuitem', { name: 'before', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'One month from now' }).click();
  await editor.getByRole('button', { name: /^And$/ }).click();
  await expect(editor.getByRole('button', { name: /^Or$/ })).toBeVisible();
  await expect(page.getByTestId('advanced-filter-pill')).toContainText('2');
  await expect(page.getByTestId('save-view-bar')).toBeVisible();
});

test('header menu extras: Filter opens the operator menu, Insert left adds the column there', async ({ page }) => {
  const seed = await setup(page, '[e2e] header extras');
  await page.goto(`${DEV_PATH}?object=projects&view=${seed.id}&extras=1`);
  await page
    .getByTestId('column-header')
    .filter({ hasText: /^Budget$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'greater than' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'not empty', exact: true }).click();
  await expect(page.getByTestId('filter-pill')).toContainText('not empty');

  await page
    .getByTestId('column-header')
    .filter({ hasText: /^Budget$/ })
    .click();
  await page.getByRole('menuitem', { name: 'Insert left' }).click();
  await page.getByRole('combobox').fill('Website');
  await page.getByRole('option', { name: 'Website', exact: true }).click();
  const headers = page.getByTestId('column-header');
  await expect(headers.nth(2)).toHaveText('Website');
  await expect(headers.nth(3)).toHaveText('Budget');
  await expect.poll(async () => (await getView(page, seed.id)).columns.length).toBe(17);
});
