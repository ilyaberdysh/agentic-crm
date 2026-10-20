// BACKLOG §1 acceptance 3, 8, 9: workspace creation/picker/switching, the shell, sidebar collapse (⌘.), resize
// limits and double-click reset, the floating variant at ≤ 864 px, unknown paths, the Appearance setting.
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { pathOf, showAllSidebarObjects, sidebar, signIn } from './support.ts';
import { trpc } from './views-support.ts';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function sidebarWidth(page: Page): Promise<number> {
  return page.locator('aside[data-variant="docked"]').evaluate((el) => Math.round(el.getBoundingClientRect().width));
}

test.beforeEach(async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
});

test('the shell: workspace header, search row, main nav, records from the API, lists, footer', async ({ page }) => {
  const side = sidebar(page);
  await expect(side.getByRole('button', { name: /Workspace menu: mymeet/ })).toBeVisible();
  await expect(side.getByRole('button', { name: 'Search' })).toBeVisible();
  for (const item of ['Home', 'Tasks', 'Notes', 'Emails', 'Calls', 'Reports', 'Sequences', 'Workflows']) {
    await expect(side.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: item })).toBeVisible();
  }
  const records = side.getByRole('region', { name: 'Records' });
  // Specs of a full run leave custom objects behind; past 6 the section ends with "All objects" (lifted here).
  await showAllSidebarObjects(page);
  for (const object of ['Companies', 'People', 'Deals']) {
    await expect(records.getByRole('link', { name: object })).toBeVisible();
  }
  // Lists (slice 4): "+ New list" while the workspace has none, else its lists (lists.spec runs first).
  const lists = side.getByRole('region', { name: 'Lists' });
  await expect(
    lists.getByText('New list').or(lists.getByTestId('sidebar-lists').getByRole('link').first()),
  ).toBeVisible();
  await expect(side.getByRole('link', { name: 'Invite members' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Ada\.$/);
  await expect(page).toHaveTitle('Home - Agentic CRM');

  await records.getByRole('link', { name: 'Companies' }).click();
  // The bare object URL opens the object's first view (C1 README §1).
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/companies/view/[0-9a-f-]{36}$`));
  await expect(page.getByTestId('page-header')).toContainText('Companies');
  await expect(records.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
});

test('keyboard navigation: G then T opens tasks, G then C companies', async ({ page }) => {
  // Focus nothing (a click at fixed coordinates can land on a Home task row, which opens the task dialog where
  // global shortcuts are off).
  await expect(page.getByTestId('page-header')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('g');
  await page.keyboard.press('t');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/tasks$`));
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  // The bare object URL opens the object's first view (C1 README §1).
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/companies/view/[0-9a-f-]{36}$`));
});

test('unknown paths redirect to home; an unknown workspace shows the no-access page', async ({ page }) => {
  await page.goto(`/${WORKSPACE_SLUG}/this-page-does-not-exist`);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await page.goto(`/${WORKSPACE_SLUG}`);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await page.goto(`/${WORKSPACE_SLUG}/settings/nope`);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/settings/account$`));
  await page.goto('/no-such-workspace/home');
  await expect(page.getByText("You don't have access to this workspace!")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
});

test('collapse with ⌘. → floating sidebar revealed from the left edge; ⌘. again docks it', async ({ page }) => {
  await expect(page.locator('aside[data-variant="docked"]')).toBeVisible();
  await page.keyboard.press(`${mod}+Period`);
  const floating = page.locator('aside[data-variant="hover"]');
  await expect(floating).toHaveCount(1);
  await expect(floating).not.toHaveAttribute('data-open', /.*/);
  await expect(page.getByRole('button', { name: 'Expand sidebar' }).first()).toBeVisible();
  // Content takes the full width.
  await expect
    .poll(() =>
      page
        .locator('main')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().left)),
    )
    .toBe(0);

  // Hover the 14 px strip at the left edge (after the 150 ms force-collapse lock).
  await page.waitForTimeout(200);
  await page.mouse.move(5, 400, { steps: 3 });
  await expect(floating).toHaveAttribute('data-open', 'true');
  await page.mouse.move(900, 400);
  await expect(floating).not.toHaveAttribute('data-open', /.*/);

  // Persisted across reloads.
  await page.reload();
  await expect(page.locator('aside[data-variant="hover"]')).toHaveCount(1);
  await page.keyboard.press(`${mod}+Period`);
  await expect(page.locator('aside[data-variant="docked"]')).toBeVisible();
});

test('the collapse button collapses; Expand sidebar in the header expands', async ({ page }) => {
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('aside[data-variant="hover"]')).toHaveCount(1);
  await page.getByTestId('page-header').getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('aside[data-variant="docked"]')).toBeVisible();
});

test('resize: clamps to 200–350, double-click resets to 275, width persists', async ({ page }) => {
  expect(await sidebarWidth(page)).toBe(275);
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  const box = await handle.boundingBox();
  if (!box) throw new Error('no resize handle');
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(315);

  await page.mouse.move(x + 40, y);
  await page.mouse.down();
  await page.mouse.move(x + 300, y, { steps: 4 });
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(350);

  await page.reload();
  expect(await sidebarWidth(page)).toBe(350);

  const after = await handle.boundingBox();
  if (!after) throw new Error('no resize handle');
  await page.mouse.move(after.x + after.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(120, y, { steps: 6 });
  await page.mouse.up();
  expect(await sidebarWidth(page)).toBe(200);

  await handle.dblclick();
  // Width animates over 140 ms when not dragging.
  await expect.poll(() => sidebarWidth(page)).toBe(275);
});

test('dragging below 25 px collapses the sidebar', async ({ page }) => {
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  const box = await handle.boundingBox();
  if (!box) throw new Error('no resize handle');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(10, y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('aside[data-variant="hover"]')).toHaveCount(1);
  await page.keyboard.press(`${mod}+Period`);
  await expect(page.locator('aside[data-variant="docked"]')).toBeVisible();
});

test('at ≤ 864 px app width the sidebar floats; widening docks it again', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator('aside[data-variant="hover"]')).toHaveCount(1);
  await page.getByTestId('page-header').getByRole('button', { name: 'Expand sidebar' }).hover();
  await expect(page.locator('aside[data-variant="hover"]')).toHaveAttribute('data-open', 'true');
  // Navigation hides the panel in narrow mode.
  await page.locator('aside').getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.locator('aside[data-variant="hover"]')).not.toHaveAttribute('data-open', /.*/);
  await page.setViewportSize({ width: 1512, height: 945 });
  await expect(page.locator('aside[data-variant="docked"]')).toBeVisible();
});

test('appearance: theme and accent apply instantly and persist', async ({ page }) => {
  await page.goto(`/${WORKSPACE_SLUG}/settings/appearance`);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await bg()).toBe('rgb(255, 255, 255)');
  await page.getByRole('radio', { name: 'Dark' }).check({ force: true });
  await expect.poll(bg).toBe('rgb(16, 17, 18)');
  await page.getByRole('radio', { name: 'pink' }).check({ force: true });
  await page.reload();
  await expect.poll(bg).toBe('rgb(16, 17, 18)');
  await expect(page.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'pink' })).toBeChecked();
  // System follows prefers-color-scheme.
  await page.getByRole('radio', { name: 'System' }).check({ force: true });
  await page.getByRole('radio', { name: 'blue' }).check({ force: true });
  await expect.poll(bg).toBe('rgb(255, 255, 255)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(bg).toBe('rgb(16, 17, 18)');
});

test('settings nav search filters sections and subsections', async ({ page }) => {
  await page.goto(`/${WORKSPACE_SLUG}/settings/account`);
  const nav = page.getByRole('navigation', { name: 'Settings' });
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('theme');
  await expect(nav.getByRole('link', { name: 'Appearance' })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Theme/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Profile' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search settings' }).fill('zzzz');
  await expect(nav.getByText('No results found')).toBeVisible();
  await page.getByRole('button', { name: 'Go back' }).click();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
});

test('create a workspace, see it in the picker and the switcher, and reopen the last one', async ({ page }) => {
  await page.goto('/welcome/workspace-details');
  await page.getByLabel('Company name').fill('Mymeet');
  // The handle follows the name; "mymeet" is taken by the seed.
  await expect(page.getByLabel('Workspace handle')).toHaveValue('mymeet');
  await expect(page.getByText('This handle is already in use')).toBeVisible();

  const name = `E2E Labs ${Date.now().toString(36)}`;
  await page.getByLabel('Company name').fill(name);
  const slug = name.toLowerCase().replace(/\s+/g, '-');
  await expect(page.getByLabel('Workspace handle')).toHaveValue(slug);
  await expect(page.getByText('This handle is available')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  await expect(sidebar(page).getByRole('button', { name: `Workspace menu: ${name}` })).toBeVisible();
  // A new workspace has the standard objects.
  await expect(
    sidebar(page).getByRole('region', { name: 'Records' }).getByRole('link', { name: 'Companies' }),
  ).toBeVisible();

  // Picker lists both.
  await page.goto('/workspaces');
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByRole('link', { name: /^mymeet/ })).toBeVisible();

  // Switcher menu → mymeet; `/` then reopens the last used workspace.
  await page.goto(`/${slug}/home`);
  await page.getByRole('button', { name: /Workspace menu/ }).click();
  await page.getByRole('menuitem', { name: 'mymeet' }).click();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  // The shell remembers a workspace once it has rendered (an effect after load): wait for that before leaving.
  const slugId =
    (await trpc<{ id: string; slug: string }[]>(page, 'workspaces.list', {})).find((w) => w.slug === slug)?.id ?? null;
  await page.goto(`/${slug}/tasks`);
  await expect(sidebar(page).getByRole('button', { name: `Workspace menu: ${name}` })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ar:recent-workspaces')?.split(',')[0] ?? null))
    .toBe(slugId);
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${slug}/home$`));
  expect(pathOf(page)).toBe(`/${slug}/home`);
});
