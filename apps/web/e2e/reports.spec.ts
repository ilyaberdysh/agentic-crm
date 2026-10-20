// e2e for the dashboard page and the report editor: grid layout (resize, drag, persisted), the cell
// menu order (acceptance 4), duplicate / delete, the editor flow with the unsaved-changes guard, the viewer's J / K and
// "New data" after a change made elsewhere (acceptance 3). The dashboards index, Share and Settings → Dashboards are
// covered by reports-admin.spec.ts; chart drawing by reports-charts.spec.ts.
import { expect, type Page, test } from '@playwright/test';
import {
  addReport,
  budgetByPhase,
  createDashboard,
  createProjects,
  type ProjectsFixture,
  reportsPath,
} from './reports-web-support.ts';
import { signedInPage, trpc, uuid } from './slice3-support.ts';

let page: Page;
let fixture: ProjectsFixture;

test.beforeAll(async ({ browser }) => {
  const { context, page: setup } = await signedInPage(browser, '/mymeet/home');
  fixture = await createProjects(setup);
  await context.close();
});

test.beforeEach(async ({ browser }) => {
  ({ page } = await signedInPage(browser, '/mymeet/home'));
});

const countReport = (title: string, width = 4) => ({
  entityDefinitionId: fixture.objectId,
  title,
  reportType: 'insights' as const,
  visualisationType: 'single_metric',
  settings: {},
  width,
});

async function dashboardWith(titles: string[], widths: number[] = []) {
  const id = await createDashboard(page, `Dash ${Date.now().toString(36)}`);
  const cells: string[] = [];
  for (const [i, title] of titles.entries()) {
    const { cellId } = await addReport(page, id, { ...countReport(title), settings: {} });
    cells.push(cellId);
    void widths[i];
  }
  if (widths.length > 0) {
    const detail = await trpc<{ cells: { id: string; sortOrder: string }[] }>(page, 'dashboards.get', {
      dashboardId: id,
    });
    await trpc(page, 'dashboards.setLayout', {
      dashboardId: id,
      cells: detail.cells.map((c, i) => ({ cellId: c.id, sortOrder: c.sortOrder, width: widths[i] ?? 12 })),
    });
  }
  return { id, cells };
}

const slots = (p: Page) => p.getByTestId('grid-slot');
const spanOf = async (p: Page, index: number) =>
  Number(((await slots(p).nth(index).getAttribute('style')) ?? '').match(/span (\d+)/)?.[1]);
const titles = (p: Page) => p.getByTestId('cell-title').allTextContents();

test.describe('dashboard grid', () => {
  test('packs cells into rows of 12 columns and stretches the last cell of a row', async () => {
    const { id } = await dashboardWith(['A', 'B', 'C', 'D'], [4, 4, 9, 4]);
    await page.goto(reportsPath(`/dashboard/${id}`));
    await expect(slots(page)).toHaveCount(4);
    expect([await spanOf(page, 0), await spanOf(page, 1), await spanOf(page, 2), await spanOf(page, 3)]).toEqual([
      4, 8, 12, 12,
    ]);
    const rows = page.getByTestId('grid-row');
    await expect(rows).toHaveCount(3);
    const card = await page.getByTestId('report-cell').first().boundingBox();
    expect(Math.round(card?.height ?? 0)).toBe(458);
  });

  test('resize handle moves columns between neighbours and persists the layout', async () => {
    const { id } = await dashboardWith(['A', 'B'], [6, 6]);
    await page.goto(reportsPath(`/dashboard/${id}`));
    const handle = page.getByTestId('resize-handle');
    await expect(handle).toHaveCount(1);
    const box = await handle.boundingBox();
    const grid = await page.getByTestId('dashboard-grid').boundingBox();
    if (!box || !grid) throw new Error('layout not measurable');
    const column = (grid.width - 28) / 12;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - column * 2, box.y + 200, { steps: 6 });
    await page.mouse.up();
    await expect.poll(() => spanOf(page, 0)).toBe(4);
    expect(await spanOf(page, 1)).toBe(8);
    await page.reload();
    await expect(slots(page)).toHaveCount(2);
    expect([await spanOf(page, 0), await spanOf(page, 1)]).toEqual([4, 8]);
  });

  test('dragging a cell header beside another cell re-splits the row and persists the order', async () => {
    const { id } = await dashboardWith(['A', 'B', 'C'], [12, 12, 12]);
    await page.goto(reportsPath(`/dashboard/${id}`));
    await expect(slots(page)).toHaveCount(3);
    const header = await page.getByTestId('cell-header').nth(0).boundingBox();
    const target = await slots(page).nth(1).boundingBox();
    if (!header || !target) throw new Error('layout not measurable');
    await page.mouse.move(header.x + 100, header.y + 20);
    await page.mouse.down();
    await page.mouse.move(header.x + 110, header.y + 40, { steps: 3 });
    await page.mouse.move(target.x + target.width - 60, target.y + 200, { steps: 12 });
    await expect(page.getByTestId('beside-drop-bar')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => spanOf(page, 0)).toBe(6);
    expect(await titles(page)).toEqual(['B', 'A', 'C']);
    expect([await spanOf(page, 0), await spanOf(page, 1), await spanOf(page, 2)]).toEqual([6, 6, 12]);
    await page.reload();
    await expect(slots(page)).toHaveCount(3);
    expect(await titles(page)).toEqual(['B', 'A', 'C']);
  });

  test('a drop between rows makes a new full-width row', async () => {
    const { id } = await dashboardWith(['A', 'B', 'C'], [6, 6, 12]);
    await page.goto(reportsPath(`/dashboard/${id}`));
    const header = await page.getByTestId('cell-header').nth(1).boundingBox();
    const rows = await page.getByTestId('grid-row').nth(1).boundingBox();
    if (!header || !rows) throw new Error('layout not measurable');
    await page.mouse.move(header.x + 100, header.y + 20);
    await page.mouse.down();
    await page.mouse.move(header.x + 110, header.y + 30, { steps: 3 });
    await page.mouse.move(rows.x + 200, rows.y + 2, { steps: 12 });
    await expect(page.getByTestId('row-drop-line')).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => spanOf(page, 0)).toBe(12);
    expect(await titles(page)).toEqual(['A', 'B', 'C']);
    expect([await spanOf(page, 1), await spanOf(page, 2)]).toEqual([12, 12]);
  });
});

test.describe('cell menu', () => {
  test('follows the live capture order (acceptance 4)', async () => {
    const { id } = await dashboardWith(['A']);
    await page.goto(reportsPath(`/dashboard/${id}`));
    await page.getByTestId('cell-menu-button').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const labels = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim());
    expect(labels.slice(0, 5)).toEqual(['Download as image', 'Edit', 'Duplicate', 'Duplicate to...', 'Delete report']);
    await expect(page.getByTestId('cell-menu-footer')).toContainText('Created by');
  });

  test('Duplicate adds a copy after the source and opens its editor', async () => {
    const { id } = await dashboardWith(['A', 'B']);
    await page.goto(reportsPath(`/dashboard/${id}`));
    await page.getByTestId('cell-menu-button').first().click();
    await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    await expect(page).toHaveURL(/\/cell\/[0-9a-f-]+\/edit$/);
    await expect(page.getByTestId('report-editor')).toBeVisible();
    await expect(page.getByTestId('report-counter')).toHaveText('2 of 3 reports');
  });

  test('Delete report asks for confirmation and removes the cell', async () => {
    const { id } = await dashboardWith(['A', 'B'], [6, 6]);
    await page.goto(reportsPath(`/dashboard/${id}`));
    await page.getByTestId('cell-menu-button').nth(1).click();
    await page.getByRole('menuitem', { name: 'Delete report' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Are you sure you want to delete this report?');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(slots(page)).toHaveCount(1);
    // The remaining cell absorbs the width.
    expect(await spanOf(page, 0)).toBe(12);
  });
});

test.describe('"New data" (acceptance 3)', () => {
  test('changing a deal stage in another tab marks the affected cell', async ({ browser }) => {
    const id = await createDashboard(page, 'Fresh');
    await addReport(page, id, {
      entityDefinitionId: fixture.objectId,
      title: 'Budget by phase',
      reportType: 'insights',
      visualisationType: 'bar',
      settings: budgetByPhase(fixture),
    });
    await addReport(page, id, { ...countReport('Unrelated', 12), entityDefinitionId: 'companies' });
    await page.goto(reportsPath(`/dashboard/${id}`));
    await expect(slots(page)).toHaveCount(2);
    await expect(page.getByTestId('new-data-pill')).toHaveCount(0);
    // Another tab moves a project to another stage.
    const { page: other } = await signedInPage(browser, '/mymeet/home');
    const record = fixture.records[0];
    if (!record) throw new Error('no fixture records');
    await trpc(other, 'records.patch', {
      entityDefinitionId: fixture.objectId,
      entityInstanceId: record.id,
      values: { [fixture.phase]: [{ value: { pipelineStageId: fixture.stages.Review } }] },
    });
    const affected = page.locator('[data-testid="report-cell"]', { hasText: 'Budget by phase' });
    await expect(affected.getByTestId('new-data-pill')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('[data-testid="report-cell"]', { hasText: 'Unrelated' }).getByTestId('new-data-pill'),
    ).toHaveCount(0);
    // Refreshing clears it.
    await affected.getByTestId('new-data-pill').click();
    await expect(page.getByTestId('new-data-pill')).toHaveCount(0);
    await other.context().close();
  });
});

test.describe('editor and viewer', () => {
  test('builds an insight through the type picker and saves it as a new cell', async () => {
    const id = await createDashboard(page, 'Editor');
    await page.goto(reportsPath(`/dashboard/${id}`));
    await expect(page.getByTestId('empty-new-report')).toBeVisible();
    await page.getByTestId('empty-new-report').click();
    await expect(page).toHaveURL(/\/cell\/new$/);
    await expect(page.getByTestId('type-picker')).toBeVisible();
    await expect(page.getByText('What do you want to report on?')).toBeVisible();
    await page.getByTestId('type-card-insights').click();
    // The data source picker opens by itself.
    await page.locator(`[data-testid="source-option"][data-id="${fixture.objectId}"]`).click();
    await expect(page.getByTestId('data-source-select')).toContainText('[seed] Projects');
    await page.getByTestId('metric-attribute').click();
    await page.getByTestId('report-picker-row').filter({ hasText: 'Budget' }).click();
    await expect(page.getByTestId('aggregation-select')).toContainText('Sum');
    await page.getByTestId('group-by-add').click();
    await page.getByTestId('report-picker-row').filter({ hasText: 'Phase' }).click();
    await expect(page.getByTestId('visualisation-select')).toContainText('Bar');
    await expect(page.getByTestId('included-stages')).toContainText('All');
    await page.getByTestId('report-title').click();
    await page.getByTestId('report-title-input').fill('Budget by phase');
    await page.getByTestId('report-title-input').press('Enter');
    await page.getByTestId('save-report').click();
    await expect(page).toHaveURL(/\/cell\/[0-9a-f-]+\/edit$/);
    await expect(page.getByTestId('report-counter')).toHaveText('1 of 1 report');
    const saved = await trpc<{ cells: { report: { title: string; reportType: string; visualisationType: string } }[] }>(
      page,
      'dashboards.get',
      { dashboardId: id },
    );
    expect(saved.cells).toHaveLength(1);
    expect(saved.cells[0]?.report).toMatchObject({
      title: 'Budget by phase',
      reportType: 'insights',
      visualisationType: 'bar',
    });
  });

  test('Escape with unsaved changes asks first; Discard changes restores the saved report', async () => {
    const { id, cells } = await dashboardWith(['Saved title']);
    await page.goto(reportsPath(`/dashboard/${id}/cell/${cells[0]}/edit`));
    await expect(page.getByTestId('report-editor')).toBeVisible();
    await expect(page.getByTestId('discard-changes')).toHaveCount(0);
    await page.getByTestId('report-title').click();
    await page.getByTestId('report-title-input').fill('Changed');
    await page.getByTestId('report-title-input').press('Enter');
    await expect(page.getByTestId('discard-changes')).toBeVisible();
    await page.getByTestId('editor-close').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Are you sure you want to cancel?');
    await expect(dialog).toContainText('You will lose any unsaved progress');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByTestId('discard-changes').click();
    await expect(page.getByTestId('report-title')).toHaveText('Saved title');
    await page.getByTestId('editor-close').click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/${id}$`));
  });

  test('Save as new report forks and leaves the original untouched', async () => {
    const { id, cells } = await dashboardWith(['Original']);
    await page.goto(reportsPath(`/dashboard/${id}/cell/${cells[0]}/edit`));
    await page.getByTestId('report-title').click();
    await page.getByTestId('report-title-input').fill('Fork');
    await page.getByTestId('report-title-input').press('Enter');
    await page.getByTestId('save-options').click();
    await page.getByRole('menuitem', { name: 'As new report' }).click();
    await expect(page.getByTestId('report-counter')).toHaveText('2 of 2 reports');
    const detail = await trpc<{ cells: { report: { title: string } }[] }>(page, 'dashboards.get', { dashboardId: id });
    expect(detail.cells.map((c) => c.report.title)).toEqual(['Original', 'Fork']);
  });

  test('the viewer steps through the reports with J and K and shows the counter', async () => {
    const { id, cells } = await dashboardWith(['One', 'Two', 'Three']);
    await page.goto(reportsPath(`/dashboard/${id}/cell/${cells[0]}`));
    await expect(page.getByTestId('report-counter')).toHaveText('1 of 3 reports');
    await expect(page.getByTestId('previous-report')).toBeDisabled();
    await page.keyboard.press('j');
    await expect(page).toHaveURL(new RegExp(`/cell/${cells[1]}$`));
    await expect(page.getByTestId('report-counter')).toHaveText('2 of 3 reports');
    await page.keyboard.press('j');
    await expect(page.getByTestId('report-counter')).toHaveText('3 of 3 reports');
    await expect(page.getByTestId('next-report')).toBeDisabled();
    await page.keyboard.press('k');
    await expect(page.getByTestId('report-counter')).toHaveText('2 of 3 reports');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`/dashboard/${id}$`));
  });

  test('changing the type asks for confirmation', async () => {
    const { id, cells } = await dashboardWith(['Typed']);
    await page.goto(reportsPath(`/dashboard/${id}/cell/${cells[0]}/edit`));
    await page.getByTestId('type-switcher').click();
    await page.getByTestId('type-option-funnel').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Are you sure you want to change the report type?');
    await expect(dialog).toContainText('This may overwrite your current configuration');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('type-switcher')).toContainText('Funnel');
    await expect(page.getByTestId('status-attribute-select')).toBeVisible();
  });
});

test('empty dashboard shows the empty state with a New report button', async () => {
  const id = await createDashboard(page, 'Empty one');
  await page.goto(reportsPath(`/dashboard/${id}`));
  await expect(page.getByText('Empty dashboard')).toBeVisible();
  await expect(page.getByText('No reports in this dashboard yet')).toBeVisible();
  void uuid;
});
