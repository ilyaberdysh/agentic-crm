//  — notes, templates, tasks, comments, favorites and the window manager (BACKLOG 3.12, 3.14–3.17, B.16;
// acceptance 6 and 7). Runs against the e2e stack (API + collab + web) with seed- data; every test creates the
// items it changes so the seeded ones stay intact for the visual review run.
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { clearFavorites, seedSlice3, signedInPage, trpc, uuid, ws } from './slice3-support.ts';

let seed: ReturnType<typeof seedSlice3>;
test.beforeAll(() => {
  seed = seedSlice3();
});

async function newNote(page: Page, title: string, record = seed.cedar, object = seed.companiesId): Promise<string> {
  const id = uuid();
  await trpc(page, 'notes.create', {
    id,
    title,
    parentRecords: [{ entityDefinitionId: object, entityInstanceId: record }],
  });
  return id;
}

const search = (page: Page) => new URL(page.url()).searchParams;

test('notes page: layouts, Choose record, title autosave, minimise / float / expand / close', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('notes'));
  await clearFavorites(page);
  await page.reload();
  await expect(page.getByTestId('notes-page')).toBeVisible();
  await expect(page.getByTestId('notes-group').first()).toContainText('Created today');
  await expect(page.getByTestId('note-card').filter({ hasText: '[seed] Account plan' })).toBeVisible();

  await page.getByTestId('notes-layout-list').click();
  await expect(page.getByTestId('note-row').filter({ hasText: '[seed] Account plan' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Created by' })).toBeVisible();
  await page.getByTestId('notes-layout-grid').click();
  await expect(page.getByTestId('note-card').first()).toBeVisible();

  // + New note → Choose record → Enter creates the note and opens it at ?modal=note.
  await page.getByTestId('new-note').click();
  const chooser = page.getByTestId('choose-record-dialog');
  await expect(chooser).toBeVisible();
  await chooser.getByRole('combobox').fill('Cedar');
  await expect(chooser.getByRole('option').first()).toContainText('Cedar Health');
  await chooser.getByRole('combobox').press('Enter');
  await expect(page.getByTestId('note-window')).toBeVisible();
  expect(search(page).get('modal')).toBe('note');
  const noteId = search(page).get('id') as string;
  await expect(page.getByTestId('note-breadcrumb')).toContainText('Cedar Health');

  await page.getByTestId('note-title').fill('E2E autosaved title');
  await expect
    .poll(async () => (await trpc<{ title: string }>(page, 'notes.get', { noteId })).title, { timeout: 5000 })
    .toBe('E2E autosaved title');

  // Minimise: params dropped, a dock bubble; the bubble floats it; Expand brings back the modal.
  await page.getByRole('button', { name: 'Minimize' }).click();
  await expect(page.getByTestId('window-modal')).toHaveCount(0);
  expect(search(page).get('modal')).toBeNull();
  const bubble = page.locator(`[data-testid="dock-bubble"][data-window-id="${noteId}"]`);
  await expect(bubble).toHaveAttribute('data-mode', 'minimized');
  await bubble.getByRole('button', { name: /^Open / }).click();
  await expect(page.getByTestId('window-floating')).toBeVisible();
  await expect(bubble).toHaveAttribute('data-mode', 'floating');
  // The page underneath stays interactive while the panel floats.
  await page.getByTestId('notes-layout-list').click();
  await expect(page.getByTestId('note-row').first()).toBeVisible();
  await page.getByTestId('window-floating').getByRole('button', { name: 'Expand' }).click();
  await expect(page.getByTestId('window-modal')).toBeVisible();
  expect(search(page).get('id')).toBe(noteId);
  await expect(bubble).toHaveCount(0);

  // Pin to screen → floating; the window survives navigation.
  await page.getByRole('button', { name: 'Pin to screen' }).click();
  await expect(page.getByTestId('window-floating')).toBeVisible();
  await page.goto(ws('tasks'));
  await expect(page.getByTestId('window-floating')).toBeVisible();
  await page.getByTestId('window-floating').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('window-floating')).toHaveCount(0);
  await expect(page.getByTestId('window-dock')).toHaveCount(0);

  // Deep link /note/$id → the note modal over Home.
  await page.goto(`/${WORKSPACE_SLUG}/note/${noteId}`);
  await expect(page).toHaveURL(new RegExp(`/home\\?modal=note&id=${noteId}`));
  await expect(page.getByTestId('note-title')).toHaveValue('E2E autosaved title');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('window-modal')).toHaveCount(0);
  await context.close();
});

test('deleting a note asks for confirmation and has no undo (acceptance 6)', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('notes'));
  const noteId = await newNote(page, 'E2E note to delete');
  await page.goto(`${ws('notes')}?modal=note&id=${noteId}`);
  const win = page.getByTestId('note-window');
  await expect(win).toBeVisible();
  await win.getByRole('button', { name: 'Note options' }).click();
  await page.getByRole('menuitem', { name: 'Delete note' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Are you sure?');
  await expect(dialog).toContainText('Permanently delete this note?');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  const toast = page.getByText('Note deleted');
  await expect(toast).toBeVisible();
  await expect(page.getByRole('button', { name: /undo/i })).toHaveCount(0);
  await expect(page.getByTestId('window-modal')).toHaveCount(0);
  await expect(page.locator(`[data-note-id="${noteId}"]`)).toHaveCount(0);
  const response = await page.request.post('/trpc/notes.get', {
    headers: { 'content-type': 'application/json', 'x-workspace-slug': WORKSPACE_SLUG },
    data: { noteId },
  });
  expect(response.status()).toBe(404);
  await context.close();
});

test('templates: page, editor banner, use a template in an empty note, create a template from a note', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('notes/templates'));
  await clearFavorites(page);
  await page.reload();
  await expect(page.getByTestId('template-card').filter({ hasText: '[seed] Discovery call template' })).toBeVisible();
  await page.getByTestId('new-template').click();
  const template = page.getByTestId('template-window');
  await expect(template).toBeVisible();
  expect(search(page).get('modal')).toBe('note-template');
  await expect(template.getByTestId('template-banner')).toContainText('You are editing a template');
  await expect(template.getByTestId('template-title')).toHaveAttribute('placeholder', 'Untitled Template');
  await template.getByTestId('template-title').fill('E2E template');
  await template.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('template-card').filter({ hasText: 'E2E template' })).toBeVisible();

  // An empty note offers the launcher; picking a template sets the title and inserts the body.
  const noteId = await newNote(page, '');
  await page.goto(`${ws('notes')}?modal=note&id=${noteId}`);
  const launcher = page.getByTestId('template-launcher');
  await expect(launcher).toBeVisible();
  await launcher.getByRole('button', { name: 'View all templates' }).click();
  await page.getByRole('button', { name: '[seed] Discovery call template' }).click();
  await expect(page.getByTestId('note-title')).toHaveValue('[seed] Discovery call template');
  await expect(page.getByTestId('note-window').locator('.ProseMirror')).toContainText('Agenda');
  await expect(launcher).toHaveCount(0);

  // ⋮ › Create template from note opens the new template.
  await page.getByTestId('note-window').getByRole('button', { name: 'Note options' }).click();
  await page.getByRole('menuitem', { name: 'Create template from note' }).click();
  await expect(page.getByTestId('template-window')).toBeVisible();
  // The new template takes the note's title as its header title; its body is the note's.
  await expect(page.getByTestId('template-title')).toHaveValue('[seed] Discovery call template');
  await expect(page.getByTestId('template-window').locator('.ProseMirror')).toContainText('Agenda');
  await context.close();
});

test('tasks: natural-language date and mention, edit dialog, optimistic completion reverts on error', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('tasks'));
  await expect(page.getByTestId('task-group').first()).toContainText('Today');
  await expect(page.getByTestId('task-row').filter({ hasText: '[seed] Book technical deep-dive' })).toContainText(
    'Due yesterday',
  );

  await page.getByTestId('new-task').click();
  const dialog = page.getByTestId('task-dialog');
  await expect(dialog).toContainText('Create task');
  await expect(dialog.getByTestId('task-deadline-chip')).toHaveText('Today');
  await expect(dialog.getByTestId('task-assignee-chip')).toHaveText('Assigned to You');
  const input = dialog.getByTestId('task-title-input');
  await input.pressSequentially('E2E demo for @Cedar');
  await expect(page.getByTestId('mention-menu')).toContainText('Cedar Health');
  await input.press('Enter');
  await input.pressSequentially('tomorrow at 3pm');
  await expect(dialog.getByTestId('task-deadline-chip')).toHaveText('Tomorrow, 3:00 PM');
  await expect(dialog.getByTestId('task-records-chip')).toHaveText('1 linked record');
  await input.press('Enter');
  await expect(page.getByText('Task created')).toBeVisible();
  const row = page.getByTestId('task-row').filter({ hasText: 'E2E demo for @[seed] Cedar Health tomorrow at 3pm' });
  await expect(row).toContainText('Due tomorrow');
  await expect(row).toContainText('Cedar Health');

  // Edit dialog at ?command-menu-page=task.
  await row.getByText('E2E demo for').click();
  await expect(page.getByTestId('task-dialog')).toContainText('Edit task');
  expect(search(page).get('command-menu-page')).toBe('task');
  const editInput = page.getByTestId('task-dialog').getByTestId('task-title-input');
  await editInput.press('End');
  await editInput.pressSequentially(' (edited)');
  await page.getByTestId('task-dialog').getByRole('button', { name: /^Save/ }).click();
  await expect(page.getByTestId('task-dialog')).toHaveCount(0);
  const edited = page.getByTestId('task-row').filter({ hasText: '(edited)' });
  await expect(edited).toBeVisible();

  // Completion is optimistic and reverts when the server fails.
  await page.route('**/trpc/tasks.setCompleted*', (route) => route.fulfill({ status: 500, body: '{}' }));
  const box = edited.getByTestId('task-checkbox');
  await box.click();
  await expect(page.getByText('Failed to mark task as done')).toBeVisible();
  await expect(edited.getByTestId('task-checkbox')).toHaveAttribute('aria-checked', 'false');
  await page.unroute('**/trpc/tasks.setCompleted*');
  await edited.getByTestId('task-checkbox').click();
  await expect(page.locator('[data-testid="task-group"][data-group="completed"]')).toContainText('(edited)');
  await context.close();
});

test('tasks: optimistic checkbox is checked before the server answers', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('tasks'));
  const id = uuid();
  await trpc(page, 'tasks.create', { id, content: { text: 'E2E slow completion', mentions: [] } });
  await page.reload();
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route('**/trpc/tasks.setCompleted*', async (route) => {
    await held;
    await route.continue();
  });
  const row = page.getByTestId('task-row').filter({ hasText: 'E2E slow completion' });
  await row.getByTestId('task-checkbox').click();
  await expect(
    page.locator('[data-testid="task-group"][data-group="completed"]').getByText('E2E slow completion'),
  ).toBeVisible();
  release();
  await expect
    .poll(async () => (await trpc<{ isCompleted: boolean }>(page, 'tasks.get', { taskId: id })).isCompleted)
    .toBe(true);
  await context.close();
});

test('tasks: bulk select (⌘-click), mark complete, delete with confirmation', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('tasks'));
  const a = uuid();
  const b = uuid();
  await trpc(page, 'tasks.create', { id: a, content: { text: 'E2E bulk A', mentions: [] } });
  await trpc(page, 'tasks.create', { id: b, content: { text: 'E2E bulk B', mentions: [] } });
  await page.reload();
  const rowA = page.locator(`[data-testid="task-row"][data-task-id="${a}"]`);
  const rowB = page.locator(`[data-testid="task-row"][data-task-id="${b}"]`);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await rowA.getByText('E2E bulk A').click({ modifiers: [mod] });
  await rowB.getByText('E2E bulk B').click({ modifiers: [mod] });
  const bar = page.getByTestId('tasks-bulk-bar');
  await expect(bar).toContainText('2');
  await expect(bar).toContainText('Selected');
  await bar.getByRole('button', { name: 'Mark complete' }).click();
  await expect(rowA).toHaveAttribute('data-completed', 'true');
  await expect(rowB).toHaveAttribute('data-completed', 'true');

  await rowA.getByText('E2E bulk A').click({ modifiers: [mod] });
  await rowB.getByText('E2E bulk B').click({ modifiers: [mod] });
  await bar.getByRole('button', { name: 'Delete tasks' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete 2 tasks');
  await expect(dialog).toContainText('Are you sure you want to delete these 2 tasks?');
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(rowA).toHaveCount(0);
  await expect(rowB).toHaveCount(0);
  await context.close();
});

test('comment deep link opens the thread (acceptance 7); reply, react, resolve, filter, delete', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  const rootId = uuid();
  const target = { kind: 'record', entityDefinitionId: seed.projectsId, entityInstanceId: seed.projects[2] };
  await trpc(page, 'comments.create', {
    id: rootId,
    target,
    content: { text: 'E2E deep-linked thread', mentions: [], styles: [] },
  });
  await page.goto(`/${WORKSPACE_SLUG}/comment/${rootId}`);
  await expect(page).toHaveURL(new RegExp(`threadCommentId=${rootId}`));
  const panel = page.getByTestId('object-comments-panel');
  await expect(panel.getByTestId('thread-view')).toContainText('E2E deep-linked thread');
  await expect(panel.getByTestId('comment-subject')).toContainText('Comment on');

  // Reply (Enter posts; the composer clears).
  const reply = panel.getByTestId('comment-input');
  await reply.fill('E2E reply with https://example.com');
  await reply.press('Enter');
  await expect(panel.getByTestId('thread-view')).toContainText('E2E reply with');
  await expect(panel.getByRole('link', { name: 'https://example.com' })).toBeVisible();
  await expect(panel.getByTestId('thread-divider')).toHaveText('1 reply');
  await expect(reply).toHaveValue('');

  // React with 👍 from the picker; clicking custom chip removes it.
  const root = panel.locator(`[data-testid="comment"][data-comment-id="${rootId}"]`);
  await root.hover();
  await root.getByRole('button', { name: 'Pick emoji' }).first().click();
  const picker = page.getByTestId('emoji-picker');
  await picker.getByLabel('Search Emojis').fill('thumbs');
  await expect(picker.getByRole('button')).toHaveCount(2);
  await picker.getByRole('button', { name: 'thumbs up' }).click();
  const chip = root.getByTestId('reaction-chip');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toContainText('1');
  await chip.click();
  await expect(root.getByTestId('reaction-chip')).toHaveCount(0);

  // Delete the reply (author only), then resolve the thread: hidden until "Show resolved comments".
  const replyItem = panel.locator('[data-testid="comment"]').filter({ hasText: 'E2E reply with' });
  await replyItem.hover();
  await replyItem.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete comment' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Once deleted it cannot be restored.');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Comment deleted')).toBeVisible();
  await expect(panel.getByTestId('thread-view')).not.toContainText('E2E reply with');

  await root.hover();
  await root.getByRole('button', { name: 'Resolve comment' }).click();
  await panel.getByRole('button', { name: 'Back' }).first().click();
  const card = panel.locator(`[data-testid="thread-card"][data-thread-id="${rootId}"]`);
  await expect(card).toHaveCount(0);
  await panel.getByRole('button', { name: 'Filter comments' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show resolved comments' }).click();
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('comments-filter-dot')).toBeVisible();
  await expect(card).toContainText('Resolved by you');

  // An unknown comment id: toast and back to the workspace.
  await page.goto(`/${WORKSPACE_SLUG}/comment/${uuid()}`);
  await expect(page.getByText("We can't find that comment")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home`));
  await context.close();
});

test('record comments panel (E3): post a top-level comment', async ({ browser }) => {
  const record = seed.projects[3] as string;
  const { context, page } = await signedInPage(
    browser,
    ws(`__dev/record-tabs?object=${seed.projectsId}&record=${record}`),
  );
  const panel = page.getByTestId('record-comments-panel');
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.width).toBe(320);
  await panel.getByTestId('comment-input').fill('E2E top-level comment');
  await panel.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(panel.getByTestId('thread-card').filter({ hasText: 'E2E top-level comment' })).toBeVisible();
  await expect(page.getByTestId('record-tasks-tab')).toBeVisible();
  await expect(page.getByTestId('record-notes-tab')).toBeVisible();
  await context.close();
});

test('favorites: star a note, folder, drag into the folder, deleting the folder deletes its favorites', async ({
  browser,
}) => {
  const { context, page } = await signedInPage(browser, ws('notes'), { storage: { 'notes-list-view-mode': 'list' } });
  await clearFavorites(page);
  const noteId = await newNote(page, 'E2E favourite note');
  await page.reload();
  const row = page.locator(`[data-testid="note-row"][data-note-id="${noteId}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Add to favorites' }).click();
  const section = page.getByTestId('favorites-section');
  const fav = section.getByTestId('favorite-row').filter({ hasText: 'E2E favourite note' });
  await expect(fav).toBeVisible();
  await expect(row.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  await expect(page.getByTestId('favorites-strip').getByTestId('note-card')).toHaveCount(1);

  // New folder at the top.
  await page.getByRole('region', { name: 'Favorites' }).first().hover();
  await page.getByRole('button', { name: 'New favorites folder' }).click();
  await page.getByPlaceholder('Folder name...').fill('E2E folder');
  await page.getByPlaceholder('Folder name...').press('Enter');
  const folder = section.getByTestId('favorite-folder').filter({ hasText: 'E2E folder' });
  await expect(folder).toBeVisible();
  await expect(section.getByText('No items')).toBeVisible();

  // Drag the favourite onto the folder.
  const from = await fav.boundingBox();
  const to = await folder.boundingBox();
  if (!from || !to) throw new Error('no boxes');
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + from.height / 2 - 8, { steps: 3 });
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const list = await trpc<{ favorites: { targetId: string; directoryId: string | null }[] }>(
        page,
        'favorites.list',
        undefined,
      );
      return list.favorites.find((f) => f.targetId === noteId)?.directoryId ?? null;
    })
    .not.toBeNull();

  // Delete folder → confirm → the folder and its favourite are gone.
  await folder.hover();
  await folder.getByRole('button', { name: 'Folder options' }).click();
  await page.getByRole('menuitem', { name: 'Delete folder' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Are you sure you want to delete this folder?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(folder).toHaveCount(0);
  await expect(section.getByText('E2E favourite note')).toHaveCount(0);
  const list = await trpc<{ favorites: { targetId: string }[] }>(page, 'favorites.list', undefined);
  expect(list.favorites.some((f) => f.targetId === noteId)).toBe(false);
  await context.close();
});

test('record overlay (E4): URL sync, K / J through the list, a note above it, Esc closes', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('custom/projects'));
  await expect(page.getByTestId('object-page')).toBeVisible();
  const records = seed.projects
    .slice(0, 3)
    .map((id) => ({ entityDefinitionId: seed.projectsId, entityInstanceId: id }));
  await page.evaluate(
    ({ records }) =>
      (
        window as unknown as { __overlays: { openRecordOverlay: (r: unknown, o: unknown) => void } }
      ).__overlays.openRecordOverlay(records[0], { list: { label: 'E2E list', records } }),
    { records },
  );
  const overlay = page.getByTestId('record-overlay');
  await expect(overlay).toBeVisible();
  expect(search(page).get('modal')).toBe('record');
  expect(search(page).get('id')).toBe(seed.projects[0]);
  await expect(overlay.getByTestId('record-overlay-nav')).toContainText('1 of 3 in E2E list');
  await expect(overlay.getByRole('button', { name: 'Previous record' })).toBeDisabled();
  await page.keyboard.press('j');
  await expect(overlay.getByTestId('record-overlay-nav')).toContainText('2 of 3 in E2E list');
  expect(search(page).get('id')).toBe(seed.projects[1]);
  await page.keyboard.press('j');
  await expect(overlay.getByRole('button', { name: 'Next record' })).toBeDisabled();
  await page.keyboard.press('k');
  await expect(overlay.getByTestId('record-overlay-nav')).toContainText('2 of 3 in E2E list');

  // A note opens above the overlay and closes back to it.
  await page.evaluate(
    (id) => (window as unknown as { __overlays: { openNote: (id: string) => void } }).__overlays.openNote(id),
    seed.notes['note.account-plan'] as string,
  );
  await expect(page.getByTestId('window-modal')).toBeVisible();
  expect(search(page).get('modal')).toBe('note');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('window-modal')).toHaveCount(0);
  expect(search(page).get('modal')).toBe('record');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  expect(search(page).get('modal')).toBeNull();

  // Reload with the params restores the overlay (without a sequence).
  await page.goto(`${ws('custom/projects')}?modal=record&id=${seed.projects[0]}&object=${seed.projectsId}`);
  await expect(page.getByTestId('record-overlay')).toBeVisible();
  await context.close();
});

test('shortcuts: n opens Choose record, t opens Create task', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  // An empty spot of the page header: Home now lists tasks, so a click further down could open one.
  await page.getByTestId('page-header').waitFor();
  await page.mouse.click(700, 24);
  await page.keyboard.press('n');
  await expect(page.getByTestId('choose-record-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('choose-record-dialog')).toHaveCount(0);
  await page.keyboard.press('t');
  await expect(page.getByTestId('task-dialog')).toContainText('Create task');
  await context.close();
});
