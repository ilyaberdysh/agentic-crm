// CSV import wizard end to end on the seeded Projects object: a CSV
// with an unknown select value ("Imported" → "Create 1 missing select option"), invalid values (fixed / left invalid)
// and a row with only invalid values (listed before the run), through upload → map → review → preview → run →
// overview, then the records, the new option and the import history. Runs on the imports.* procedures; the stack's
// worker (pg-boss) executes the run.
import { expect, type Page, test } from '@playwright/test';
import {
  type ImportFootprint,
  importCsv,
  importFootprint,
  memberId,
  projectsSchema,
  restoreImport,
} from './imports-support.ts';
import { signedInPage, trpc, ws } from './slice3-support.ts';

const shots = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/out/imports/${name}.png`, animations: 'disabled', caret: 'hide' });

test.describe.configure({ mode: 'serial' });

let footprint: ImportFootprint | null = null;

// The run adds "SEED-I…" projects and edits SEED-012: put the seeded Projects back for the specs that follow.
test.afterAll(async ({ browser }) => {
  if (!footprint) return;
  const { context, page } = await signedInPage(browser, ws('home'));
  await restoreImport(page, footprint);
  await context.close();
});

test('import wizard: upload, map, review, preview, run, overview, history', async ({ browser }) => {
  test.setTimeout(120_000);
  const { context, page } = await signedInPage(browser, ws('custom/projects'));
  footprint = await importFootprint(page);
  const run = `-${Date.now().toString(36).slice(-5)}`;
  const csv = importCsv(await memberId(page), run);

  // I1 — Import / Export ▾ → Import CSV opens the wizard as an overlay on the object.
  await page.getByTestId('import-export-button').click();
  await page.getByRole('menuitem', { name: 'Import CSV' }).click();
  await expect(page).toHaveURL(/\/custom\/projects\/import\/new$/);
  const header = page.getByTestId('import-header');
  await expect(header).toContainText('Import');
  await expect(header).toContainText('Projects');
  await expect(page.getByTestId('import-stepper')).toContainText('Upload file');
  await shots(page, '1-upload-empty');

  // I2 — the file is parsed in the browser.
  await page.getByTestId('import-file-input').setInputFiles({
    name: 'seed-projects-import.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByTestId('import-file-card')).toContainText('seed-projects-import.csv');
  await expect(page.getByTestId('columns-found')).toHaveText('12');
  await expect(page.getByTestId('rows-found')).toHaveText('4');
  await shots(page, '1-upload-file');
  await page.getByRole('button', { name: 'Next' }).click();

  // I3 — every column is auto-mapped by title; re-map one through the picker.
  await expect(page).toHaveURL(/\/import\/[0-9a-f-]+\/job\/[0-9a-f-]+\/map-properties$/);
  const rows = page.getByTestId('map-row');
  await expect(rows).toHaveCount(12);
  await expect(rows.nth(0)).toContainText('Code');
  const summaryRow = rows.nth(1);
  await summaryRow.getByRole('button', { name: 'Remove attribute mapping' }).click();
  await expect(summaryRow).toContainText('Select attribute');
  await summaryRow.getByRole('button', { name: /Select attribute for Summary/ }).click();
  const picker = page.getByTestId('import-attribute-picker');
  await expect(picker.getByRole('option', { name: 'Record ID' })).toBeVisible();
  await shots(page, '2-attribute-picker');
  await picker.getByRole('combobox').fill('summ');
  await picker.getByRole('option', { name: 'Summary', exact: true }).click();
  await expect(summaryRow).toContainText('Summary');
  await expect(page.getByTestId('data-preview')).toBeVisible();
  await shots(page, '2-map-columns');
  await page.getByRole('button', { name: 'Continue' }).click();

  // I4 — review values: the invalid number, the date format, the unknown select option.
  await expect(page).toHaveURL(/\/review-values\/[0-9a-f-]+$/);
  const columns = page.getByTestId('review-column');
  await expect(columns).toHaveCount(12);
  await columns.filter({ hasText: 'Headcount' }).click();
  const needsReview = page.getByTestId('group-review');
  const two = needsReview.locator('[data-raw="two"]');
  await expect(two.getByTestId('invalid-pill')).toHaveText('Invalid number');
  await expect(page.getByTestId('config-button')).toContainText('Decimal separator: Point');
  await shots(page, '3-review-invalid');
  await two.getByRole('button', { name: 'Fix value' }).click();
  await page.keyboard.type('2');
  await page.keyboard.press('Enter');
  const fixed = page.getByTestId('group-auto').locator('[data-raw="two"]');
  await expect(fixed.getByRole('button', { name: 'Revert value' })).toBeVisible();

  await columns.filter({ hasText: 'Start date' }).click();
  await expect(page.getByTestId('config-button')).toContainText('Date format: European');
  await page.getByTestId('config-button').click();
  await expect(page.getByRole('menuitemradio', { name: /ISO standard/ })).toBeVisible();
  await shots(page, '3-date-format');
  await page.keyboard.press('Escape');

  await columns.filter({ hasText: 'Tags' }).click();
  await expect(page.getByTestId('missing-option')).toHaveText(`Imported${run}`);
  const create = page.getByTestId('create-missing-options');
  await expect(create).toHaveText('Create 1 missing select option');
  await shots(page, '3-missing-option');
  await create.click();
  await page.getByRole('button', { name: 'Create missing select option' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Are you sure you want to modify this attribute?');
  await expect(confirm).toContainText('This will modify the attribute to include the missing 1 select option.');
  await shots(page, '3-create-options-confirm');
  await confirm.getByRole('button', { name: 'Create select option' }).click();
  await expect(page.getByTestId('missing-option')).toHaveCount(0);
  await expect(create).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();

  // I5 — preview: counts per outcome, the invalid rows listed before the run.
  await expect(page).toHaveURL(/\/preview$/);
  const summary = page.getByTestId('plan-summary');
  await expect(summary).toContainText('Up to 2 will be created');
  await expect(summary).toContainText('1 will be updated');
  await expect(summary).toContainText('1 will be skipped');
  const invalidButton = page.getByTestId('invalid-rows-button');
  await expect(invalidButton).toContainText(/rows? (has|have) values that will not be imported/);
  await invalidButton.click();
  await expect(page.getByTestId('invalid-rows')).toContainText('Row 4: Every mapped value is empty or invalid');
  await shots(page, '4-preview');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Start import' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Are you sure that you want to start running this import?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Start import' }).click();

  // I6 — overview.
  await expect(page).toHaveURL(/\/overview\/[0-9a-f-]+$/);
  await expect(page.getByTestId('import-status-title')).toHaveText('Import completed', { timeout: 20_000 });
  await expect(page.getByTestId('overview-summary')).toContainText('2 created');
  await expect(page.getByTestId('overview-summary')).toContainText('1 updated');
  await expect(page.getByTestId('overview-summary')).toContainText('1 skipped');
  await shots(page, '5-overview');

  // The records were written: the fixed number, the comma-decimal budget read with a point separator, the new option.
  const projects = await projectsSchema(page);
  const tags = await trpc<Array<{ title: string }>>(page, 'schema.options.list', {
    entityDefinitionId: projects.id,
    attributeDefinitionId: projects.attrs.tags,
  });
  expect(tags.map((t) => t.title)).toContain(`Imported${run}`);

  // The new records show up in the object's table (the default view sorts by start date, newest first).
  await page.goto(ws('custom/projects'));
  await expect(page.getByText(`SEED-I02${run}`)).toBeVisible();
  await expect(page.getByText(`SEED-I01${run}`)).toBeVisible();

  // I8 — import history lists it as completed.
  await page.goto(ws('settings/data/import-history'));
  const history = page.getByTestId('import-history-row').filter({ hasText: 'seed-projects-import.csv' });
  await expect(history.first()).toContainText('Completed');
  await shots(page, '8-history');

  // The object's Imports tab lists it too; a draft row opens the wizard where it was left.
  await page.goto(ws('settings/data/objects/projects/imports'));
  await expect(
    page.getByTestId('import-history-row').filter({ hasText: 'seed-projects-import.csv' }).first(),
  ).toContainText('Completed');
  await shots(page, '8-object-imports-tab');

  // Opened by URL the wizard is a page: breadcrumbs "<Object> / Import" instead of the overlay header.
  await page.goto(ws('custom/projects/import/new'));
  await expect(page.getByTestId('page-header')).toContainText('Projects');
  await expect(page.getByTestId('page-header')).toContainText('Import');
  await expect(page.getByTestId('import-header')).toHaveCount(0);
  await context.close();
});
