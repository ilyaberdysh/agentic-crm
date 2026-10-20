// Lists (BACKLOG 4.01–4.04, 4.09): create a list from scratch, the list page (empty state, rename, header menu,
// duplicate / delete), add records from the list page (choose record → form; duplicates step → edit entry), remove
// from list, the record page Lists section and "Add to list", bulk add from an object table with the duplicate
// dialog, entry routes, list settings and the sidebar section. Runs against the API server (lists.* / entries.*).
import { expect, type Page, test } from '@playwright/test';
import { addEntry, createList, deleteList, entriesOf, findRecord, type ListInfo } from './lists-support.ts';
import { signedInPage, trpc, uuid, ws } from './slice3-support.ts';

const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 6)}`;

async function openList(page: Page, list: ListInfo) {
  await page.goto(ws(`collection/${list.id}`));
  await expect(page.getByTestId('list-page')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/collection/${list.id}/view/`));
}

const rows = (page: Page) =>
  page
    .getByRole('grid')
    .getByRole('row')
    .filter({ has: page.getByTestId('entry-parent') });

test.describe('lists', () => {
  test('create a list from scratch from the sidebar', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const name = unique('Watchlist');
    // "+ New list" when the workspace has no lists, else the section's "+" (hover action).
    const sidebarLists = page.getByRole('region', { name: 'Lists' });
    const newList = page.getByLabel('New list');
    await expect(newList.or(page.getByTestId('sidebar-lists').getByRole('link').first())).toBeVisible();
    if (await newList.isVisible()) await newList.click();
    else {
      await sidebarLists.getByRole('button', { name: 'Lists', exact: true }).hover();
      await sidebarLists.getByRole('button', { name: 'Add list' }).click();
    }
    const dialog = page.getByTestId('create-list-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Start from scratch')).toBeVisible();
    await expect(dialog.getByLabel('List name')).toHaveValue('New list');
    // Empty name is refused with the observed copy.
    await dialog.getByLabel('List name').fill('');
    await dialog.getByRole('button', { name: /Create list/ }).click();
    await expect(dialog.getByText('Please provide a name for this list.')).toBeVisible();
    await dialog.getByLabel('List name').fill(name);
    await dialog.getByRole('button', { name: /Create list/ }).click();
    await expect(page).toHaveURL(/\/collection\/[0-9a-f-]+\/view\/[0-9a-f-]+/);
    await expect(page.getByTestId('list-name')).toHaveText(name);
    await expect(page.getByTestId('list-empty')).toBeVisible();
    await expect(page.getByText('No records yet! Add your first record to get started.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Company' }).first()).toBeVisible();
    // New lists go to the end of the custom order: in the section, or behind "All lists" past six lists.
    const allLists = page.getByRole('link', { name: 'All lists' });
    if (await allLists.isVisible()) {
      await allLists.click();
      await page.getByTestId('all-lists-panel').getByLabel('Search lists').fill(name);
      await expect(page.getByTestId('all-lists-panel').getByText(name)).toBeVisible();
    } else await expect(page.getByTestId('sidebar-lists').getByText(name)).toBeVisible();
    await context.close();
  });

  test('rename, header menu, duplicate and delete', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const list = await createList(page, unique('Pipeline'));
    await openList(page, list);

    // Inline rename: the name button becomes a text box; Enter saves.
    await page.getByTestId('list-name').click();
    const input = page.getByLabel('List name');
    await expect(input).toBeFocused();
    const renamed = unique('Renamed');
    await input.fill(renamed);
    await input.press('Enter');
    await expect(page.getByTestId('list-name')).toHaveText(renamed);
    await expect
      .poll(async () => (await trpc<{ name: string }>(page, 'lists.get', { listId: list.id })).name)
      .toBe(renamed);

    // Header menu items (C2).
    await page.getByTestId('list-menu-button').click();
    const menu = page.getByRole('menu');
    for (const item of [
      'List settings',
      'Manage attributes',
      'Duplicate list',
      'Copy list ID',
      'Notifications',
      'Delete list',
    ])
      await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Duplicate list' }).click();
    await expect(page.getByRole('alertdialog')).toContainText(`Are you sure you want to duplicate ${renamed}?`);
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(page.getByText('List successfully duplicated')).toBeVisible();
    await expect(page.getByTestId('list-name')).toHaveText(`${renamed} (2)`);
    const copyId = /\/collection\/([0-9a-f-]+)\//.exec(page.url())?.[1] as string;
    expect(copyId).not.toBe(list.id);

    // Delete the copy.
    await page.getByTestId('list-menu-button').click();
    await page.getByRole('menuitem', { name: 'Delete list' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Deleting a list deletes its data and views permanently and cannot be undone.');
    await alert.getByRole('button', { name: 'Delete list' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByTestId('sidebar-lists').getByText(`${renamed} (2)`, { exact: true })).toHaveCount(0);
    await deleteList(page, list);
    await context.close();
  });

  test('add a record from the list page; duplicates step; edit entry; remove from list', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const list = await createList(page, unique('Prospects'), 'companies', { stage: true });
    await openList(page, list);

    // Choose record → Add to list form.
    await page.getByTestId('add-entry').click();
    const chooser = page.getByTestId('choose-record-dialog');
    await expect(chooser).toBeVisible();
    await expect(chooser.getByText('Records', { exact: true })).toBeVisible();
    await chooser.getByRole('combobox').fill('Northwind');
    await expect(chooser.getByTestId('choose-record-option').first()).toContainText('Northwind');
    await chooser.getByRole('combobox').press('Enter');
    const form = page.getByTestId('add-to-list-form');
    await expect(form).toBeVisible();
    await expect(form.getByText(/^Stage\s*\(optional\)$/)).toBeVisible();
    await expect(form.getByText(/^Deal value\s*\(optional\)$/)).toBeVisible();
    await form.getByLabel('Deal value').fill('1200');
    await form.getByRole('button', { name: /Add to list/ }).click();
    await expect(form).toHaveCount(0);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Northwind Robotics');

    // The same record again: Duplicates → "Create new entry" → second entry.
    await page.keyboard.press('e');
    await chooser.getByRole('combobox').fill('Northwind');
    await expect(chooser.getByTestId('choose-record-option').first()).toContainText('Northwind');
    await chooser.getByTestId('choose-record-option').first().click();
    const dups = page.getByTestId('duplicates-dialog');
    await expect(dups).toBeVisible();
    await expect(dups.getByTestId('duplicate-entry-option')).toHaveCount(1);
    await expect(dups.getByRole('button', { name: /Edit entry/ })).toBeVisible();
    await dups.getByTestId('create-new-entry').click();
    await page
      .getByTestId('add-to-list-form')
      .getByRole('button', { name: /Add to list/ })
      .click();
    await expect(rows(page)).toHaveCount(2);

    // Duplicates → the existing entry opens "Edit list entry".
    await page.getByTestId('add-entry').click();
    await chooser.getByRole('combobox').fill('Northwind');
    await expect(chooser.getByTestId('choose-record-option').first()).toContainText('Northwind');
    await chooser.getByRole('combobox').press('Enter');
    await expect(dups.getByTestId('duplicate-entry-option')).toHaveCount(2);
    await dups.getByRole('button', { name: /Edit entry/ }).click();
    const edit = page.getByTestId('edit-entry-dialog');
    await expect(edit).toBeVisible();
    await expect(page.getByText(`Added to ${list.name}`, { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /Finished editing/ }).click();

    // Select both rows → More → Remove from list → confirm.
    await page.getByRole('checkbox', { name: 'Select all rows' }).click();
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Remove from list' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Remove 2 records from list');
    await alert.getByRole('button', { name: 'Remove from list' }).click();
    await expect(page.getByTestId('list-empty')).toBeVisible();
    expect(await entriesOf(page, list)).toBe(0);
    await deleteList(page, list);
    await context.close();
  });

  test('record page: Lists section and Add to list', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const list = await createList(page, unique('Accounts'), 'companies', { stage: true });
    const cedar = await findRecord(page, 'companies', 'Cedar Health');
    await page.goto(ws(`company/${cedar.entityInstanceId}/overview`));
    const section = page.getByTestId('lists-section');
    await expect(section).toBeVisible();

    await section.getByRole('button', { name: 'Add to list' }).click();
    const chooser = page.getByTestId('choose-list-dialog');
    await expect(chooser).toBeVisible();
    await chooser.getByRole('combobox').fill(list.name);
    await expect(chooser.getByTestId('choose-list-option')).toHaveCount(1);
    await chooser.getByRole('combobox').press('Enter');
    const form = page.getByTestId('add-to-list-form');
    await expect(form).toBeVisible();
    await form.getByRole('button', { name: /Add to list/ }).click();
    const card = section.getByTestId('list-entry-card').filter({ hasText: list.name });
    await expect(card).toBeVisible();
    await expect(card.getByText('Stage', { exact: true })).toBeVisible();

    // ⋮ → Remove from list → confirm.
    await card.hover();
    await card.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('menuitem', { name: 'Remove from list' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Remove record from list');
    await expect(alert).toContainText("Are you sure? This will delete the record's list attribute data.");
    await alert.getByRole('button', { name: 'Remove from list' }).click();
    await expect(card).toHaveCount(0);
    await deleteList(page, list);
    await context.close();
  });

  test('bulk Add to list from the companies table with duplicate handling', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('companies'));
    const list = await createList(page, unique('Bulk'), 'companies');
    const northwind = await findRecord(page, 'companies', 'Northwind Robotics');
    await addEntry(page, list, northwind);
    await page.reload();
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    // Select Northwind and one other company.
    const northwindRow = grid.getByRole('row').filter({ hasText: 'Northwind Robotics' });
    await northwindRow.getByRole('checkbox').click();
    const other = grid.getByRole('row').filter({ hasText: 'Cedar Health' });
    await other.getByRole('checkbox').click();
    await page.getByTestId('bulk-bar').getByRole('button', { name: 'Add to list' }).click();
    const chooser = page.getByTestId('choose-list-dialog');
    await chooser.getByRole('combobox').fill(list.name);
    await chooser.getByRole('combobox').press('Enter');
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Duplicate entries');
    await expect(alert).toContainText('1 record is already in this list');
    await expect(alert.getByRole('button', { name: 'Add to list (1)' })).toBeVisible();
    const createDuplicates = alert.getByRole('checkbox', { name: 'Create duplicate list entries' });
    await createDuplicates.check({ force: true });
    await expect(alert.getByRole('button', { name: 'Add to list (2)' })).toBeVisible();
    await createDuplicates.uncheck({ force: true });
    await alert.getByRole('button', { name: 'Add to list (1)' }).click();
    await expect(page.getByText('Added 1 record to list')).toBeVisible();
    await expect.poll(() => entriesOf(page, list)).toBe(2);
    await deleteList(page, list);
    await context.close();
  });

  test('entry routes, comments panel and list settings', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const list = await createList(page, unique('Routes'), 'companies', { stage: true });
    const orbit = await findRecord(page, 'companies', 'Orbit Logistics');
    const entryId = await addEntry(page, list, orbit);

    // /entry/<id> → the parent record page.
    await page.goto(ws(`collection/${list.id}/entry/${entryId}`));
    await expect(page).toHaveURL(new RegExp(`/company/${orbit.entityInstanceId}/overview`));

    // /entry/<id>/comments → the list with the entry's comments open.
    await page.goto(ws(`collection/${list.id}/entry/${entryId}/comments`));
    await expect(page.getByTestId('record-comments-panel')).toBeVisible();
    await expect(page.getByTestId('comment-subject')).toContainText('Add comment on');
    await page.getByTestId('record-comments-panel').getByRole('button', { name: 'Back' }).click();
    await expect(page.getByTestId('object-comments-panel')).toBeVisible();
    await expect(page.getByTestId('object-comments-panel').getByText('Comments', { exact: true })).toBeVisible();
    await page.getByTestId('list-comments-button').click();
    await expect(page.getByTestId('object-comments-panel')).toHaveCount(0);

    // Settings → Lists → the list's configuration and attributes.
    await page.goto(ws('settings/data/lists'));
    const row = page.getByTestId('settings-list-row').filter({ hasText: list.name });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/settings/data/lists/${list.id}/general`));
    await expect(page.getByTestId('list-settings')).toContainText(
      'Manage attributes, permissions and other relevant settings',
    );
    await expect(page.getByRole('button', { name: /Parent object/ })).toContainText('Companies');
    await page.getByRole('tab', { name: /Attributes/ }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/data/lists/${list.id}/attributes`));
    await expect(page.getByText('Parent Record').first()).toBeVisible();
    await expect(page.getByText('Stage').first()).toBeVisible();
    await deleteList(page, list);
    await context.close();
  });

  test('entries table: list and parent-record columns; parent values edit the parent record', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const list = await createList(page, unique('Columns'), 'companies', { stage: true });
    const helios = await findRecord(page, 'companies', 'Helios Energy');
    await addEntry(page, list, helios);
    const [view] = await trpc<{ id: string }[]>(page, 'views.list', { entityDefinitionId: list.id });
    type Attr = { id: string; apiSlug: string; entityDefinitionId: string };
    const attrs = await trpc<Attr[]>(page, 'schema.attributes.list', { entityDefinitionId: list.id });
    const companyAttrs = await trpc<Attr[]>(page, 'schema.attributes.list', { entityDefinitionId: 'companies' });
    const stage = attrs.find((a) => a.apiSlug === 'stage') as Attr;
    const parent = attrs.find((a) => a.apiSlug === 'parent_record') as Attr;
    const description = companyAttrs.find((a) => a.apiSlug === 'description') as Attr;
    const hop = (a: Attr) => ({ entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id });
    await trpc(page, 'views.addColumn', { viewId: view?.id, id: uuid(), path: [hop(stage)] });
    await trpc(page, 'views.addColumn', { viewId: view?.id, id: uuid(), path: [hop(parent), hop(description)] });
    await page.goto(ws(`collection/${list.id}/view/${view?.id}`));
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('columnheader', { name: /Stage/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Parent Record › Description/ })).toBeVisible();

    // The parent column edits the parent record's value in place.
    const cell = page.locator('[role="row"][aria-rowindex="2"] [role="gridcell"][aria-colindex="3"]');
    await cell.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Edited from the list');
    await page.keyboard.press('Enter');
    await expect(cell).toHaveText('Edited from the list');
    await expect
      .poll(async () => {
        const { values } = await trpc<{
          values: Record<string, { state: string; value?: { values: { value: unknown }[] } }>;
        }>(page, 'values.list', {
          entityDefinitionId: description.entityDefinitionId,
          attributeDefinitionId: description.id,
          entityInstanceIds: [helios.entityInstanceId],
        });
        return values[helios.entityInstanceId]?.value?.values[0]?.value;
      })
      .toBe('Edited from the list');
    // The record column opens the parent record.
    await rows(page).first().getByTestId('entry-parent').click();
    await expect(page).toHaveURL(new RegExp(`modal=record`));
    await deleteList(page, list);
    await context.close();
  });
});
