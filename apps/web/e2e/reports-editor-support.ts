// UI helpers for building reports in the editor (used by the e2e and parity specs): every step is what a member does —
// type picker, data source, metric, group by, segment by, visualisation.
import { expect, type Page } from '@playwright/test';
import { reportsPath } from './reports-web-support.ts';

/** Opens /cell/new, picks the type and the data source. */
export async function startReport(
  page: Page,
  dashboardId: string,
  type: 'insights' | 'historical' | 'funnel' | 'time-in-stage' | 'stage-changed',
  sourceId: string,
): Promise<void> {
  await page.goto(reportsPath(`/dashboard/${dashboardId}/cell/new`));
  await page.getByTestId('type-card-' + type).click();
  await page.locator(`[data-testid="source-option"][data-id="${sourceId}"]`).click();
  await expect(page.getByTestId('data-source-select')).not.toContainText('Choose a source');
}

/** Picks a row of the open attribute picker by its label. */
async function pickRow(page: Page, label: string): Promise<void> {
  await page
    .getByTestId('report-picker-row')
    .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) })
    .first()
    .click();
}

export async function setMetric(page: Page, attribute: string, aggregation?: string): Promise<void> {
  await page.getByTestId('metric-attribute').click();
  await pickRow(page, attribute);
  if (aggregation) {
    await page.getByTestId('aggregation-select').click();
    await page.getByRole('button', { name: aggregation, exact: true }).click();
  }
}

export async function groupBy(page: Page, attribute: string): Promise<void> {
  await page.getByTestId('group-by-add').click();
  await pickRow(page, attribute);
}

export async function segmentBy(page: Page, attribute: string): Promise<void> {
  await page.getByTestId('segment-by-add').click();
  await pickRow(page, attribute);
}

export async function chooseVisualisation(page: Page, label: string): Promise<void> {
  await page.getByTestId('visualisation-select').click();
  await page.getByTestId('visualisation-popover').getByRole('button', { name: label, exact: true }).click();
}

/** Status attribute of funnel / time in stage / stage changed (the picker opens by itself). */
export async function chooseStatusAttribute(page: Page, attribute: string): Promise<void> {
  const picker = page.getByTestId('report-picker-list');
  if (!(await picker.isVisible())) await page.getByTestId('status-attribute-select').click();
  await pickRow(page, attribute);
}

export async function setTitle(page: Page, title: string): Promise<void> {
  await page.getByTestId('report-title').click();
  await page.getByTestId('report-title-input').fill(title);
  await page.getByTestId('report-title-input').press('Enter');
}
