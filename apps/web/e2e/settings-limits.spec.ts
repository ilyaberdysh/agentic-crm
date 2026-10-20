// Data-model limits in the attribute admin (C.4 #7; server 409 OVER_USAGE_LIMIT / ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED):
// a lower quota is set on the e2e workspace (workspaces.settings.capabilities.quotas) and the dialogs explain the error.
import { createDb, sql } from '@agentic-crm/db';
import { expect, test } from '@playwright/test';
import { databaseUrl, E2E_DATABASE, WORKSPACE_SLUG } from './env.ts';
import { signIn } from './support.ts';

const attributesPath = `/${WORKSPACE_SLUG}/settings/data/objects/projects/attributes`;

/** Sets (or clears with null) a quota override of the e2e workspace. */
async function setQuota(key: string, value: number | null): Promise<void> {
  const db = createDb({ connectionString: databaseUrl(E2E_DATABASE), max: 1, applicationName: 'web-e2e-quota' });
  try {
    const entry = JSON.stringify({ [key]: value });
    await sql`
      UPDATE workspaces
      SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
        'capabilities', coalesce(settings->'capabilities', '{}'::jsonb) || jsonb_build_object(
          'quotas', coalesce(settings->'capabilities'->'quotas', '{}'::jsonb) || ${entry}::jsonb))
      WHERE slug = ${WORKSPACE_SLUG}`.execute(db.kysely);
  } finally {
    await db.destroy();
  }
}

test.describe.configure({ mode: 'serial' });

test('attributes per object: server 409 shows in the dialog, then the tab disables create', async ({ page }) => {
  await signIn(page, attributesPath);
  // The page has loaded its rows (formula specs add "Budget per head" next to "Budget": match the cell exactly).
  await expect(
    page
      .getByRole('table', { name: 'Attributes' })
      .getByRole('row')
      .filter({ has: page.getByText('Budget', { exact: true }) }),
  ).toBeVisible();
  try {
    // The page loaded the default limit (500); the server now enforces 3.
    await setQuota('attributes_per_object_hard', 3);
    await page.getByRole('button', { name: 'Create attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Over the limit');
    await dialog.getByRole('button', { name: /Create attribute/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('This object has reached the limit of 3 attributes');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');

    await page.reload();
    await expect(page.getByText('This object has reached the limit of 3 attributes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create attribute' })).toBeDisabled();
  } finally {
    await setQuota('attributes_per_object_hard', null);
  }
});

test('options per attribute: the editor stops at the limit', async ({ page }) => {
  try {
    await setQuota('select_options_per_attribute_hard', 2);
    await signIn(page, attributesPath);
    await page.getByRole('button', { name: 'Create attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create attribute' });
    await dialog.getByRole('button', { name: 'Attribute Type' }).click();
    await page.getByRole('menuitemradio', { name: 'Select', exact: true }).click();
    await dialog.getByRole('button', { name: 'Options', exact: true }).click();
    for (const title of ['A', 'B']) {
      await page.getByRole('button', { name: 'Create option' }).click();
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
    }
    await expect(page.getByText('Reached the limit of 2 options. New options will not be created.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create option' })).toBeDisabled();
  } finally {
    await setQuota('select_options_per_attribute_hard', null);
  }
});
