// Slice 9 e2e for the report editor's types and controls (BACKLOG 9.03–9.07; builder §3–§11): visualisation reasons,
// included stages, target, sort, filter, date grouping with the time toolbar and comparison, drill-down to the
// contributing records, historical / funnel / time in stage / stage changed, and a list as data source. Numbers come
// from the "[seed] Projects" fixture (reports-web-support.ts): Build 470k (4), Discovery 200k (4), Review 43k (2),
// Done 21k (2).
import { expect, type Page, test } from '@playwright/test';
import {
  chooseStatusAttribute,
  chooseVisualisation,
  groupBy,
  segmentBy,
  setMetric,
  startReport,
} from './reports-editor-support.ts';
import { createDashboard, createProjects, hop, type ProjectsFixture, reportsPath } from './reports-web-support.ts';
import { signedInPage, trpc, uuid } from './slice3-support.ts';

let fixture: ProjectsFixture;
let dashboard: string;
let page: Page;

test.beforeAll(async ({ browser }) => {
  const { context, page: setup } = await signedInPage(browser, '/mymeet/home');
  fixture = await createProjects(setup);
  dashboard = await createDashboard(setup, 'Editor types');
  await context.close();
});

test.beforeEach(async ({ browser }) => {
  ({ page } = await signedInPage(browser, '/mymeet/home'));
});

/** The editor's own chart: the dashboard behind the overlay stays mounted and draws charts too. */
const canvas = (p: Page) => p.getByTestId('canvas-chart');

const barValues = (p: Page) =>
  p
    .locator('[data-testid="chart-bar-segment"]')
    .evaluateAll((els) =>
      els.map((el) => ({ group: el.getAttribute('data-group'), value: Number(el.getAttribute('data-value')) })),
    );
const categories = (p: Page) =>
  canvas(p)
    .locator('[data-testid="chart-bar"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-label')));

async function insightByPhase(p: Page) {
  await startReport(p, dashboard, 'insights', fixture.objectId);
  await setMetric(p, 'Budget');
  await groupBy(p, 'Phase');
  await expect(p.getByTestId('chart-bar').first()).toBeVisible();
}

test.describe('insight', () => {
  test('the visualisation menu explains what is unavailable', async () => {
    await startReport(page, dashboard, 'insights', fixture.objectId);
    await page.getByTestId('visualisation-select').click();
    const bar = page.getByTestId('visualisation-option-bar');
    await expect(bar).toHaveAttribute('data-disabled', 'true');
    await bar.hover();
    await expect(page.getByRole('tooltip')).toContainText('Available when you configure a "Group by" attribute');
    await expect(page.getByTestId('visualisation-option-single_metric')).not.toHaveAttribute('data-disabled', 'true');
    await expect(page.getByText('Available visualization types are restricted')).toBeVisible();
    // The tooltip of the hovered row closes first, then the popover.
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('visualisation-popover')).toBeHidden();
    // Group by a status: Single metric turns unavailable, Bar is chosen, Line needs a chronological or numeric group.
    await groupBy(page, 'Phase');
    await expect(page.getByTestId('visualisation-select')).toContainText('Bar');
    await page.getByTestId('visualisation-select').click();
    await expect(page.getByTestId('visualisation-option-single_metric')).toHaveAttribute('data-disabled', 'true');
    await expect(page.getByTestId('visualisation-option-pie')).not.toHaveAttribute('data-disabled', 'true');
  });

  test('a segment disables Pie and shows a legend of the segments', async () => {
    await insightByPhase(page);
    await segmentBy(page, 'Priority');
    await expect(canvas(page).getByTestId('chart-legend-item')).toHaveCount(4);
    await page.getByTestId('visualisation-select').click();
    const pie = page.getByTestId('visualisation-option-pie');
    await expect(pie).toHaveAttribute('data-disabled', 'true');
    await pie.hover();
    await expect(page.getByRole('tooltip')).toContainText('Only line and bar charts support "Segment by"');
  });

  test('included stages: deselecting Done leaves three bars and says what is excluded', async () => {
    await insightByPhase(page);
    expect(await categories(page)).toEqual(['Discovery', 'Build', 'Review', 'Done']);
    await page.getByTestId('included-stages').click();
    await page.getByTestId('stage-row').filter({ hasText: 'Done' }).getByRole('switch').click({ force: true });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('included-stages')).toContainText('All excluding "Done"');
    await expect.poll(() => categories(page)).toEqual(['Discovery', 'Build', 'Review']);
  });

  test('target draws a dotted line and is saved with the report', async () => {
    await insightByPhase(page);
    await page.getByTestId('target-switch').click();
    await page.getByTestId('target-input').fill('300000');
    await expect(canvas(page).getByTestId('chart-target-line')).toBeAttached();
    await page.getByTestId('save-report').click();
    await expect(page).toHaveURL(/\/edit$/);
    const detail = await trpc<{ cells: { report: { settings: { targetValue: number | null } } }[] }>(
      page,
      'dashboards.get',
      {
        dashboardId: dashboard,
      },
    );
    expect(detail.cells.at(-1)?.report.settings.targetValue).toBe(300_000);
  });

  test('sorting by amount reorders the bars; descending reverses them', async () => {
    await insightByPhase(page);
    await expect(page.getByTestId('sort-button')).toContainText('Sorted by stage order');
    await page.getByTestId('sort-button').click();
    await page.getByTestId('sort-by-amount').click();
    await page.getByTestId('sort-descending').click();
    await expect(page.getByTestId('sort-button')).toContainText('Sorted by amount');
    await expect.poll(() => categories(page)).toEqual(['Build', 'Discovery', 'Review', 'Done']);
    await page.getByTestId('sort-button').click();
    await page.getByTestId('sort-ascending').click();
    await expect.poll(() => categories(page)).toEqual(['Done', 'Review', 'Discovery', 'Build']);
  });

  test('a filter narrows the chart', async () => {
    await startReport(page, dashboard, 'insights', fixture.objectId);
    await expect(canvas(page).getByTestId('chart-single-value')).toHaveText('12');
    await page.getByTestId('add-filter').click();
    await page.getByTestId('view-picker-row-placeholder').count();
    await page.getByRole('option', { name: 'Priority' }).click();
    await page.getByRole('menuitem', { name: 'is', exact: true }).click();
    await page.getByRole('option', { name: 'High' }).click();
    await page.keyboard.press('Enter');
    await expect(canvas(page).getByTestId('chart-single-value')).toHaveText('4');
  });

  test('clicking a bar opens the contributing records of that group', async () => {
    await insightByPhase(page);
    await canvas(page)
      .locator('[data-testid="chart-bar-segment"][data-group="' + fixture.stages.Build + '"]')
      .click();
    const modal = page.getByTestId('contributing-data');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Build', { exact: true })).toHaveCount(4);
    await expect(page.getByText('Contributing data table')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('view-contributing-data').click();
    await expect(page.getByTestId('contributing-data').getByText('Discovery', { exact: true })).toHaveCount(4);
  });

  test('date grouping shows the time toolbar; comparing the previous period draws comparison bars', async () => {
    await startReport(page, dashboard, 'insights', fixture.objectId);
    await setMetric(page, 'Budget');
    await groupBy(page, 'Start date');
    await expect(page.getByTestId('time-toolbar')).toBeVisible();
    await expect(page.getByTestId('compare-button')).toBeDisabled();
    await page.getByTestId('range-6M').click();
    await expect(page.getByTestId('compare-button')).toBeEnabled();
    await page.getByTestId('compare-button').click();
    await page.getByRole('menuitem', { name: /Previous period/ }).click();
    await expect(page.getByTestId('compare-button')).toContainText('Comparing Previous period');
    await expect(canvas(page).getByTestId('chart-comparison-bar').first()).toBeAttached();
    await page.getByTestId('clear-comparison').click();
    await expect(page.getByTestId('compare-button')).toContainText('Compare');
    await page.getByTestId('resolution-select').click();
    await page.getByTestId('resolution-quarter').click();
    await expect(page.getByTestId('resolution-select')).toContainText('Quarterly');
  });
});

test.describe('other report types', () => {
  test('historical values: segment by Phase, Historical / Current and the time toolbar', async () => {
    await startReport(page, dashboard, 'historical', fixture.objectId);
    await setMetric(page, 'Budget');
    await segmentBy(page, 'Phase');
    await expect(page.getByTestId('time-toolbar')).toBeVisible();
    await expect(canvas(page).getByTestId('chart-legend-item')).toHaveCount(4);
    await expect(page.getByTestId('historic-mode')).toContainText('Historical');
    await page.getByTestId('historic-mode').click();
    await page.getByRole('button', { name: 'Current' }).click();
    await expect(page.getByTestId('historic-mode')).toContainText('Current');
    await expect(page.getByTestId('stack-bars')).toBeVisible();
    await expect(canvas(page).getByTestId('chart-bar').first()).toBeVisible();
  });

  test('funnel: all stages are selected, All records adds a Total step, fewer than two stages asks for more', async () => {
    await startReport(page, dashboard, 'funnel', fixture.objectId);
    await expect(page.getByText('Input needed to display chart')).toBeVisible();
    await chooseStatusAttribute(page, 'Phase');
    await expect(canvas(page).getByTestId('chart-funnel')).toBeAttached();
    await expect(page.getByTestId('included-stages')).toContainText('Discovery, Build, Review');
    await expect(canvas(page).getByTestId('chart-funnel-stage')).toHaveCount(4);
    await page.getByTestId('included-stages').click();
    await page.getByTestId('stage-row').filter({ hasText: 'All records' }).getByRole('switch').click({ force: true });
    await expect(canvas(page).getByTestId('chart-funnel-stage')).toHaveCount(5);
    await page.getByTestId('stage-toggle-all').click();
    await page.getByTestId('stage-row').filter({ hasText: 'Done' }).getByRole('switch').click({ force: true });
    await page.keyboard.press('Escape');
    await expect(page.getByText('Select at least 2 statuses')).toBeVisible();
    await chooseVisualisation(page, 'Funnel Steps');
  });

  test('time in stage: aggregation and a group by', async () => {
    await startReport(page, dashboard, 'time-in-stage', fixture.objectId);
    await chooseStatusAttribute(page, 'Phase');
    await expect(canvas(page).getByTestId('chart-bar').first()).toBeVisible();
    await expect(page.getByTestId('visualisation-select')).toHaveCount(0);
    await expect(page.getByTestId('aggregation-select')).toContainText('Average');
    await page.getByTestId('aggregation-select').click();
    await page.getByTestId('option-max').click();
    await expect(page.getByTestId('aggregation-select')).toContainText('Max');
    await groupBy(page, 'Priority');
    await expect(canvas(page).getByTestId('chart-legend-item').first()).toBeVisible();
    await expect(page.getByTestId('stack-bars')).toBeVisible();
  });

  test('stage changed: included stages and the time toolbar', async () => {
    await startReport(page, dashboard, 'stage-changed', fixture.objectId);
    await chooseStatusAttribute(page, 'Phase');
    await expect(page.getByTestId('time-toolbar')).toBeVisible();
    await expect(canvas(page).getByTestId('chart-bar').first()).toBeVisible();
    await expect(page.getByTestId('included-stages')).toContainText('All');
    await page.getByTestId('range-7D').click();
    await expect(page.getByTestId('range-7D')).toHaveAttribute('aria-pressed', 'true');
  });
});

test('a list can be the data source', async () => {
  const list = await trpc<{ list: { id: string; name: string } }>(page, 'lists.create', {
    id: uuid(),
    name: 'Source list',
    icon: 'emoji:clipboard',
    parentEntityDefinitionIds: [fixture.objectId],
  });
  await page.goto(reportsPath(`/dashboard/${dashboard}/cell/new`));
  await page.getByTestId('type-card-insights').click();
  await expect(page.getByTestId('data-source-popover').getByText('Lists', { exact: true })).toBeVisible();
  await page.locator(`[data-testid="source-option"][data-id="${list.list.id}"]`).click();
  await expect(page.getByTestId('data-source-select')).toContainText('Source list');
  await expect(canvas(page).getByText('No data to display')).toBeVisible();
  void hop;
});
