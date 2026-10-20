// Slice 5 — command palette, search, shortcuts, notifications, home (BACKLOG §5 acceptance 2–4; items 5.02–5.07).
// Runs against the e2e stack with seed-slice3 data and a second member (Grace Hopper); every test restores what it
// changes so the other specs and the parity run see the seeded state.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { addEntry, createList, deleteList, findRecord } from './lists-support.ts';
import { seedSlice3, signedInPage, trpc, uuid, ws } from './slice3-support.ts';
import {
  ada,
  memberId,
  mod,
  openPalette,
  paletteRows,
  quietClick,
  secondMember,
  signedInAs,
} from './slice5-support.ts';

let seed: ReturnType<typeof seedSlice3>;
test.beforeAll(() => {
  seed = seedSlice3();
  secondMember();
});

// Several flows per test (two signed-in members, reloads): more than the 30 s default.
test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

const palette = (page: Page) => page.getByTestId('palette');
const group = (page: Page, name: string) => palette(page).getByRole('group', { name, exact: true });
const search = (page: Page) => new URL(page.url()).searchParams;

// ---- ⌘K ------------------------------------------------------------------------------------------------------------------

test('⌘K: sections and order, Jump To, record hits with list memberships, Esc clears then closes', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  const northwind = await findRecord(page, 'companies', 'Northwind Robotics');
  const list = await createList(page, '[seed] S5 pipeline');
  await addEntry(page, list, northwind);
  await page.reload();

  await openPalette(page);
  await expect(palette(page)).toBeVisible();
  // The empty state: no Jump To, no Search; the default quick actions, then Help.
  const sections = await palette(page)
    .getByRole('group')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(sections).toEqual(['Quick Action', 'Help']);
  for (const title of ['Search records', 'Create task', 'Create note', 'Add to list', 'Note templates']) {
    await expect(paletteRows(page).filter({ hasText: title }).first()).toBeVisible();
  }
  await expect(paletteRows(page).filter({ hasText: 'Add Company' })).toBeVisible();
  await expect(paletteRows(page).filter({ hasText: 'Open help drawer' })).toBeVisible();
  await expect(page.getByTestId('palette-primary')).toContainText('Search records');

  // A seed name: record hits under "Search" with their object chip; the list membership is in the preview.
  await page.keyboard.type('northwind');
  const hit = group(page, 'Search').getByRole('option').filter({ hasText: 'Northwind Robotics' });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText('Company');
  await expect(group(page, 'Search').getByRole('option').last()).toContainText('Create "northwind" as record');
  await hit.hover(); // hovering never moves the highlight
  await expect(page.getByTestId('palette-primary')).toContainText('Open record');
  await expect(page.getByTestId('palette-preview')).toHaveAttribute('data-preview', 'record');
  await expect(page.getByTestId('palette-preview').getByTestId('preview-list-membership')).toContainText(
    '[seed] S5 pipeline',
  );

  // Jump To: lists and objects by name; ↩ opens.
  await page.getByTestId('palette-input').fill('S5 pipeline');
  await expect(group(page, 'Jump To').getByRole('option').first()).toContainText('[seed] S5 pipeline');
  await page.getByTestId('palette-input').fill('compan');
  await expect(group(page, 'Jump To').getByRole('option').first()).toContainText('Companies');
  await expect(page.getByTestId('palette-preview')).toHaveAttribute('data-preview', 'object');
  await expect(page.getByTestId('palette-preview')).toContainText('records');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/companies/view/`));

  // Esc: clears a query first, then closes.
  await openPalette(page);
  await page.keyboard.type('zzzz');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toHaveValue('');
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette(page)).toHaveCount(0);
  // ⌘K toggles: opens, closes.
  await page.keyboard.press(`${mod}+k`);
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press(`${mod}+k`);
  await expect(palette(page)).toHaveCount(0);

  await deleteList(page, list);
  await context.close();
});

test('palette search: a slow response of an older query never overwrites a newer one (requestSeq guard)', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  let slow = 0;
  const isFirstKeystroke = (body: string) => body.includes('"query":"n","requestSeq"');
  // Batches carry several procedures (`/trpc/snapshots.query,…,search.records`): match the procedure anywhere.
  await page.route(/trpc\/.*search\.records/, async (route) => {
    // The first keystroke's request is held back until after the newer ones have been answered.
    if (isFirstKeystroke(route.request().postData() ?? '')) {
      slow += 1;
      await new Promise((r) => setTimeout(r, 1800));
    }
    await route.continue();
  });
  await openPalette(page);
  const late = page.waitForResponse(
    (r) => r.url().includes('search.records') && isFirstKeystroke(r.request().postData() ?? ''),
  );
  await page.keyboard.type('northwind', { delay: 30 });
  await expect(group(page, 'Search').getByRole('option').filter({ hasText: 'Northwind Robotics' })).toBeVisible();
  const before = await palette(page).getByRole('option').allInnerTexts();
  await late; // the slow "n" answer has arrived …
  await page.waitForTimeout(400);
  const after = await palette(page).getByRole('option').allInnerTexts();
  expect(slow).toBe(1);
  expect(after).toEqual(before); // … and changed nothing
  expect(await page.getByTestId('palette-input').inputValue()).toBe('northwind');
  await context.close();
});

test('record actions: ⌘K on a result opens its Actions menu (open, copy, create task / note, merge, email)', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
  await openPalette(page);
  await page.keyboard.type('jane cooper');
  const jane = group(page, 'Search')
    .getByRole('option')
    .filter({ hasText: /\[seed\] Jane Cooper/ });
  await expect(jane).toBeVisible();
  await expect(page.getByTestId('palette-actions-button')).toBeVisible();
  await page.keyboard.press(`${mod}+k`);
  const menu = page.getByTestId('palette-actions-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Open record/,
    /Open record in a new tab/,
    /Copy email address/,
    /Create task/,
    /Create note/,
    /Merge record with\.\.\./,
    /Send email/,
  ]);
  // Closing the menu returns the focus to the input.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('palette-input')).toBeFocused();

  // ⌘C in the menu copies the email address.
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.press(`${mod}+c`);
  await expect(page.getByText('Copied email address to clipboard')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/jane\.cooper@/);

  // Create task: the dialog opens with the record linked.
  await openPalette(page);
  await page.keyboard.type('jane cooper');
  await expect(jane).toBeVisible();
  await page.keyboard.press(`${mod}+k`);
  await menu.getByRole('menuitem', { name: 'Create task' }).click();
  await expect(page.getByTestId('task-dialog')).toContainText('Create task');
  await expect(page.getByTestId('task-records-chip')).toContainText('1 linked record');
  await page.keyboard.press('Escape');

  // ↩ opens the record; ⌘↩ opens it in a new tab.
  await openPalette(page);
  await page.keyboard.type('jane cooper');
  await expect(jane).toBeVisible();
  const popup = context.waitForEvent('page');
  await page.keyboard.press(`${mod}+Enter`);
  expect(new URL((await popup).url()).pathname).toMatch(new RegExp(`/${WORKSPACE_SLUG}/person/`));
  await expect(palette(page)).toHaveCount(0);
  await openPalette(page);
  await page.keyboard.type('jane cooper');
  await expect(jane).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/person/`));
  await context.close();
});

test('record page and focused table row contribute their own actions to ⌘K', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  const cedar = await findRecord(page, 'companies', 'Cedar Health');
  await page.goto(ws(`company/${cedar.entityInstanceId}`));
  await expect(page.getByTestId('record-page')).toBeVisible();
  await openPalette(page);
  await expect(palette(page).getByRole('group').first()).toHaveAttribute('aria-label', /Cedar Health/);
  const first = (await palette(page).getByRole('group').first().getAttribute('aria-label')) ?? '';
  await expect(group(page, first).getByRole('option').filter({ hasText: 'Add to list' })).toBeVisible();
  await expect(
    group(page, first)
      .getByRole('option')
      .filter({ hasText: /to favorites/ }),
  ).toBeVisible();
  await expect(group(page, first).getByRole('option').filter({ hasText: 'Merge records' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A focused row of the companies table: its record actions lead the palette.
  await page.goto(ws('companies'));
  await expect(page.getByRole('grid').first()).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Northwind Robotics' }).first();
  await row.getByRole('gridcell').nth(1).click();
  await page.waitForTimeout(600); // the lookup waits for the focus to rest
  await page.keyboard.press(`${mod}+k`);
  await expect(palette(page)).toBeVisible();
  await expect(
    group(page, '[seed] Northwind Robotics').getByRole('option').filter({ hasText: 'Copy domain' }),
  ).toBeVisible();
  await expect(
    group(page, '[seed] Northwind Robotics').getByRole('option', { name: 'Open record', exact: true }),
  ).toBeVisible();
  await context.close();
});

test('nested pages: Note templates (breadcrumb, back), Create task, Add to list, Upcoming meetings', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  await openPalette(page);
  await page.keyboard.type('note templ');
  await page.keyboard.press('Enter');
  const nav = palette(page).getByRole('navigation', { name: 'Breadcrumb' });
  await expect(nav).toContainText('Quick actions');
  await expect(nav).toContainText('Note templates');
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search note templates...');
  await expect(
    group(page, 'Templates').getByRole('option').filter({ hasText: '[seed] Discovery call template' }).first(),
  ).toBeVisible();
  await expect(group(page, 'Actions').getByRole('option')).toContainText('Create new template');
  await expect(page.getByTestId('palette-primary')).toContainText('Edit template');
  // Search narrows; Esc clears, then goes back to Quick actions.
  await page.keyboard.type('discovery');
  await expect(paletteRows(page).filter({ hasText: 'Discovery call' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search quick actions and records...');
  // Back via the chevron remembers nothing but works from any page.
  await page.keyboard.type('templates');
  await page.keyboard.press('Enter');
  await palette(page).getByRole('button', { name: 'Go back' }).click();
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search quick actions and records...');
  // Enter on a template opens its editor window.
  await page.getByTestId('palette-input').fill('templates');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown'); // the template is the first row; "Create new template" the second
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(palette(page)).toHaveCount(0);
  expect(search(page).get('modal')).toBe('note-template');
  await page.keyboard.press('Escape');

  // Create task: closes the palette and opens the dialog.
  await openPalette(page);
  await page.getByTestId('palette-input').fill('create task');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-dialog')).toContainText('Create task');
  await page.keyboard.press('Escape');

  // Upcoming meetings (slice 7 fills it).
  await openPalette(page);
  await page.getByTestId('palette-input').fill('upcoming');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('meetings-empty')).toContainText('No upcoming meetings');
  await context.close();
});

// ---- `/` search ----------------------------------------------------------------------------------------------------------

test('/ opens Search records: Records / Results, no-results state, ⌘K closes, /search?q= opens it prefilled', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('tasks'));
  await quietClick(page);
  await page.keyboard.press('/');
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search records...');
  await expect(palette(page).getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Search');
  // The empty query still lists records (the most recently updated), under "Records".
  await expect(group(page, 'Records').getByRole('option').first()).toBeVisible();
  await page.keyboard.type('helios energy');
  await expect(group(page, 'Results').getByRole('option').first()).toContainText('Helios Energy');
  await expect(group(page, 'Results').getByRole('option').last()).toContainText('Create "helios energy" as record');
  // No hits: the illustration, the copy and a create button.
  await page.getByTestId('palette-input').fill('qqqqzzzzxxxx');
  await expect(page.getByTestId('search-empty')).toContainText("We couldn't find anything matching your search");
  await expect(page.getByTestId('search-empty').getByRole('button')).toContainText(
    'Create "qqqqzzzzxxxx" as a new record',
  );
  // ⌘K inside the modal closes it.
  await page.keyboard.press(`${mod}+k`);
  await expect(palette(page)).toHaveCount(0);

  // From Quick actions: "Search records" and 'See more results' push the page with a back breadcrumb.
  await openPalette(page);
  await page.getByTestId('palette-input').fill('search rec');
  await page.keyboard.press('Enter');
  await expect(palette(page).getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Quick actions');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search quick actions and records...');
  await page.keyboard.press('Escape');

  // `/search?q=…` redirects to Home and opens the modal prefilled.
  await page.goto(ws('search?q=northwind'));
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await expect(page.getByTestId('palette-input')).toHaveValue('northwind');
  await expect(palette(page).getByRole('option').filter({ hasText: 'Northwind Robotics' }).first()).toBeVisible();
  await context.close();
});

// ---- shortcuts -------------------------------------------------------------------------------------------------------------

test('shortcuts: g sequences (~1 s window), suppression in inputs and menus, tooltips, help drawer lists every binding', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('tasks'));
  await quietClick(page);

  // g h → home (acceptance 3); g t → tasks.
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await page.keyboard.press('g');
  await page.waitForTimeout(800);
  await page.keyboard.press('t');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/tasks$`));
  await page.keyboard.press('g');
  await page.keyboard.press('d');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/reports`));

  // Too slow: g → 1.3 s → h does not navigate; the lone h does nothing.
  await page.keyboard.press('g');
  await page.waitForTimeout(1300);
  await page.keyboard.press('h');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/reports`));
  // … and the lone T fires "Create a new task".
  await page.keyboard.press('g');
  await page.waitForTimeout(1300);
  await page.keyboard.press('t');
  await expect(page.getByTestId('task-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-dialog')).toHaveCount(0);

  // Suppressed inside inputs: typing "gh" into the palette input navigates nowhere.
  await openPalette(page);
  await page.keyboard.type('gh');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/reports`));
  await expect(page.getByTestId('palette-input')).toHaveValue('gh');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // … and inside an open menu (the workspace menu).
  await page.getByRole('button', { name: /Workspace menu/ }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('h');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/reports`));
  await page.keyboard.press('Escape');

  // Key caps in tooltips: "Go to home page  G then H".
  // (A pointer interaction first: after keyboard use, react-aria shows no hover tooltips.)
  await quietClick(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Go to home page');
  await expect(tooltip).toContainText('then');
  await expect(tooltip.locator('kbd')).toHaveCount(2);
  await page.mouse.move(900, 600);

  // ? opens the help drawer (not modal); Shortcuts lists every registered binding.
  await quietClick(page);
  await page.keyboard.press('?');
  const drawer = page.getByTestId('help-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Help');
  await drawer.getByRole('button', { name: 'Shortcuts', exact: true }).click();
  await expect(drawer).toContainText('Keyboard shortcuts');
  const rows = drawer.getByTestId('shortcut-row');
  await expect(drawer.getByRole('region', { name: 'General' })).toContainText('Go to home page');
  const listed = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-keys') ?? ''));
  const registered = await page.evaluate(() => {
    const hook = (
      window as unknown as { __shortcuts: { registered: () => string[]; canonical: (s: string) => string } }
    ).__shortcuts;
    return { registered: hook.registered(), listed: null as string[] | null, canonical: hook.canonical };
  });
  const canonicalListed = await page.evaluate((keys) => {
    const hook = (window as unknown as { __shortcuts: { canonical: (s: string) => string } }).__shortcuts;
    return keys.map((k) => hook.canonical(k));
  }, listed);
  for (const shortcut of registered.registered) {
    expect(canonicalListed, `${shortcut} is registered but not listed`).toContain(shortcut);
  }
  for (const expected of ['g then H', 'G then D']) void expected;
  await expect(drawer.getByRole('region', { name: 'General' }).locator('[data-keys="g h"]')).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'General' }).locator('[data-keys="g d"]')).toBeVisible();
  // The filter narrows; the back chevron returns to Help; Esc closes.
  await drawer.getByRole('searchbox', { name: 'Search shortcuts' }).fill('task');
  await expect(rows).toHaveCount(2); // Create a new task, Go to tasks page
  await drawer.getByRole('button', { name: 'Go back' }).click();
  await expect(drawer).toContainText('Getting started');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await context.close();
});

// ---- notifications ---------------------------------------------------------------------------------------------------------

test('inbox: a comment mention notifies the other member live, bumps the badge, opening marks it read', async ({
  browser,
}) => {
  const grace = secondMember();
  const a = await signedInAs(browser, ada(), ws('home'));
  const g = await signedInAs(browser, grace, ws('home'));
  const northwind = await findRecord(g.page, 'companies', 'Northwind Robotics');
  const adaId = await memberId(g.page, ada().email);

  // A rerun on the same database starts from an empty inbox.
  await trpc(a.page, 'notifications.archive', { all: true });
  await a.page.reload();
  await expect(a.page.getByTestId('home')).toBeVisible();
  await expect(a.page.getByTestId('inbox-badge')).toHaveCount(0);
  // Empty inbox: the bell, "No notifications", a Settings button.
  await a.page.getByTestId('inbox-button').click();
  await expect(a.page.getByTestId('inbox-empty')).toContainText('No notifications');
  await expect(a.page.getByRole('tab', { name: 'Notifications (0)' })).toBeVisible();
  await expect(a.page.getByRole('tab', { name: 'Requests (0)' })).toBeVisible();
  await a.page.keyboard.press('Escape');

  // Grace mentions Ada: Ada's badge shows 1 without a reload.
  const text = 'Hey @Ada Tester, can you review this renewal?';
  await trpc(g.page, 'comments.create', {
    id: uuid(),
    content: { text, mentions: [{ kind: 'workspace-member', start: 4, length: 11, memberId: adaId }], styles: [] },
    target: {
      kind: 'record',
      entityDefinitionId: northwind.entityDefinitionId,
      entityInstanceId: northwind.entityInstanceId,
    },
  });
  const badge = a.page.getByTestId('inbox-badge');
  await expect(badge).toHaveText('1');
  await expect(a.page.getByTestId('inbox-button')).toHaveAttribute('aria-label', 'Inbox, 1 unread');

  // The row: actor, registry title with the record, comment text, unread dot, the "Mentions" type badge.
  await a.page.getByTestId('inbox-button').click();
  const row = a.page.getByTestId('inbox-row').first();
  await expect(row).toBeVisible();
  await expect(row.getByTestId('inbox-eyebrow')).toHaveText('Grace Hopper');
  await expect(row.getByTestId('inbox-title')).toContainText('Mentioned you in a comment on [seed] Northwind Robotics');
  await expect(row).toContainText('can you review this renewal?');
  await expect(row.getByTestId('inbox-unread-dot')).toBeVisible();
  await expect(a.page.getByRole('tab', { name: 'Notifications (1)' })).toBeVisible();

  // Opening the item marks it read, closes the inbox and opens the comment thread on the record.
  await row.click();
  await expect(a.page.getByTestId('inbox')).toHaveCount(0);
  await expect(a.page).toHaveURL(/threadCommentId=/);
  await expect(badge).toHaveCount(0);
  await a.page.reload();
  await expect(a.page.getByTestId('inbox-badge')).toHaveCount(0);
  await a.page.getByTestId('inbox-button').click();
  // The row is there (read: no unread dot) — wait for it, a count of 0 alone would also hold while loading.
  await expect(a.page.getByTestId('inbox-row').first()).toBeVisible();
  await expect(a.page.getByTestId('inbox-row').first().getByTestId('inbox-unread-dot')).toHaveCount(0);
  await a.page.keyboard.press('Escape');

  // A task assigned to Ada: its own row (grouped per type); "Mark all as read" clears the badge.
  await trpc(g.page, 'tasks.create', {
    id: uuid(),
    content: { text: 'E2E assigned task', mentions: [] },
    assigneeMemberIds: [adaId],
  });
  await expect(badge).toHaveText('1');
  await a.page.getByTestId('inbox-button').click();
  const taskRow = a.page.getByTestId('inbox-row').filter({ hasText: 'Assigned a task to you' });
  await expect(taskRow).toBeVisible();
  await expect(taskRow).toContainText('E2E assigned task');
  await a.page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(badge).toHaveCount(0);
  await expect(a.page.getByTestId('inbox-unread-dot')).toHaveCount(0);

  // Row options: mark as unread (badge 1), archive (row gone).
  await taskRow.hover();
  await taskRow.getByTestId('inbox-row-options').click();
  await a.page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await expect(badge).toHaveText('1');
  await taskRow.hover();
  await taskRow.getByTestId('inbox-row-options').click();
  await a.page.getByRole('menuitem', { name: 'Archive notification' }).click();
  await expect(taskRow).toHaveCount(0);
  await expect(badge).toHaveCount(0);
  await a.page.keyboard.press('Escape');
  await expect(a.page.getByTestId('inbox')).toHaveCount(0);

  // Clicking a task notification opens the task (deep link).
  await trpc(g.page, 'tasks.create', {
    id: uuid(),
    content: { text: 'E2E second assigned task', mentions: [] },
    assigneeMemberIds: [adaId],
  });
  await expect(badge).toHaveText('1');
  await a.page.getByTestId('inbox-button').click();
  await a.page.getByTestId('inbox-row').filter({ hasText: 'E2E second assigned task' }).click();
  expect(search(a.page).get('command-menu-page')).toBe('task');
  await expect(badge).toHaveCount(0);

  await a.context.close();
  await g.context.close();
});

test('notification preferences: Settings → Notifications toggles save at once; turning In-app off stops the inbox row', async ({
  browser,
}) => {
  const grace = secondMember();
  const a = await signedInAs(browser, ada(), ws('home'));
  const g = await signedInAs(browser, grace, ws('home'));
  // Known starting state (an earlier failed run may have left toggles off), and an empty inbox.
  await trpc(a.page, 'notifications.preferences.update', { group: 'tasks', channel: 'in-app', enabled: true });
  await trpc(a.page, 'notifications.preferences.update', { group: 'daily-digest', channel: 'email', enabled: true });
  await trpc(a.page, 'notifications.archive', { all: true });
  await a.page.goto(ws('settings/notifications'));
  await expect(a.page.getByTestId('daily-digest')).toContainText('Enable daily digest');
  await expect(a.page.getByRole('region', { name: 'Collaboration notifications' })).toBeVisible();
  for (const title of [
    'Mentions',
    'Replies',
    'Email Grants',
    'Task Assignments',
    'Shared Resources',
    'Sequence delegated sender invites',
    'Permission requests',
  ]) {
    await expect(a.page.getByTestId(`pref-row-${rowGroup(title)}`)).toContainText(title);
  }
  // A toggle saves at once: click, then wait for the preferences.update call before reloading.
  const toggle = async (locator: Locator) => {
    await Promise.all([
      a.page.waitForResponse((r) => r.url().includes('notifications.preferences.update') && r.ok()),
      locator.click({ force: true }),
    ]);
  };
  const appBox = () => a.page.getByRole('checkbox', { name: 'Task Assignments: App' });
  try {
    await expect(appBox()).toBeChecked();
    await toggle(appBox());
    await a.page.reload();
    await expect(appBox()).not.toBeChecked();
    await expect(a.page.getByRole('checkbox', { name: 'Task Assignments: Email' })).toBeChecked();

    // With the App channel off, an assignment leaves no inbox row (the badge lives in the main sidebar: Home).
    const adaId = await memberId(g.page, ada().email);
    const badgeCount = async () => {
      const badge = a.page.getByTestId('inbox-badge');
      return (await badge.count()) > 0 ? Number(await badge.innerText()) : 0;
    };
    await a.page.goto(ws('home'));
    await expect(a.page.getByTestId('inbox-button')).toBeVisible();
    await trpc(g.page, 'tasks.create', {
      id: uuid(),
      content: { text: 'E2E muted assignment', mentions: [] },
      assigneeMemberIds: [adaId],
    });
    await a.page.waitForTimeout(1500);
    expect(await badgeCount()).toBe(0);

    // Turned back on, an assignment arrives again, live.
    await a.page.goto(ws('settings/notifications'));
    await toggle(appBox());
    await expect(appBox()).toBeChecked();
    // A fresh page subscribes to the workspace feed after its first queries; a change made before the server
    // acknowledged the subscription is only seen on the next refetch, so wait for the ack.
    const subscribed = a.page
      .waitForEvent('websocket', { predicate: (socket) => socket.url().includes('/realtime') })
      .then((socket) =>
        socket.waitForEvent('framereceived', { predicate: (f) => String(f.payload).includes('"type":"subscribed"') }),
      );
    await a.page.goto(ws('home'));
    await subscribed;
    await expect(a.page.getByTestId('inbox-button')).toBeVisible();
    await trpc(g.page, 'tasks.create', {
      id: uuid(),
      content: { text: 'E2E unmuted assignment', mentions: [] },
      assigneeMemberIds: [adaId],
    });
    await expect.poll(badgeCount).toBe(1);

    // The daily digest switch round-trips.
    await a.page.goto(ws('settings/notifications'));
    const digest = () => a.page.getByRole('switch', { name: 'Enable daily digest' });
    await toggle(digest());
    await a.page.reload();
    await expect(digest()).not.toBeChecked();
    await toggle(digest());
    await a.page.reload();
    await expect(digest()).toBeChecked();
  } finally {
    await trpc(a.page, 'notifications.preferences.update', { group: 'tasks', channel: 'in-app', enabled: true });
    await trpc(a.page, 'notifications.preferences.update', { group: 'daily-digest', channel: 'email', enabled: true });
    await trpc(a.page, 'notifications.archive', { all: true });
    await a.context.close();
    await g.context.close();
  }
});

function rowGroup(title: string): string {
  return (
    {
      Mentions: 'mentions',
      Replies: 'replies',
      'Email Grants': 'grants',
      'Task Assignments': 'tasks',
      'Shared Resources': 'shared',
      'Sequence delegated sender invites': 'sequence-delegated-sender-invites',
      'Permission requests': 'permission-requests',
    } as Record<string, string>
  )[title] as string;
}

// ---- home ------------------------------------------------------------------------------------------------------------------

test('home: greeting, tasks block from home.summary, placeholders, recent records', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  await expect(page.getByTestId('home-greeting')).toHaveText(/^Good (morning|afternoon|evening), Ada\.$/);
  await expect(page.getByTestId('home-ask')).toBeVisible();
  await expect(page.getByTestId('home-meetings')).toContainText('Meetings');

  const tasks = page.getByTestId('home-tasks');
  await expect(tasks.getByTestId('home-task').first()).toBeVisible();
  const rows = tasks.getByTestId('home-task');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  // Bucket order: due today first, overdue ones after tomorrow's; the due labels carry their tone.
  const labels = await tasks.getByTestId('home-task-due').allInnerTexts();
  expect(labels[0]).toBe('Today');
  expect(labels).toContain('Yesterday');
  expect(labels.indexOf('Tomorrow')).toBeLessThan(labels.indexOf('Yesterday'));
  await expect(tasks.getByTestId('home-task-due').filter({ hasText: 'Yesterday' })).toHaveAttribute(
    'data-tone',
    'overdue',
  );
  await expect(tasks.getByTestId('home-task-due').filter({ hasText: 'Today' })).toHaveAttribute('data-tone', 'today');
  await expect(tasks.getByText(/^\d+$/).first()).toBeVisible(); // the open-task count next to the heading

  // Completing from Home is immediate; the task returns afterwards (it is the seeded one).
  const row = rows.filter({ hasText: '[seed] Review contract redlines' });
  const id = seed.tasks['task.redlines'] as string;
  await row.getByRole('checkbox').click();
  await expect(row).toHaveAttribute('data-done', 'true');
  await expect(rows.filter({ hasText: '[seed] Review contract redlines' })).toHaveCount(0);
  await trpc(page, 'tasks.setCompleted', { taskId: id, completed: false });
  await page.reload();
  await expect(rows.filter({ hasText: '[seed] Review contract redlines' })).toBeVisible();

  // The row opens the task; "View all" goes to Tasks; "+" opens Create task.
  await rows.filter({ hasText: '[seed] Update forecast' }).click();
  expect(search(page).get('command-menu-page')).toBe('task');
  await page.keyboard.press('Escape');
  await tasks.getByRole('button', { name: 'New task' }).click();
  await expect(page.getByTestId('task-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await tasks.getByRole('button', { name: 'View all' }).click();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/tasks$`));

  // Recent records open their record page.
  await page.goto(ws('home'));
  const recent = page.getByTestId('home-recent').getByTestId('home-recent-record');
  await expect(recent.first()).toBeVisible();
  await recent.first().click();
  await expect(page).toHaveURL(/\/(company|person|deals\/record|custom\/[^/]+\/record)\//);
  await context.close();
});

// ---- misc ------------------------------------------------------------------------------------------------------------------

test('the sidebar Search button opens Quick actions; the page Help button opens the help drawer', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('settings/notifications'));
  await page.getByRole('button', { name: 'Help' }).first().click();
  await expect(page.getByTestId('help-drawer')).toBeVisible();
  await page.getByTestId('help-drawer').getByRole('button', { name: 'Close help drawer' }).click();
  await expect(page.getByTestId('help-drawer')).toHaveCount(0);
  // ⌘K works from settings, and the actions that need the overlay host (Create task) do too.
  await page.goBack().catch(() => undefined);
  await page.goto(ws('settings/notifications'));
  await openPalette(page);
  await page.getByTestId('palette-input').fill('create task');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.goto(ws('home'));
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(palette(page)).toBeVisible();
  await context.close();
});
