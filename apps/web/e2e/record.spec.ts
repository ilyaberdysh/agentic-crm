// Record page (BACKLOG §3: 3.01–3.11; acceptance 4 and 5): routes and tabs, inline editing with activity (actor and
// new value), activity filters, the resizable details panel, rename, favorites, relationship tabs, files, merge with
// the merged-away state, delete, the overlay from a view with J/K, the layout editor (full-replace save) and the
// record shortcuts.
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { findProject, findRecord, recordPath, trpc } from './record-support.ts';
import { signIn } from './support.ts';
import { createSeedView } from './views-support.ts';

test.describe.configure({ mode: 'serial' });

const details = (page: Page) => page.getByTestId('details-panel');
const tabs = (page: Page) => page.getByTestId('record-tabs');
const attributeValue = (page: Page, slug: string) =>
  details(page).locator(`[data-attribute="${slug}"] [data-testid="attribute-value"]`);

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('record-page')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('ar:sidebar-collapsed', 'true'));
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
});

test('routes: a bare record URL and an unknown tab land on Overview; tabs navigate, ⌥→ / ⌥← wrap', async ({ page }) => {
  const company = await findRecord(page, '[seed] Bluefin Analytics');
  await page.goto(`/${WORKSPACE_SLUG}/company/${company.entityInstanceId}`);
  await expect(page).toHaveURL(new RegExp(`/company/${company.entityInstanceId}/overview$`));
  await expect(page.getByTestId('record-title')).toHaveText('[seed] Bluefin Analytics');
  await expect(page.getByTestId('highlights')).toBeVisible();

  await page.goto(`/${WORKSPACE_SLUG}/company/${company.entityInstanceId}/nope`);
  await expect(page).toHaveURL(/\/overview$/);

  await tabs(page)
    .getByRole('tab', { name: /Activity/ })
    .click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByTestId('activity-tab')).toBeVisible();
  await page.locator('body').click({ position: { x: 900, y: 600 } });
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page).toHaveURL(/\/emails$/);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(/\/overview$/);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page).toHaveURL(/\/files$/);
  await expect(page.getByTestId('files-tab')).toBeVisible();
});

test('an inline edit shows "Validating change", lands in Activity with actor and new value; filters hide updates', async ({
  page,
}) => {
  const company = await findRecord(page, '[seed] Cedar Health');
  await open(page, recordPath('company', company.entityInstanceId));
  const text = `Clinic scheduling ${randomUUID().slice(0, 6)}`;
  const before = (await attributeValue(page, 'description').innerText()).trim();
  // Hold the value write so the pending indicator is observable.
  await page.route(
    (url) => url.pathname.startsWith('/trpc/') && url.pathname.includes('values.'),
    async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    },
  );
  await attributeValue(page, 'description').click();
  const editor = page.getByRole('textbox', { name: 'Description' });
  await editor.fill(text);
  await editor.press('Enter');
  await expect(attributeValue(page, 'description')).toContainText(text);
  await expect(page.getByTestId('validating-change')).toBeVisible();
  await expect(page.getByTestId('validating-change')).toHaveCount(0, { timeout: 10_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await tabs(page)
    .getByRole('tab', { name: /Activity/ })
    .click();
  // Changes by the same member within 15 minutes read as one event ("changed 3 attributes"): the new value shows
  // inline for a single change, in the popover table otherwise.
  const event = page.locator('[data-testid="activity-event"][data-event-type="attribute-values-updated"]').first();
  await expect(event).toContainText('Ada Tester');
  await expect(event).toContainText('changed');
  const inline = await event.innerText();
  if (inline.includes(text)) {
    await expect(event).toContainText('Description');
    // Old value on hover of the new one.
    if (before && !before.startsWith('Set ')) {
      await expect(event.locator('[data-previous]')).toHaveAttribute('data-previous', before);
    }
  } else {
    await event.getByTestId('changed-attributes').click();
    const table = page.getByRole('dialog', { name: 'Changed attributes' });
    await expect(table).toContainText('Description');
    await expect(table).toContainText(text);
    await page.keyboard.press('Escape');
  }

  // Filters → Updates off: attribute changes and "created" disappear; the choice persists per object.
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('dialog', { name: 'Visible events' }).getByText('Updates', { exact: true }).click();
  await page.keyboard.press('Escape');
  const updates = page.locator('[data-testid="activity-event"][data-event-type="attribute-values-updated"]');
  await expect(page.getByTestId('filters-dot')).toBeVisible();
  await expect(updates).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('activity-tab')).toBeVisible();
  await expect(page.getByTestId('filters-dot')).toBeVisible();
  await expect(updates).toHaveCount(0);
  const stored = await page.evaluate(
    (id) => localStorage.getItem(`ar:activity-timeline-visible-events:${id}`),
    company.entityDefinitionId,
  );
  expect(JSON.parse(stored ?? '[]')).not.toContain('updates');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('dialog', { name: 'Visible events' }).getByText('Updates', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filters-dot')).toHaveCount(0);
  await expect(updates.first()).toBeVisible();
});

test('details panel: 30 % default, drag resizes and persists per object, double-click resets', async ({ page }) => {
  const company = await findRecord(page, '[seed] Orbit Logistics');
  await open(page, recordPath('company', company.entityInstanceId));
  const panel = details(page);
  const body = await page.getByTestId('record-page').boundingBox();
  const start = (await panel.boundingBox())?.width ?? 0;
  expect(Math.abs(start - 0.3 * (body?.width ?? 0))).toBeLessThan(3);
  const handle = page.getByTestId('panel-resize');
  const box = (await handle.boundingBox()) as { x: number; y: number; width: number; height: number };
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())?.width ?? 0).toBeGreaterThan(start + 100);
  const key = `ar:record-page-attribute-panel-width:${company.entityDefinitionId}`;
  const saved = Number(await page.evaluate((k) => localStorage.getItem(k), key));
  expect(saved).toBeGreaterThan(35);
  await page.reload();
  await expect.poll(async () => (await details(page).boundingBox())?.width ?? 0).toBeGreaterThan(start + 100);
  await page.getByTestId('panel-resize').dblclick();
  await expect.poll(async () => Math.round((await details(page).boundingBox())?.width ?? 0)).toBe(Math.round(start));
  expect(Number(await page.evaluate((k) => localStorage.getItem(k), key))).toBe(30);
});

test('header: inline rename (Esc cancels, Enter saves), favourite star, Edit record modal, View all values', async ({
  page,
}) => {
  const company = await findRecord(page, '[seed] Quartz Studio');
  await open(page, recordPath('company', company.entityInstanceId));
  // The title renames once the object's attributes are loaded (the name attribute is known).
  await expect(page.getByTestId('record-title')).not.toHaveAttribute('data-readonly', '');
  await page.getByTestId('record-title').click();
  const input = page.getByPlaceholder('Enter company name...');
  await input.fill('Discarded');
  await input.press('Escape');
  await expect(page.getByTestId('record-title')).toHaveText('[seed] Quartz Studio');
  await page.getByTestId('record-title').click();
  await page.getByPlaceholder('Enter company name...').fill('[seed] Quartz Studio Ltd');
  await page.getByPlaceholder('Enter company name...').press('Enter');
  await expect(page.getByTestId('record-title')).toHaveText('[seed] Quartz Studio Ltd');
  await expect(page.getByTestId('page-header')).toContainText('[seed] Quartz Studio Ltd');
  // restore
  await page.getByTestId('record-title').click();
  await page.getByPlaceholder('Enter company name...').fill('[seed] Quartz Studio');
  await page.getByPlaceholder('Enter company name...').press('Enter');
  await expect(page.getByTestId('record-title')).toHaveText('[seed] Quartz Studio');

  // The header star (features/favorites): toggles the member's favourite of the record.
  const star = page.getByTestId('record-header').getByTestId('favorite-star');
  const isFavorite = async () => {
    const favorites = await trpc<{ favorites: { targetId: string }[] }>(page, 'favorites.list', {});
    return favorites.favorites.some((f) => f.targetId === company.entityInstanceId);
  };
  if ((await star.getAttribute('aria-label')) === 'Remove from favorites') {
    await star.click();
    await expect.poll(isFavorite).toBe(false);
  }
  await expect(star).toHaveAttribute('aria-label', 'Add to favorites');
  await star.click();
  await expect(star).toHaveAttribute('aria-label', 'Remove from favorites');
  await expect.poll(isFavorite).toBe(true);
  await star.click();
  await expect(star).toHaveAttribute('aria-label', 'Add to favorites');
  await expect.poll(isFavorite).toBe(false);

  await page.getByRole('button', { name: 'Edit record' }).click();
  const modal = page.getByRole('dialog', { name: 'Edit Company' });
  await expect(modal).toContainText('Viewing all of the record details for');
  await expect(modal.getByText('Domains (optional)')).toBeVisible();
  // Fields edit in place with the same editors; the modal stays open.
  const description = `Design agency ${randomUUID().slice(0, 4)}`;
  await modal.locator('[data-attribute="description"] [data-testid="attribute-value"]').click();
  await page.getByRole('textbox', { name: 'Description' }).fill(description);
  await page.getByRole('textbox', { name: 'Description' }).press('Enter');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-attribute="description"]')).toContainText(description);
  await expect(attributeValue(page, 'description')).toContainText(description);
  await modal.getByRole('button', { name: /Finished editing/ }).click();
  await expect(modal).toHaveCount(0);

  await details(page).getByRole('button', { name: 'View all values' }).click();
  await expect(page.getByTestId('view-all-values')).toBeVisible();
  await page.getByPlaceholder('Search attributes...').fill('twiter');
  await expect(page.getByTestId('view-all-values').getByTestId('attribute-row')).toHaveCount(2);
  await page.getByPlaceholder('Search attributes...').fill('zzzz');
  await expect(page.getByText('No attributes found')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('details-section')).toBeVisible();
});

test('relationship tab: related rows, bulk Unassociate, Add back', async ({ page }) => {
  const company = await findRecord(page, '[seed] Bluefin Analytics');
  await open(page, recordPath('company', company.entityInstanceId, 'team'));
  const rows = page.getByTestId('related-row');
  await expect(rows).toHaveCount(2);
  const cameron = rows.filter({ hasText: 'Cameron Williamson' });
  await cameron.getByRole('checkbox').click();
  const bar = page.getByTestId('relationship-bulk-bar');
  await expect(bar).toContainText('1');
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Unassociate Person' }).click();
  await expect(rows).toHaveCount(1);
  await expect(tabs(page).getByRole('tab', { name: /Team/ })).toContainText('1');

  await page.getByRole('button', { name: 'Add Person' }).click();
  await page.getByPlaceholder('Find a person...').fill('Cameron');
  await page.getByRole('option', { name: /Cameron Williamson/ }).click();
  await expect(rows).toHaveCount(2);
});

test('files: new folder, upload, lightbox, delete', async ({ page }) => {
  const company = await findRecord(page, '[seed] Pinecone Labs');
  await open(page, recordPath('company', company.entityInstanceId, 'files'));
  await expect(page.getByText('Drag a file here or choose one from your computer.')).toBeVisible();
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByPlaceholder('Enter Name').fill('Contracts');
  await page.getByPlaceholder('Enter Name').press('Enter');
  await expect(page.getByText('Folder created')).toBeVisible();
  await expect(page.getByTestId('file-row').filter({ hasText: 'Contracts' })).toBeVisible();

  await page.getByTestId('file-input').setInputFiles({
    name: 'brief.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello from the files tab'),
  });
  await expect(page.getByText('File uploaded successfully')).toBeVisible();
  const file = page.getByTestId('file-row').filter({ hasText: 'brief.txt' });
  await expect(file).toContainText('(24 bytes)');
  await file.click();
  await expect(page.getByTestId('file-lightbox')).toBeVisible();
  await page.getByTestId('file-lightbox').getByRole('button', { name: 'Close' }).click();
  await file.getByRole('button', { name: 'File options' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(file).toHaveCount(0);
});

test('merge (acceptance 4): the priority record wins, the new record opens, old URLs show "Go to record"', async ({
  page,
}) => {
  const people = await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: 'people' });
  const tag = randomUUID().slice(0, 6);
  const alpha = randomUUID();
  const beta = randomUUID();
  const person = (first: string, email: string) => ({
    name: [{ value: { firstName: first, lastName: tag, fullName: `${first} ${tag}` } }],
    email_addresses: [{ value: email }],
  });
  await trpc(page, 'records.put', {
    entityDefinitionId: people.id,
    entityInstanceId: alpha,
    values: person('Alpha', `alpha-${tag}@example.com`),
  });
  await trpc(page, 'records.put', {
    entityDefinitionId: people.id,
    entityInstanceId: beta,
    values: person('Beta', `beta-${tag}@example.com`),
  });
  await open(page, recordPath('person', beta));
  await page.getByRole('button', { name: 'Record actions' }).click();
  await page.getByRole('menuitem', { name: 'Merge records' }).click();
  const modal = page.getByRole('dialog', { name: 'Merge records' });
  await expect(modal).toContainText('the second selected record holds higher priority');
  await expect(modal.getByRole('button', { name: /Merge records/ })).toBeDisabled();
  await modal.getByRole('button', { name: 'Find Record' }).click();
  await page.getByPlaceholder('Search...').fill(`Alpha ${tag}`);
  await page.getByRole('option', { name: new RegExp(`Alpha ${tag}`) }).click();
  await expect(page.getByTestId('merge-left')).toContainText(`Alpha ${tag}`);
  await expect(page.getByTestId('merge-result')).toContainText(`Beta ${tag}`);
  await modal.getByRole('button', { name: /Merge records/ }).click();
  await expect(page.getByText('Records merged successfully')).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(beta));
  await expect(page.getByTestId('record-title')).toHaveText(`Beta ${tag}`);
  const mergedUrl = page.url();
  await expect(attributeValue(page, 'email_addresses')).toContainText(`beta-${tag}@example.com`);

  await page.goto(recordPath('person', alpha));
  await expect(page.getByTestId('record-state')).toHaveAttribute('data-state', 'merged');
  await expect(page.getByText('has been merged with another record')).toBeVisible();
  await page.getByRole('button', { name: 'Go to record' }).click();
  await expect(page).toHaveURL(mergedUrl);
  await tabs(page)
    .getByRole('tab', { name: /Activity/ })
    .click();
  await expect(page.getByTestId('activity-event').filter({ hasText: 'merged 2 duplicate records' })).toBeVisible();
});

test('delete: confirm, back to the views, the URL then shows "This record cannot be found"', async ({ page }) => {
  const people = await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: 'people' });
  const id = randomUUID();
  await trpc(page, 'records.put', {
    entityDefinitionId: people.id,
    entityInstanceId: id,
    values: { name: [{ value: { firstName: 'Temp', lastName: 'Delete', fullName: 'Temp Delete' } }] },
  });
  await open(page, recordPath('person', id));
  await page.getByRole('button', { name: 'Record actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete record' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete person');
  await expect(dialog).toContainText('will delete associated notes and tasks');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/people`));
  await page.goto(recordPath('person', id));
  await expect(page.getByText('This record cannot be found')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
});

test('overlay from a view (E4): the record page inside, "1 of N", J / K, tabs, Esc; preview drawer from a row', async ({
  page,
}) => {
  const view = { ...(await createSeedView(page)), title: '[seed] All projects' };
  const viewUrl = `/${WORKSPACE_SLUG}/custom/projects/view/${view.id}`;
  await page.goto(viewUrl);
  const first = page.locator('[role="row"][aria-rowindex="2"]');
  await expect(first).toBeVisible();
  const firstId = await first.getAttribute('data-record-id');
  const secondId = await page.locator('[role="row"][aria-rowindex="3"]').getAttribute('data-record-id');
  await first.locator('a').first().click();
  const overlay = page.getByTestId('record-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByTestId('record-page')).toHaveAttribute('data-record-id', firstId ?? '');
  await expect(page).toHaveURL(new RegExp(`[?&]modal=record&id=${firstId}`));
  const nav = page.getByTestId('record-overlay-nav');
  await expect(nav).toContainText(/1 of \d+ in /);
  await expect(nav).toContainText(view.title);
  // Tabs switch inside the overlay and stay while stepping with J / K; record shortcuts work there too.
  await overlay
    .getByTestId('record-tabs')
    .getByRole('tab', { name: /Activity/ })
    .click();
  await expect(overlay.getByTestId('activity-tab')).toBeVisible();
  await overlay.getByTestId('activity-tab').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('j');
  await expect(overlay.getByTestId('record-page')).toHaveAttribute('data-record-id', secondId ?? '');
  await expect(nav).toContainText(/2 of /);
  await expect(overlay.getByTestId('activity-tab')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(overlay.getByTestId('overview-tab')).toBeVisible();
  await page.keyboard.press('k');
  await expect(nav).toContainText(/1 of /);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(viewUrl);
  await expect(overlay).toHaveCount(0);

  const row = page.locator('[role="row"][aria-rowindex="3"]');
  await row.hover();
  await row.getByRole('button', { name: 'Open preview' }).click();
  const preview = page.getByTestId('record-preview');
  await expect(preview).toContainText('2 of');
  await expect(page).toHaveURL(viewUrl);
  await preview.getByRole('button', { name: 'Next record' }).click();
  await expect(preview).toContainText('3 of');
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toHaveCount(0);
});

test('layout editor: Configure page → add a tab, Save (full replace), the record page shows it; remove again', async ({
  page,
}) => {
  const project = await findProject(page, 'SEED-003');
  await open(page, recordPath('projects', project.entityInstanceId));
  await page.getByRole('button', { name: 'Record actions' }).click();
  await page.getByRole('menuitem', { name: 'Configure page' }).click();
  await expect(page).toHaveURL(/\/settings\/data\/objects\/projects\/record-page\/[0-9a-f-]{36}$/);
  const editor = page.getByTestId('layout-editor');
  await expect(editor).toBeVisible();
  await expect(page.getByTestId('layout-dirty-bar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add tab' }).click();
  await page.getByRole('menuitem', { name: 'Calls' }).click();
  await expect(page.getByTestId('layout-tab').filter({ hasText: 'Calls' })).toBeVisible();
  await expect(page.getByTestId('layout-dirty-bar')).toContainText('Changes will be visible to all');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your settings were saved')).toBeVisible();
  await expect(page.getByTestId('layout-dirty-bar')).toHaveCount(0);

  await open(page, recordPath('projects', project.entityInstanceId));
  await expect(tabs(page).getByRole('tab', { name: /Calls/ })).toBeVisible();
  await tabs(page).getByRole('tab', { name: /Calls/ }).click();
  await expect(page.getByText('No call recordings')).toBeVisible();

  // Remove it again (and see Cancel restore a removal first).
  const layout = await trpc<{ id: string }>(page, 'layouts.get', { entityDefinitionId: 'projects' });
  await page.goto(`/${WORKSPACE_SLUG}/settings/data/objects/projects/record-page/${layout.id}`);
  const calls = page.getByTestId('layout-tab').filter({ hasText: 'Calls' });
  await calls.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Remove tab' }).click();
  await expect(calls).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(calls).toBeVisible();
  await calls.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Remove tab' }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your settings were saved')).toBeVisible();
  const saved = await trpc<{ elements: { type: string }[] }>(page, 'layouts.get', { entityDefinitionId: 'projects' });
  expect(saved.elements.some((e) => e.type === 'call-tab')).toBe(false);
});

test('shortcuts: t opens "Create task" for the record; the task shows on the Overview', async ({ page }) => {
  const project = await findProject(page, 'SEED-005');
  await open(page, recordPath('projects', project.entityInstanceId));
  await page.locator('body').click({ position: { x: 900, y: 700 } });
  await page.keyboard.press('t');
  const dialog = page.getByTestId('task-dialog');
  await expect(dialog).toBeVisible();
  const text = `Follow up ${randomUUID().slice(0, 6)}`;
  await page.getByTestId('task-title-input').fill(text);
  await dialog.getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByTestId('overview-tasks')).toContainText(text);

  // `n`: a new note linked to the record opens in the note window; it shows in the Notes tab count.
  type NoteList = { notes: { id: string }[]; total: number };
  const before = await trpc<NoteList>(page, 'notes.list', { record: project, limit: 200, includeContent: false });
  await page.locator('body').click({ position: { x: 900, y: 700 } });
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/[?&]modal=note&id=/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/modal=note/);
  await expect(page.getByTestId('record-tabs').getByRole('tab', { name: /Notes/ })).toContainText(
    String(before.total + 1),
  );

  // Leave no extra notes / tasks behind for the notes and tasks specs.
  const seeded = new Set(before.notes.map((n) => n.id));
  const after = await trpc<NoteList>(page, 'notes.list', { record: project, limit: 200, includeContent: false });
  for (const n of after.notes.filter((n) => !seeded.has(n.id))) await trpc(page, 'notes.delete', { noteId: n.id });
  const tasks = await trpc<{ groups: { tasks: { id: string; content: { text: string } }[] }[] }>(page, 'tasks.list', {
    groupBy: 'none',
    filter: { records: { operator: 'is', records: [project] } },
  });
  for (const t of tasks.groups.flatMap((g) => g.tasks).filter((t) => t.content.text === text)) {
    await trpc(page, 'tasks.delete', { taskId: t.id });
  }
});

test('not found: an unknown record id', async ({ page }) => {
  await page.goto(recordPath('company', randomUUID()));
  await expect(page.getByText('This record cannot be found')).toBeVisible();
  await expect(page.getByText('does not exist or has been deleted')).toBeVisible();
});

test('comments: the top bar button toggles the 320 px comments panel; ?show-comments=true opens it on load', async ({
  page,
}) => {
  const company = await findRecord(page, '[seed] Helios Energy');
  await open(page, recordPath('company', company.entityInstanceId));
  await expect(page.getByTestId('record-comments-panel')).toHaveCount(0);
  await page.getByTestId('comments-toggle').click();
  const panel = page.getByTestId('record-comments-panel');
  await expect(panel).toBeVisible();
  expect(Math.round((await panel.boundingBox())?.width ?? 0)).toBe(320);
  await page.getByTestId('comments-toggle').click();
  await expect(panel).toHaveCount(0);
  await page.goto(`${recordPath('company', company.entityInstanceId)}?show-comments=true`);
  await expect(page.getByTestId('record-comments-panel')).toBeVisible();
});
