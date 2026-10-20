// Permissions, rules and developers (BACKLOG §6 acceptance 2–5): a member with Read only cannot open cell editors and
// the API answers 403; No access hides the object and shows the no-access page; a team grant plus the workspace grant
// resolve to the more permissive level (with the ⚠ inheritance hint); a rule violation holds the write and shows the
// rule message, the ninth rule is refused with the limit message; webhooks, tokens, test deliveries and /v2.
// Everything runs on its own custom object so the stock workspace stays untouched for other specs.
import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { WEB_ORIGIN, WORKSPACE_SLUG } from './env.ts';
import { createTestObject, type MemberSession, newMember, type TestObject } from './settings-support.ts';
import { trpc, uuid } from './slice3-support.ts';
import { showAllSidebarObjects, signIn, submitSignIn } from './support.ts';

const SLUG = 'e2e_perm';
const PLURAL = '[e2e] Permissions';
const settings = (path: string) => `/${WORKSPACE_SLUG}/settings/${path}`;
const objectPage = `/${WORKSPACE_SLUG}/custom/${SLUG}`;
const permissionsTab = settings(`data/objects/${SLUG}/permissions`);

let adminContext: BrowserContext;
let admin: Page;
let reader: MemberSession;
let obj: TestObject;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  adminContext = await browser.newContext({
    viewport: { width: 1512, height: 945 },
    locale: 'en-US',
    reducedMotion: 'reduce',
  });
  admin = await adminContext.newPage();
  await admin.goto(`/auth/sign-in?origin=${encodeURIComponent(`/${WORKSPACE_SLUG}/home`)}`);
  await submitSignIn(admin);
  await admin.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  obj = await createTestObject(admin, SLUG, PLURAL);
  reader = await newMember(browser, admin, { email: 'perm-reader@example.com', name: 'Perry Reader' });
});

test.afterAll(async () => {
  try {
    await trpc(admin, 'schema.objects.archive', { entityDefinitionId: obj.id });
  } catch {
    // the object may already be gone
  }
  await reader?.context.close();
  await adminContext?.close();
});

// ---- helpers ------------------------------------------------------------------------------------------------------

/** Opens the level menu of a Permissions-tab row (by its accessible name prefix) and picks a level. */
async function setLevel(page: Page, row: string, level: string) {
  await page.getByRole('button', { name: new RegExp(`^${row}:`) }).click();
  const put = page.waitForResponse((r) => r.url().includes('permissions.put') && r.ok());
  await page.getByRole('menuitemradio', { name: new RegExp(`^${level}`) }).click();
  await put;
}

async function cell(page: Page, column: string, row = 0) {
  const index = await page.locator('[role="columnheader"]', { hasText: column }).first().getAttribute('aria-colindex');
  return page.locator(`[role="row"][aria-rowindex="${row + 2}"] [role="gridcell"][aria-colindex="${index}"]`);
}

const sidebarRecords = (page: Page) => page.locator('aside').first().getByRole('region', { name: 'Records' });

// ---- acceptance 2: Read only ----------------------------------------------------------------------------------------

test('Read only: the workspace level is set in the Permissions tab; members cannot open cell editors; the API says 403', async () => {
  await admin.goto(permissionsTab);
  await expect(admin.getByTestId('permissions-tab')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Workspace access: Read and write' })).toBeVisible();
  // The creator has Full access as an individual member row.
  await expect(admin.getByTestId('grant-row').filter({ hasText: 'Ada Tester' })).toContainText('Full access');
  await setLevel(admin, 'Workspace access', 'Read only');
  await expect(admin.getByRole('button', { name: 'Workspace access: Read only' })).toBeVisible();

  const p = reader.page;
  await p.goto(objectPage);
  await showAllSidebarObjects(p);
  await expect(p.getByTestId('object-page')).toBeVisible();
  await expect(sidebarRecords(p).getByRole('link', { name: PLURAL })).toBeVisible();
  await expect(p.getByTestId('read-only-badge')).toBeVisible();
  await expect(p.getByTestId('view-bar').getByRole('button', { name: 'New [e2e] Permission' })).toBeDisabled();
  await expect(p.getByTestId('record-table').getByRole('button', { name: 'New [e2e] Permission' })).toHaveCount(0);
  const headcount = await cell(p, 'Headcount');
  await expect(headcount).toHaveText('20');
  await headcount.click();
  await expect(p.getByTestId('active-cell')).toBeVisible();
  await p.keyboard.type('7');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await expect(p.getByRole('textbox', { name: 'Headcount' })).toHaveCount(0);
  await expect(headcount).toHaveText('20');
  await headcount.dblclick();
  await expect(p.getByRole('textbox', { name: 'Headcount' })).toHaveCount(0);

  // The record page: fields are not editable.
  await p.goto(`/${WORKSPACE_SLUG}/custom/${SLUG}/record/${obj.recordId}`);
  await expect(p.getByTestId('record-header')).toBeVisible();
  await p.getByRole('button', { name: 'Headcount value' }).click();
  await p.waitForTimeout(300);
  await expect(p.getByRole('textbox', { name: 'Headcount' })).toHaveCount(0);

  // The API refuses writes with Attio's 403 and the same message.
  await expect(
    trpc(p, 'records.put', { entityDefinitionId: obj.id, entityInstanceId: uuid(), values: {} }),
  ).rejects.toThrow(/403/);
  await expect(
    trpc(p, 'values.put', {
      entityDefinitionId: obj.id,
      entityInstanceId: obj.recordId,
      attributeDefinitionId: obj.headcountId,
      attributeValueId: uuid(),
      value: 3,
    }),
  ).rejects.toThrow(/403.*permission/s);
});

// ---- acceptance 3: team + workspace → the more permissive ---------------------------------------------------------------

test('a team grant and the workspace grant resolve to the more permissive level (⚠ hint on a lower individual grant)', async () => {
  const { team } = await trpc<{ team: { id: string } }>(admin, 'teams.create', {
    id: uuid(),
    name: '[e2e] Editors',
    description: '',
  });
  await trpc(admin, 'teams.addMembers', { teamId: team.id, memberIds: [reader.memberId] });

  await admin.goto(permissionsTab);
  await admin.getByRole('button', { name: 'Add Teams' }).click();
  await admin.getByRole('menuitem', { name: '[e2e] Editors' }).click();
  const teamRow = admin.getByTestId('grant-row').filter({ hasText: '[e2e] Editors' });
  // A new team row starts at the workspace level (a no-op override).
  await expect(teamRow.getByRole('button', { name: /\[e2e\] Editors: Read only/ })).toBeVisible();
  await setLevel(admin, '\\[e2e\\] Editors', 'Read and write');
  await expect(teamRow).toContainText('Read and write');

  // An individual row below what the member inherits shows the inherited level with the ⚠ and the hint.
  await admin.getByRole('button', { name: 'Add Individual members' }).click();
  await admin.getByRole('menuitem', { name: /Perry Reader/ }).click();
  const memberRow = admin.getByTestId('grant-row').filter({ hasText: 'Perry Reader' });
  const level = memberRow.getByRole('button', { name: /Perry Reader: Read and write/ });
  await expect(level).toBeVisible();
  await level.hover();
  await expect(admin.getByRole('tooltip')).toContainText('Inheriting "Read and write" from the "[e2e] Editors" team');

  // The member can edit now (workspace Read only + team Read and write).
  const p = reader.page;
  await p.goto(objectPage);
  await expect(p.getByTestId('read-only-badge')).toHaveCount(0);
  await expect(p.getByTestId('view-bar').getByRole('button', { name: 'New [e2e] Permission' })).toBeEnabled();
  const headcount = await cell(p, 'Headcount');
  await headcount.click();
  await p.keyboard.type('25');
  await p.keyboard.press('Enter');
  await expect(headcount).toHaveText('25');
  await p.reload();
  await expect(await cell(p, 'Headcount')).toHaveText('25');
});

// ---- acceptance 2: No access -------------------------------------------------------------------------------------------

test('No access: the object leaves the sidebar and its URL shows the no-access page; admins can add themselves', async () => {
  await admin.goto(permissionsTab);
  // Remove the team and the member override, then the workspace goes to No access.
  const teamRow = admin.getByTestId('grant-row').filter({ hasText: '[e2e] Editors' });
  await teamRow.getByRole('button').click();
  await admin.getByRole('menuitemradio', { name: /^Remove/ }).click();
  await expect(teamRow).toHaveCount(0);
  const memberRow = admin.getByTestId('grant-row').filter({ hasText: 'Perry Reader' });
  await memberRow.getByRole('button').click();
  await admin.getByRole('menuitemradio', { name: /^Remove/ }).click();
  await expect(memberRow).toHaveCount(0);
  await setLevel(admin, 'Workspace access', 'No access');

  const p = reader.page;
  await p.goto(`/${WORKSPACE_SLUG}/home`);
  await expect(p.locator('aside').first().getByRole('region', { name: 'Records' })).toBeVisible();
  await expect(sidebarRecords(p).getByRole('link', { name: PLURAL })).toHaveCount(0);
  await p.goto(objectPage);
  await expect(p.getByTestId('no-access')).toBeVisible();
  await expect(p.getByText("You don't have access to this object")).toBeVisible();
  await expect(p.getByTestId('object-page')).toHaveCount(0);
  await expect(trpc(p, 'schema.objects.get', { entityDefinitionId: obj.id })).rejects.toThrow(/403/);

  // The admin still has the Full access of the creator; without it, admins add themselves (OQ-067).
  const own = admin.getByTestId('grant-row').filter({ hasText: 'Ada Tester' });
  await own.getByRole('button').click();
  await admin.getByRole('menuitemradio', { name: /^Remove/ }).click();
  await expect(own).toHaveCount(0);
  await admin.goto(objectPage);
  await expect(admin.getByTestId('no-access')).toBeVisible();
  await admin.getByRole('button', { name: 'Add yourself to object' }).click();
  await expect(admin.getByTestId('object-page')).toBeVisible();
  // Back to the default for the next tests: the workspace edits records again.
  await admin.goto(permissionsTab);
  await setLevel(admin, 'Workspace access', 'Read and write');
});

// ---- acceptance 4: rules ---------------------------------------------------------------------------------------------

test('a rule violation holds the write and shows the rule message; the ninth rule is refused', async () => {
  await admin.goto(settings(`data/objects/${SLUG}/rules`));
  await expect(admin.getByText('Requirement rules', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Add rule' }).first().click();
  const dialog = admin.getByRole('dialog', { name: 'Add rule' });
  await dialog.getByLabel('Name').fill('Headcount rule');

  // Condition: If Summary is not empty.
  await dialog.getByRole('button', { name: 'Add condition' }).click();
  await admin.getByPlaceholder('Search attributes...').fill('Summary');
  await admin
    .getByRole('option', { name: /Summary/ })
    .first()
    .click();
  await admin.getByRole('menuitem', { name: 'not empty' }).click();

  // Requirement: Then Headcount must be greater than 10.
  await dialog.getByRole('button', { name: 'Requirement attribute' }).click();
  await admin.getByRole('menuitemradio', { name: 'Headcount' }).click();
  await dialog.getByRole('button', { name: 'Requirement operator' }).click();
  await admin.getByRole('menuitemradio', { name: 'must be greater than' }).click();
  await dialog.getByRole('button', { name: 'Requirement value' }).click();
  await admin.getByPlaceholder('enter number...').fill('10');
  await admin.keyboard.press('Enter');
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(dialog).toBeHidden();
  const row = admin.getByTestId('rule-row').filter({ hasText: 'Headcount rule' });
  await expect(row).toContainText('All members');
  await expect(admin.getByRole('tab', { name: /Rules/ })).toContainText('1');

  // The member's write below 10 is held: the message names the rule and the requirement, Discard restores the value.
  const p = reader.page;
  await trpc(admin, 'permissions.put', {
    resourceKind: 'object',
    resourceId: obj.id,
    target: { type: 'workspace' },
    level: 'read-write',
  });
  await p.goto(objectPage);
  const headcount = await cell(p, 'Headcount');
  await expect(headcount).toHaveText('25');
  await headcount.click();
  await p.keyboard.type('5');
  await p.keyboard.press('Enter');
  const violation = p.getByRole('dialog', { name: 'Updates required' });
  await expect(violation).toBeVisible();
  await expect(violation.getByTestId('rule-violations')).toContainText('Headcount rule');
  await expect(violation.getByTestId('rule-violations')).toContainText('Headcount: Must be greater than 10');
  await expect(headcount).toHaveText('5'); // the proposed value stays visible while held
  await violation.getByRole('button', { name: 'Discard change' }).click();
  await expect(violation).toBeHidden();
  await expect(headcount).toHaveText('25');

  // A value that meets the rule saves.
  await headcount.dblclick();
  await p.keyboard.press('ControlOrMeta+a');
  await p.keyboard.type('30');
  await p.keyboard.press('Enter');
  await expect(headcount).toHaveText('30');
  await expect(p.getByRole('dialog', { name: 'Updates required' })).toHaveCount(0);

  // Eight rules per object: the ninth is refused with the limit message.
  for (let i = 2; i <= 8; i++) {
    await trpc(admin, 'rules.create', {
      id: uuid(),
      entityDefinitionId: obj.id,
      name: `Rule ${i}`,
      condition: null,
      requirements: [{ id: uuid(), attributeDefinitionId: obj.summaryId, operator: 'required' }],
    });
  }
  await admin.reload();
  await expect(admin.getByRole('tab', { name: /Rules/ })).toContainText('8');
  await admin.getByRole('button', { name: 'Add rule' }).click();
  const ninth = admin.getByRole('dialog', { name: 'Add rule' });
  await ninth.getByLabel('Name').fill('Ninth rule');
  await ninth.getByRole('button', { name: 'Requirement attribute' }).click();
  await admin.getByRole('menuitemradio', { name: 'Summary' }).click();
  await ninth.getByRole('button', { name: /^Save/ }).click();
  await expect(ninth.getByRole('alert')).toContainText(
    'You’ve reached the limit of 8 requirement rules for this object.',
  );
  await admin.keyboard.press('Escape');
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();

  // Edit and delete work from the list.
  await admin.getByTestId('rule-row').filter({ hasText: 'Rule 2' }).click();
  const edit = admin.getByRole('dialog', { name: 'Edit rule' });
  await expect(edit.getByLabel('Name')).toHaveValue('Rule 2');
  await edit.getByLabel('Name').fill('Rule two');
  await edit.getByRole('button', { name: /^Save/ }).click();
  await expect(admin.getByTestId('rule-row').filter({ hasText: 'Rule two' })).toBeVisible();
  const two = admin.getByTestId('rule-row').filter({ hasText: 'Rule two' });
  await two.getByRole('button', { name: 'Options' }).click();
  await admin.getByRole('menuitem', { name: 'Delete' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(two).toHaveCount(0);
  await expect(admin.getByRole('tab', { name: /Rules/ })).toContainText('7');

  // Rules apply to member writes (UI and internal API) and are not part of the webhook test below.
  const rules = await trpc<{ id: string }[]>(admin, 'rules.list', { entityDefinitionId: obj.id });
  for (const rule of rules) await trpc(admin, 'rules.delete', { ruleId: rule.id });
});

// ---- acceptance 5: tokens and webhooks --------------------------------------------------------------------------------

test('tokens and webhooks: a token created once; a webhook with a test delivery and deliveries after UI and /v2 creates', async () => {
  await admin.goto(settings('developers'));
  await expect(admin).toHaveURL(new RegExp('/settings/developers/access-tokens$'));
  await expect(admin.getByRole('heading', { name: 'Access tokens', level: 2 })).toBeVisible();
  await admin.getByRole('button', { name: 'New access token' }).click();
  const tokenDialog = admin.getByRole('dialog', { name: 'New access token' });
  await tokenDialog.getByRole('button', { name: 'Save' }).click();
  await expect(tokenDialog.getByText("Name can't be empty")).toBeVisible();
  await tokenDialog.getByLabel('Name').fill('e2e token');
  await tokenDialog.getByRole('button', { name: 'Save' }).click();
  await expect(tokenDialog.getByRole('alert')).toContainText('Please select at least one scope');
  await tokenDialog.getByTestId('scope-record_permission').getByRole('button').click();
  await admin.getByRole('option', { name: 'Read-write' }).click();
  await tokenDialog.getByTestId('scope-object_configuration').getByRole('button').click();
  await admin.getByRole('option', { name: 'Read', exact: true }).click();
  await tokenDialog.getByRole('button', { name: 'Save' }).click();
  const created = admin.getByRole('dialog', { name: 'Access token created' });
  const secret = (await created.getByTestId('new-token-secret').textContent()) ?? '';
  expect(secret).toMatch(/^[0-9a-f]{64}$/);
  await created.getByRole('button', { name: 'Done' }).click();
  const card = admin.getByTestId('token-card').filter({ hasText: 'e2e token' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Show access token' }).click();
  await expect(card.getByTestId('token-secret')).toHaveText(secret);

  // Edit the scopes.
  await card.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = admin.getByRole('dialog', { name: 'Edit access token' });
  await expect(edit.getByLabel('Name')).toHaveValue('e2e token');
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // Webhook: https only, at least one event.
  await admin.getByRole('tab', { name: 'Webhooks' }).click();
  await expect(admin).toHaveURL(new RegExp('/settings/developers/webhooks$'));
  await admin.getByRole('button', { name: 'Create webhook' }).first().click();
  const hook = admin.getByRole('dialog', { name: 'New webhook' });
  await hook.getByLabel('Target URL').fill('http://insecure.example.test/hook');
  await hook.getByRole('button', { name: 'Save' }).click();
  await expect(hook.getByText('Must provide secure URL')).toBeVisible();
  await hook.getByLabel('Target URL').fill('https://hooks.example.test/e2e');
  await hook.getByRole('button', { name: 'Save' }).click();
  await expect(hook.getByRole('alert')).toContainText('Must have at least one event');
  await hook.getByRole('button', { name: 'Events' }).click();
  await admin.getByPlaceholder('Search events').fill('record.created');
  await admin.getByRole('menuitemcheckbox', { name: 'record.created' }).click();
  await expect(hook.getByRole('listitem').filter({ hasText: 'record.created' })).toBeVisible();
  await hook.getByRole('button', { name: 'Save' }).click();
  const secretDialog = admin.getByRole('dialog', { name: 'Webhook secret' });
  await expect(secretDialog.getByTestId('webhook-secret')).toHaveText(/^[0-9a-f]{64}$/);
  await secretDialog.getByRole('button', { name: 'Done' }).click();
  const webhook = admin.getByTestId('webhook-card').filter({ hasText: 'https://hooks.example.test/e2e' });
  await expect(webhook).toContainText('Active');

  // Test subscription: a test delivery is attempted and visible in the deliveries log.
  await webhook.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Test subscription' }).click();
  await expect(admin.getByText(/Test delivery/)).toBeVisible();
  await webhook.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Deliveries' }).click();
  const deliveries = admin.getByRole('dialog', { name: 'Deliveries' });
  await expect(deliveries.getByTestId('delivery-row').filter({ hasText: 'Test' })).toContainText('record.created');
  await deliveries.getByRole('button', { name: 'Done' }).click();

  // A UI create and a /v2 create both reach the webhook (the worker turns the domain events into deliveries).
  await admin.goto(objectPage);
  await admin.getByTestId('view-bar').getByRole('button', { name: 'New [e2e] Permission' }).click();
  const create = admin.getByRole('dialog', { name: 'Create [e2e] Permission' });
  await create.getByRole('textbox', { name: 'Summary' }).fill('Created from the UI');
  await create.getByRole('button', { name: 'Create record' }).click();
  await expect(create).toBeHidden();
  const api = await admin.request.post(`${WEB_ORIGIN}/v2/objects/${SLUG}/records`, {
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    data: { data: { values: { summary: [{ value: 'Created from /v2' }] } } },
  });
  expect(api.status()).toBe(200);

  await admin.goto(settings('developers/webhooks'));
  await admin
    .getByTestId('webhook-card')
    .filter({ hasText: 'https://hooks.example.test/e2e' })
    .getByRole('button', { name: 'More' })
    .click();
  await admin.getByRole('menuitem', { name: 'Deliveries' }).click();
  const log = admin.getByRole('dialog', { name: 'Deliveries' });
  await expect
    .poll(async () => log.getByTestId('delivery-row').filter({ hasNotText: 'Test' }).count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  await log.getByTestId('delivery-row').filter({ hasNotText: 'Test' }).first().click();
  await expect(log.locator('pre')).toContainText('record.created');
  await log.getByRole('button', { name: 'Done' }).click();

  // Show secret again, deactivate, delete.
  const first = admin.getByTestId('webhook-card').filter({ hasText: 'https://hooks.example.test/e2e' });
  await first.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Show secret' }).click();
  await expect(admin.getByRole('dialog', { name: 'Webhook secret' }).getByTestId('webhook-secret')).toHaveText(
    /^[0-9a-f]{64}$/,
  );
  await admin.getByRole('dialog', { name: 'Webhook secret' }).getByRole('button', { name: 'Done' }).click();
  await first.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Deactivate' }).click();
  await expect(first).toContainText('Inactive');
  await first.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Delete' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete webhook' }).click();
  await expect(first).toHaveCount(0);

  // Delete the token: the API key stops working.
  await admin.getByRole('tab', { name: 'Access tokens' }).click();
  const tokenCard = admin.getByTestId('token-card').filter({ hasText: 'e2e token' });
  await tokenCard.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('menuitem', { name: 'Delete' }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Delete access token' }).click();
  await expect(tokenCard).toHaveCount(0);
  const revoked = await admin.request.get(`${WEB_ORIGIN}/v2/self`, { headers: { authorization: `Bearer ${secret}` } });
  expect(revoked.status()).toBe(200);
  expect(((await revoked.json()) as { active: boolean }).active).toBe(false);
});

test('sign-in still works for the admin after all of that', async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Ada\.$/);
});
