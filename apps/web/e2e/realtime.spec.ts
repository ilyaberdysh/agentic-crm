//  acceptance 5: a write in tab A makes tab B refetch within 1 s with accept-after; cutting the network
// shows the offline banner, and it goes away once the connection is back.

import { ACCEPT_AFTER_HEADER } from '@agentic-crm/realtime';
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { sidebar, signIn } from './support.ts';

/** Renames an object through the internal API with the page's session (the write tab A makes). */
async function renameObject(page: Page, entityDefinitionId: string, pluralNoun: string): Promise<void> {
  const response = await page.request.post('/trpc/schema.objects.update', {
    headers: { 'content-type': 'application/json', 'x-workspace-slug': WORKSPACE_SLUG },
    data: { entityDefinitionId, pluralNoun },
  });
  expect(response.ok()).toBe(true);
}

test('a write in one tab refetches the other within 1 s, sending x-accept-after', async ({ context }) => {
  const a = await context.newPage();
  await signIn(a, `/${WORKSPACE_SLUG}/home`);
  const b = await context.newPage();
  await b.goto(`/${WORKSPACE_SLUG}/home`);
  const records = sidebar(b).getByRole('region', { name: 'Records' });
  await expect(records.getByRole('link', { name: 'Deals' })).toBeVisible();
  // Let tab B's realtime connection come up.
  await b.waitForFunction(() => document.readyState === 'complete');
  await b.waitForTimeout(500);

  const refetch = b.waitForRequest(
    (req) => req.url().includes('schema.objects.list') && Boolean(req.headers()[ACCEPT_AFTER_HEADER]),
  );
  const started = Date.now();
  await renameObject(a, 'deals', 'Opportunities');
  const request = await refetch;
  await expect(records.getByRole('link', { name: 'Opportunities' })).toBeVisible({ timeout: 1000 });
  expect(Date.now() - started).toBeLessThan(1500);
  expect(Number(request.headers()[ACCEPT_AFTER_HEADER])).toBeGreaterThan(0);

  await renameObject(a, 'deals', 'Deals');
  await expect(records.getByRole('link', { name: 'Deals' })).toBeVisible({ timeout: 1000 });
});

test('offline banner while the network is cut', async ({ page, context }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  await expect(sidebar(page).getByRole('button', { name: /Workspace menu/ })).toBeVisible();
  await expect(page.getByText(/You're offline|You've been offline/)).toHaveCount(0);
  await context.setOffline(true);
  const banner = page.getByRole('status').filter({ hasText: 'Please check your internet connection and' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("You're offline.");
  await expect(banner.getByRole('button', { name: 'retry' })).toBeVisible();
  await context.setOffline(false);
  await expect(banner).toHaveCount(0, { timeout: 10_000 });
});
