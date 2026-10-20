// Reports admin e2e (BACKLOG 9.01, 9.09): the dashboards index (create, star, search, sort and view settings, delete),
// Settings → Dashboards (list, detail tabs, delete a report, workspace level, delete a dashboard) and the dashboard
// Share popover (workspace level, add a member and a team, change and remove a grant, read-only for a member).
// Dashboards are created through the procedures with an "[e2e-admin]" prefix and removed again at the end.
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import {
  addReport,
  createDashboard,
  createTeam,
  dashboardByTitle,
  deleteDashboardsTitled,
  deleteTeam,
  deleteTeamsNamed,
  favouriteDashboard,
  type GrantRow,
  grantsOf,
  listDashboards,
  memberIdByEmail,
  renameDashboard,
  signedIn,
  trpc,
} from './reports-support.ts';
import { secondMember, signedInAs } from './slice5-support.ts';
import { sidebar } from './support.ts';

const PREFIX = '[e2e-admin] ';
const ws = (path: string) => `/${WORKSPACE_SLUG}/${path}`;
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

const row = (page: Page, id: string) => page.locator(`[data-testid="dashboard-row"][data-dashboard-id="${id}"]`);
const settingsRow = (page: Page, id: string) =>
  page.locator(`[data-testid="settings-dashboard-row"][data-dashboard-id="${id}"]`);

async function clearFavourites(page: Page): Promise<void> {
  const list = await trpc<{ favorites: { id: string }[] }>(page, 'favorites.list', undefined);
  for (const f of list.favorites) await trpc(page, 'favorites.delete', { favoriteId: f.id });
}

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ browser }) => {
  const { context, page } = await signedIn(browser, null);
  await deleteDashboardsTitled(page, PREFIX);
  await deleteTeamsNamed(page, PREFIX);
  await clearFavourites(page);
  await context.close();
});

test('index: New dashboard creates at once and opens it', async ({ browser }) => {
  const { context, page } = await signedIn(browser, ws('reports'));
  await expect(page.getByTestId('dashboards-index')).toBeVisible();
  await expect(page).toHaveTitle(/Dashboards/);
  const before = (await listDashboards(page)).length;

  await page.getByRole('button', { name: 'New dashboard' }).first().click();
  await page.waitForURL(/\/reports\/dashboard\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop() as string;

  const created = (await listDashboards(page)).find((d) => d.id === id);
  expect(created?.title).toBe('New Dashboard');
  expect((await listDashboards(page)).length).toBe(before + 1);
  // Grants: workspace and creator Full access (H api §1.5).
  const grants = await grantsOf(page, id);
  expect(grants.find((g) => g.target.type === 'workspace')?.level).toBe('full-access');
  expect(grants.filter((g) => g.target.type === 'member').map((g) => g.level)).toEqual(['full-access']);

  await renameDashboard(page, id, `${PREFIX}created from the index ${uniq()}`);
  await page.goto(ws('reports'));
  await expect(row(page, id)).toBeVisible();
  await context.close();
});

test('index: favourites, search, sort, grouping, view settings and delete', async ({ browser }) => {
  const { context, page } = await signedIn(browser, null);
  await clearFavourites(page);
  const tag = uniq();
  const alpha = await createDashboard(page, `${PREFIX}Alpha ${tag}`, 'The first of two');
  const beta = await createDashboard(page, `${PREFIX}Beta ${tag}`);
  await addReport(page, alpha, `${PREFIX}Companies count`, 'bar');
  await addReport(page, alpha, `${PREFIX}Companies pie`, 'pie');
  await page.goto(ws('reports'));

  // Rows: tile, title link, description info, report chips, relative date; groups with counts.
  await expect(row(page, alpha)).toBeVisible();
  await expect(row(page, alpha).getByRole('link', { name: `${PREFIX}Alpha ${tag}` })).toHaveAttribute(
    'href',
    `/${WORKSPACE_SLUG}/reports/dashboard/${alpha}`,
  );
  await expect(row(page, alpha).getByTestId('report-chip')).toHaveCount(2);
  await expect(row(page, alpha).getByTestId('report-chip').first()).toContainText(`${PREFIX}Companies count`);
  await expect(row(page, alpha).getByTestId('dashboard-info')).toBeVisible();
  await expect(row(page, beta).getByTestId('dashboard-info')).toHaveCount(0);
  await expect(row(page, alpha)).toContainText('Today');
  const today = page.getByTestId('dashboards-group').filter({ hasText: 'Created today' });
  await expect(today).toBeVisible();
  // Favourites placeholder while nothing is starred.
  await expect(page.getByTestId('favorites-empty')).toContainText('Dashboards that you favorite will appear here');

  // Star: the card joins the Favorites strip and the sidebar, the star stays filled; un-star reverses it.
  await row(page, alpha).hover();
  await row(page, alpha).getByRole('button', { name: 'Add to favorites' }).click();
  const card = page.getByTestId('favorite-card').filter({ hasText: `${PREFIX}Alpha ${tag}` });
  await expect(card).toBeVisible();
  await expect(card.locator('[class*="thumbGlyph"]')).toHaveCount(2);
  await expect(sidebar(page).getByRole('link', { name: new RegExp(`Alpha ${tag}`) })).toBeVisible();
  await page.mouse.move(700, 700);
  await expect(row(page, alpha).getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await expect(page.getByTestId('favorites-empty')).toHaveCount(0);
  expect((await dashboardByTitle(page, `${PREFIX}Alpha ${tag}`))?.favoriteId).not.toBeNull();
  await row(page, alpha).getByRole('button', { name: 'Remove from favorites' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('favorites-empty')).toBeVisible();
  // The card is a link to the dashboard.
  await favouriteDashboard(page, beta);
  await page
    .getByTestId('favorite-card')
    .filter({ hasText: `${PREFIX}Beta ${tag}` })
    .getByRole('link')
    .click();
  await page.waitForURL(new RegExp(`/reports/dashboard/${beta}$`));
  await page.goto(ws('reports'));
  await clearFavourites(page);

  // Search: icon button -> "Search dashboards" field, ?query= in the URL, filtered rows, empty result, Clear search.
  await page.getByRole('button', { name: 'Search dashboards' }).click();
  const search = page.getByRole('searchbox', { name: 'Search dashboards' });
  await search.fill(`beta ${tag}`);
  await expect(page).toHaveURL(/[?&]query=/);
  await expect(row(page, beta)).toBeVisible();
  await expect(row(page, alpha)).toHaveCount(0);
  await expect(page.getByTestId('dashboards-group').first()).toContainText(/Created today\s*1/);
  await search.fill(`nothing matches ${tag}`);
  await expect(page.getByTestId('dashboards-no-results')).toContainText('No dashboards found');
  await expect(page.getByTestId('dashboards-no-results')).toContainText(
    "We couldn't find any dashboards matching your search.",
  );
  await page.getByTestId('dashboards-no-results').getByRole('button', { name: 'Clear search' }).click();
  await expect(page).not.toHaveURL(/query=/);
  await expect(row(page, alpha)).toBeVisible();
  await expect(row(page, beta)).toBeVisible();
  // A shared link with ?query= opens the field filled.
  await page.goto(ws(`reports?query=${encodeURIComponent(`alpha ${tag}`)}`));
  await expect(page.getByRole('searchbox', { name: 'Search dashboards' })).toHaveValue(`alpha ${tag}`);
  await expect(row(page, alpha)).toBeVisible();
  await expect(row(page, beta)).toHaveCount(0);
  await page.goto(ws('reports'));

  // Sort: newest first by default; Ascending reverses the rows inside the group and is remembered after a reload.
  const order = async () =>
    page
      .locator('[data-testid="dashboard-row"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-dashboard-id')));
  await expect(row(page, alpha)).toBeVisible();
  await expect(row(page, beta)).toBeVisible();
  const newestFirst = await order();
  expect(newestFirst.indexOf(beta)).toBeLessThan(newestFirst.indexOf(alpha));
  await page.getByRole('button', { name: /Sorted by/ }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Descending' })).toBeChecked();
  await page.getByRole('menuitemcheckbox', { name: 'Ascending' }).click();
  await page.keyboard.press('Escape');
  const oldestFirst = await order();
  expect(oldestFirst.indexOf(alpha)).toBeLessThan(oldestFirst.indexOf(beta));
  await page.reload();
  await expect(row(page, alpha)).toBeVisible();
  expect((await order()).indexOf(alpha)).toBeLessThan((await order()).indexOf(beta));

  // View settings: Group by None -> one group, Show favorites off -> no strip; both per member and remembered.
  await page.getByRole('button', { name: 'View settings' }).click();
  await page.getByRole('menuitem', { name: /Group by/ }).click();
  await page.getByRole('menuitem', { name: 'None' }).click();
  await expect(page.getByTestId('dashboards-group')).toHaveCount(1);
  await expect(page.getByTestId('dashboards-group')).toContainText('All dashboards');
  await page.getByRole('button', { name: 'View settings' }).click();
  await page.getByRole('menuitem', { name: 'Show favorites' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('favorites-strip')).toHaveCount(0);
  await page.reload();
  await expect(row(page, alpha)).toBeVisible();
  await expect(page.getByTestId('favorites-strip')).toHaveCount(0);
  await expect(page.getByTestId('dashboards-group')).toContainText('All dashboards');
  await page.getByRole('button', { name: 'View settings' }).click();
  await page.getByRole('menuitem', { name: /Group by/ }).click();
  await page.getByRole('menuitem', { name: 'Creation date' }).click();
  await page.getByRole('button', { name: 'View settings' }).click();
  await page.getByRole('menuitem', { name: 'Show favorites' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Sorted by/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Descending' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('favorites-strip')).toBeVisible();

  // Delete dashboard: the row menu has the destructive item and the "Created by" footer; Cancel keeps it.
  await row(page, beta).hover();
  await row(page, beta).getByRole('button', { name: 'Dashboard options' }).click();
  const menu = page.getByRole('menu', { name: 'Dashboard options' });
  await expect(menu.getByRole('menuitem', { name: 'Delete dashboard' })).toBeVisible();
  await expect(menu).toContainText('Created by Ada Tester');
  await menu.getByRole('menuitem', { name: 'Delete dashboard' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Are you sure?');
  await expect(dialog).toContainText('Are you sure you want to delete this dashboard?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, beta)).toBeVisible();
  await row(page, beta).hover();
  await row(page, beta).getByRole('button', { name: 'Dashboard options' }).click();
  await page.getByRole('menuitem', { name: 'Delete dashboard' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(row(page, beta)).toHaveCount(0);
  expect(await dashboardByTitle(page, `${PREFIX}Beta ${tag}`)).toBeUndefined();
  expect(await dashboardByTitle(page, `${PREFIX}Alpha ${tag}`)).toBeDefined();
  await context.close();
});

/** Answers `dashboards.list` with `replace` (or holds it until `gate` resolves); everything else goes through. */
async function stubDashboardsList(
  page: Page,
  replace: (original: unknown) => unknown,
  gate?: Promise<void>,
): Promise<void> {
  await page.route('**/trpc/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/trpc\//, '');
    const index = decodeURIComponent(path).split(',').indexOf('dashboards.list');
    if (index < 0) return route.continue();
    if (gate) await gate;
    const response = await route.fetch();
    const body = (await response.json()) as unknown[];
    body[index] = replace(body[index]);
    await route.fulfill({ response, json: body });
  });
}

test('index: empty workspace, loading skeleton and error state', async ({ browser }) => {
  // Empty workspace: the Favorites placeholder, "No dashboards yet! …" and "New dashboard".
  const empty = await signedIn(browser, null);
  await stubDashboardsList(empty.page, () => ({ result: { data: [] } }));
  await empty.page.goto(ws('reports'));
  await expect(empty.page.getByTestId('dashboards-empty')).toContainText(
    'No dashboards yet! Create your first dashboard to get started.',
  );
  await expect(empty.page.getByTestId('dashboards-empty').getByRole('button', { name: 'New dashboard' })).toBeVisible();
  await expect(empty.page.getByTestId('favorites-empty')).toBeVisible();
  await expect(empty.page.getByTestId('dashboards-table')).toHaveCount(0);
  await empty.context.close();

  // Loading: the skeleton shows until the list arrives.
  const loading = await signedIn(browser, null);
  let release: () => void = () => undefined;
  await stubDashboardsList(
    loading.page,
    (original) => original,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await loading.page.goto(ws('reports'));
  await expect(loading.page.getByTestId('dashboards-loading')).toBeVisible();
  release();
  await expect(loading.page.getByTestId('dashboards-table')).toBeVisible();
  await expect(loading.page.getByTestId('dashboards-loading')).toHaveCount(0);
  await loading.context.close();

  // Error: a failing list shows "Error" with Retry; Retry loads the real list.
  const failing = await signedIn(browser, null);
  let fail = true;
  await failing.page.route('**/trpc/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/trpc\//, '');
    const index = decodeURIComponent(path).split(',').indexOf('dashboards.list');
    if (index < 0 || !fail) return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as unknown[];
    body[index] = {
      error: {
        message: 'Not allowed',
        code: -32003,
        data: { code: 'FORBIDDEN', httpStatus: 403, path: 'dashboards.list' },
      },
    };
    await route.fulfill({ response, json: body });
  });
  await failing.page.goto(ws('reports'));
  await expect(failing.page.getByTestId('dashboards-error')).toContainText(
    'Something went wrong trying to load dashboards.',
  );
  fail = false;
  await failing.page.getByTestId('dashboards-error').getByRole('button', { name: 'Retry' }).click();
  await expect(failing.page.getByTestId('dashboards-table')).toBeVisible();
  await failing.context.close();
});

test('index: a second tab sees a new dashboard without reloading', async ({ browser }) => {
  const { context, page } = await signedIn(browser, ws('reports'));
  await expect(page.getByTestId('dashboards-index')).toBeVisible();
  const id = await createDashboard(page, `${PREFIX}Live ${uniq()}`);
  await expect(row(page, id)).toBeVisible({ timeout: 10_000 });
  await context.close();
});

test('settings: dashboards list, detail tabs, delete a report, workspace level and delete a dashboard', async ({
  browser,
}) => {
  const { context, page } = await signedIn(browser, null);
  const tag = uniq();
  const title = `${PREFIX}Settings ${tag}`;
  const other = await createDashboard(page, `${PREFIX}Other ${tag}`);
  const id = await createDashboard(page, title, 'Reports of the settings test');
  const one = await addReport(page, id, `${PREFIX}Settings one ${tag}`, 'bar');
  const two = await addReport(page, id, `${PREFIX}Settings two ${tag}`, 'line');
  await addReport(page, id, `${PREFIX}Settings three ${tag}`, 'pie');

  // List: heading, search, columns, chips with "+N", absolute date, link to the Reports tab.
  await page.goto(ws('settings/reports/dashboards'));
  await expect(page.getByTestId('settings-dashboards')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboards', level: 1 })).toBeVisible();
  await expect(page.getByTestId('settings-dashboards')).toContainText('Manage reporting dashboards in your workspace.');
  for (const name of ['Dashboard', 'Reports', 'Created at'])
    await expect(page.getByRole('columnheader', { name })).toBeVisible();
  await expect(settingsRow(page, id)).toBeVisible();
  await expect(settingsRow(page, id).getByTestId('report-chip')).toHaveCount(2);
  await expect(settingsRow(page, id).getByTestId('report-chips-more')).toHaveText('+1');
  await expect(settingsRow(page, id)).toContainText(/[A-Z][a-z]{2} \d{1,2}(st|nd|rd|th) \d{4}/);
  await page.getByRole('searchbox', { name: 'Search dashboards' }).fill(`settings ${tag}`);
  await expect(settingsRow(page, id)).toBeVisible();
  await expect(settingsRow(page, other)).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search dashboards' }).fill(`zzz ${tag}`);
  await expect(page.getByTestId('settings-no-results')).toContainText('No dashboards found');
  await page.getByTestId('settings-no-results').getByRole('button', { name: 'Clear search' }).click();
  await expect(settingsRow(page, other)).toBeVisible();

  // Detail: Back, title, description, Reports tab with the three reports (relative dates), links to the report view.
  await settingsRow(page, id).getByRole('link', { name: title }).click();
  await page.waitForURL(new RegExp(`/settings/reports/dashboards/${id}/reports$`));
  await expect(page.getByTestId('settings-dashboard').getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(page.getByText('Manage reports, permissions and other relevant settings.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('page-header')).toContainText(`Dashboards`);
  await expect(page.getByTestId('page-header')).toContainText(title);
  const reportRows = page.getByTestId('settings-report-row');
  await expect(reportRows).toHaveCount(3);
  await expect(reportRows.first()).toContainText(/less than a minute ago|1 minute ago|\d+ minutes ago/);
  const firstLink = reportRows.first().getByRole('link');
  const cellHref = await firstLink.getAttribute('href');
  expect(cellHref).toMatch(new RegExp(`/reports/dashboard/${id}/cell/[0-9a-f-]{36}$`));

  // Delete a report: the confirmation copy, Cancel keeps, Confirm removes it for good.
  const target = page.locator(`[data-testid="settings-report-row"][data-report-id="${one.reportId}"]`);
  await target.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Delete report' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Report deletion');
  await expect(dialog).toContainText('Deleting a report deletes its data permanently and cannot be undone.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(reportRows).toHaveCount(3);
  await target.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Delete report' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(reportRows).toHaveCount(2);
  await expect(target).toHaveCount(0);
  const after = await dashboardByTitle(page, title, 'admin');
  expect(after?.reports.map((r) => r.id)).not.toContain(one.reportId);
  expect(after?.reports.map((r) => r.id)).toContain(two.reportId);

  // Permissions tab: workspace card, sections, level change saved at once.
  await page.getByRole('tab', { name: 'Permissions' }).click();
  await page.waitForURL(new RegExp(`/settings/reports/dashboards/${id}/permissions$`));
  const perms = page.getByTestId('settings-permissions');
  await expect(perms.getByRole('heading', { name: 'Members', exact: true })).toBeVisible();
  await expect(perms).toContainText('Set access rules for people in your workspace.');
  await expect(perms.getByTestId('workspace-access')).toContainText('Set default access for all workspace members');
  await expect(perms.getByTestId('permissions-teams')).toContainText(
    'Set access for teams. Team members will still inherit workspace access.',
  );
  await expect(perms.getByTestId('permissions-members')).toContainText(
    'Set access for members. Members will still inherit team and workspace access.',
  );
  const level = perms.getByTestId('settings-workspace-level');
  await expect(level).toContainText('Full access');
  await level.click();
  const options = page.getByRole('menu', { name: 'Workspace access' });
  for (const [name, text] of [
    ['Full access', 'Can manage reporting dashboard permissions'],
    ['Read and write', 'Can update the reporting dashboard'],
    ['Read only', 'Can only view the reporting dashboard'],
    ['No access', 'Has no access to the reporting dashboard'],
  ] as const)
    await expect(options.getByRole('menuitemradio', { name })).toContainText(text);
  await options.getByRole('menuitemradio', { name: 'Read only' }).click();
  await expect(level).toContainText('Read only');
  await expect
    .poll(async () => (await grantsOf(page, id)).find((g) => g.target.type === 'workspace')?.level)
    .toBe('read-only');
  // The creator keeps Full access through their own grant (no ⚠ hint on a row that gets what it has).
  const adaRow = perms.getByTestId('grant-row').filter({ hasText: 'Ada Tester' });
  await expect(adaRow).toBeVisible();
  await expect(adaRow).toContainText('e2e@mymeet.ai');
  await expect(adaRow.getByRole('button', { name: 'Ada Tester access' })).toContainText('Full access');
  await level.click();
  await page
    .getByRole('menu', { name: 'Workspace access' })
    .getByRole('menuitemradio', { name: 'Full access' })
    .click();
  await expect
    .poll(async () => (await grantsOf(page, id)).find((g) => g.target.type === 'workspace')?.level)
    .toBe('full-access');

  // Back -> the list; the row's ⋮ Options deletes the dashboard after a confirmation.
  await page.getByRole('link', { name: 'Back' }).click();
  await page.waitForURL(new RegExp('/settings/reports/dashboards$'));
  await settingsRow(page, id).getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Delete dashboard' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(settingsRow(page, id)).toHaveCount(0);
  expect(await dashboardByTitle(page, title, 'admin')).toBeUndefined();

  // The legacy path and an unknown tab land on the list / the Reports tab.
  await page.goto(ws('settings/data/reports'));
  await page.waitForURL(/\/settings\/reports\/dashboards$/);
  await page.goto(ws(`settings/reports/dashboards/${other}`));
  await page.waitForURL(new RegExp(`/settings/reports/dashboards/${other}/reports$`));
  await expect(page.getByTestId('settings-reports-empty')).toContainText('There are no reports in this dashboard');
  await context.close();
});

test('share: workspace level, add a member and a team, change and remove grants', async ({ browser }) => {
  const grace = secondMember();
  const { context, page } = await signedIn(browser, null);
  const tag = uniq();
  const id = await createDashboard(page, `${PREFIX}Share ${tag}`);
  const graceId = await memberIdByEmail(page, grace.email);
  const teamName = `${PREFIX}Sales ${tag}`;
  const teamId = await createTeam(page, teamName, [graceId]);

  await page.goto(ws(`reports/dashboard/${id}`));
  await page.getByTestId('share-button').click();
  const popover = page.getByTestId('share-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('Workspace access');
  await expect(popover).toContainText('Individual members');
  await expect(popover).toContainText('Learn more about permissions');
  await expect(popover.getByTestId('share-workspace-level')).toContainText('Full access');
  await expect(popover.getByTestId('grant-row')).toHaveCount(1);
  await expect(popover.getByTestId('grant-row')).toContainText('Ada Tester');
  await expect(popover.getByTestId('grant-row')).toContainText('e2e@mymeet.ai');
  // "Add" waits for a target.
  await expect(popover.getByTestId('share-add')).toBeDisabled();

  // Workspace level: saved at once (no Save button), checked through the API.
  await popover.getByTestId('share-workspace-level').click();
  await page.getByRole('menuitemradio', { name: 'Read and write' }).click();
  await expect(popover.getByTestId('share-workspace-level')).toContainText('Read and write');
  await expect
    .poll(async () => (await grantsOf(page, id)).find((g) => g.target.type === 'workspace')?.level)
    .toBe('read-write');
  await expect(popover.getByRole('button', { name: /^Save/ })).toHaveCount(0);

  // Add a member: search "Grace", pick her, level Read only, Add -> her row; API grant; Ada (listed) is not offered.
  await popover.getByTestId('share-search').click();
  await page.getByTestId('share-search').fill('hop');
  const listbox = page.getByRole('listbox');
  await expect(listbox.getByRole('option', { name: /Grace Hopper/ })).toBeVisible();
  await expect(listbox.getByRole('option', { name: /Ada Tester/ })).toHaveCount(0);
  await expect(listbox).not.toContainText(teamName);
  await listbox.getByRole('option', { name: /Grace Hopper/ }).click();
  await expect(popover.getByTestId('share-add')).toBeEnabled();
  await popover.getByTestId('share-add-level').click();
  await page.getByRole('menuitemradio', { name: 'Read only' }).click();
  await popover.getByTestId('share-add').click();
  const graceRow = popover.locator(`[data-testid="grant-row"][data-target-id="${graceId}"]`);
  await expect(graceRow).toBeVisible();
  await expect(graceRow).toContainText('Grace Hopper');
  await expect(graceRow).toContainText(grace.email);
  await expect.poll(async () => grantOf(page, id, graceId)).toMatchObject({ level: 'read-only' });
  await expect(popover.getByTestId('share-add')).toBeDisabled();

  // Add a team (search shows "Teams" with the member count), at Full access (the default).
  await popover.getByTestId('share-search').click();
  await page.getByTestId('share-search').fill(`Sales ${tag}`);
  await page
    .getByRole('listbox')
    .getByRole('option', { name: new RegExp(`Sales ${tag}`) })
    .click();
  await popover.getByTestId('share-add').click();
  const teamRow = popover.locator(`[data-testid="grant-row"][data-target-id="${teamId}"]`);
  await expect(teamRow).toContainText(teamName);
  await expect(teamRow).toContainText('1 member');
  await expect(popover).toContainText('Teams');
  await expect.poll(async () => grantOf(page, id, teamId)).toMatchObject({ level: 'full-access' });

  // Change a member's level (Grace gets Full access through the team: the row shows the ⚠ hint), then remove it.
  await graceRow.getByRole('button', { name: 'Grace Hopper access' }).click();
  await page.getByRole('menuitemradio', { name: 'Read and write' }).click();
  await expect.poll(async () => grantOf(page, id, graceId)).toMatchObject({ level: 'read-write' });
  await graceRow.getByRole('button', { name: 'Grace Hopper access' }).click();
  await expect(page.getByRole('menuitemradio', { name: /Remove/ })).toContainText('Remove member-level override');
  await page.getByRole('menuitemradio', { name: /Remove/ }).click();
  await expect(graceRow).toHaveCount(0);
  await expect.poll(async () => grantOf(page, id, graceId)).toBeUndefined();
  await teamRow.getByRole('button', { name: `${teamName} access` }).click();
  await expect(page.getByRole('menuitemradio', { name: /Remove/ })).toContainText('Remove team-level override');
  await page.getByRole('menuitemradio', { name: /Remove/ }).click();
  await expect(teamRow).toHaveCount(0);
  await expect.poll(async () => grantOf(page, id, teamId)).toBeUndefined();

  // The same grants are on the Settings → Permissions tab.
  await page.goto(ws(`settings/reports/dashboards/${id}/permissions`));
  await expect(page.getByTestId('settings-workspace-level')).toContainText('Read and write');
  await deleteTeam(page, teamId);
  await context.close();
});

async function grantOf(page: Page, dashboardId: string, targetId: string): Promise<GrantRow | undefined> {
  return (await grantsOf(page, dashboardId)).find((g) => g.target.id === targetId);
}

test('share: a member without Full access sees the popover read-only; Settings shows Add for teams and members', async ({
  browser,
}) => {
  const grace = secondMember();
  const { context: adminContext, page: admin } = await signedIn(browser, null);
  const tag = uniq();
  const id = await createDashboard(admin, `${PREFIX}Read only ${tag}`);
  // The seed makes every extra account an admin; admins can always manage grants (OQ-067), so Grace is a plain member.
  await trpc(admin, 'members.updateAccessLevel', {
    memberId: await memberIdByEmail(admin, grace.email),
    accessLevel: 'member',
  });
  await trpc(admin, 'permissions.put', {
    resourceKind: 'dashboard',
    resourceId: id,
    target: { type: 'workspace' },
    level: 'read-only',
  });

  // Settings → Permissions: "+ Add" lists the members without a grant and creates one at the workspace level.
  await admin.goto(ws(`settings/reports/dashboards/${id}/permissions`));
  await expect(admin.getByTestId('settings-workspace-level')).toContainText('Read only');
  await admin.getByTestId('add-member').click();
  await admin.getByPlaceholder('Search members...').fill('Grace');
  await admin.getByRole('menuitem', { name: /Grace Hopper/ }).click();
  const graceId = await memberIdByEmail(admin, grace.email);
  const row = admin.locator(`[data-testid="grant-row"][data-target-id="${graceId}"]`);
  await expect(row).toContainText('Grace Hopper');
  await expect(row.getByRole('button', { name: 'Grace Hopper access' })).toContainText('Read only');
  await expect.poll(async () => grantOf(admin, id, graceId)).toMatchObject({ level: 'read-only' });
  // Grace's own grant equals the workspace level: no inheritance hint.
  await expect(row.locator('[class*="levelWarning"]')).toHaveCount(0);
  await admin.getByTestId('add-team').click();
  await expect(admin.getByPlaceholder('Search teams...')).toBeVisible();
  await admin.keyboard.press('Escape');

  // Grace (a plain member) opens the dashboard: the Share popover lists the grants but cannot change them.
  const member = await signedInAs(browser, grace, ws(`reports/dashboard/${id}`));
  await member.page.getByTestId('share-button').click();
  const popover = member.page.getByTestId('share-popover');
  await expect(popover.getByTestId('share-workspace-level')).toBeDisabled();
  await expect(popover.getByTestId('share-workspace-level')).toContainText('Read only');
  await expect(popover.getByTestId('share-add')).toBeDisabled();
  await expect(popover.getByTestId('share-search')).toBeDisabled();
  await expect(popover).toContainText('You need Full access to this dashboard to change who can see it.');
  await expect(popover.locator('[data-testid="grant-row"] button').first()).toBeDisabled();
  await member.context.close();
  await adminContext.close();
});
