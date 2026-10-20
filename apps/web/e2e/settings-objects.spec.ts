// Settings → Objects and attribute administration (BACKLOG 2.13, 2.14, acceptance 7): objects list, activate a
// standard object, create a custom object (validation, 409), configuration autosave and slug change with the typed
// confirmation, attributes tab (create select / status / relationship, edit, duplicate, archive with Undo, restore).
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { signIn } from './support.ts';

const objectsPath = `/${WORKSPACE_SLUG}/settings/data/objects`;

async function openObjects(page: Page) {
  await signIn(page, objectsPath);
  await expect(page).toHaveURL(new RegExp(`${objectsPath}$`));
  await expect(page.getByRole('heading', { name: 'Objects', level: 1 })).toBeVisible();
}

const table = (page: Page, name: string) => page.getByRole('table', { name });
const row = (page: Page, tableName: string, text: string) =>
  table(page, tableName).getByRole('row').filter({ hasText: text }).first();

test.describe.configure({ mode: 'serial' });

test('objects list: columns, filter, activate a standard object', async ({ page }) => {
  await openObjects(page);
  const objects = table(page, 'Objects');
  await expect(objects.getByRole('columnheader', { name: /Object/ })).toBeVisible();
  await expect(row(page, 'Objects', 'Projects')).toContainText('Custom');
  await expect(row(page, 'Objects', 'Companies')).toContainText('Standard');
  // Custom objects first.
  await expect(objects.getByRole('row').nth(1)).toContainText('Projects');

  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Only show custom' }).click();
  await page.keyboard.press('Escape');
  await expect(row(page, 'Objects', 'Companies')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Only show custom' }).click();
  await page.keyboard.press('Escape');

  const users = row(page, 'Objects', 'Users');
  await users.getByRole('button', { name: 'Activate' }).click();
  await expect(page.getByText('Users object was activated')).toBeVisible();
  await expect(users.getByRole('button', { name: 'Activate' })).toHaveCount(0);
});

test('create custom object: validation, slug autofill, 409, navigation', async ({ page }) => {
  await openObjects(page);
  await page.getByRole('button', { name: 'Create custom object' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create object' });
  await expect(dialog.getByLabel('Plural noun')).toBeFocused();
  await dialog.getByRole('button', { name: /Create object/ }).click();
  await expect(dialog.getByText('Please provide a plural noun for this object.')).toBeVisible();
  await expect(dialog.getByText('Please provide a singular noun for this object.')).toBeVisible();
  await expect(dialog.getByText('Please provide a unique slug for this object.')).toBeVisible();

  await dialog.getByLabel('Plural noun').fill('Projects');
  await dialog.getByLabel('Singular noun').fill('Project');
  await expect(dialog.getByLabel(/Slug/)).toHaveValue('projects');
  await dialog.getByRole('button', { name: /Create object/ }).click();
  await expect(dialog.getByText('The slug "projects" is already in use')).toBeVisible();

  await dialog.getByLabel('Plural noun').fill('[e2e] Gadgets');
  await expect(dialog.getByLabel(/Slug/)).toHaveValue('e2e_gadgets');
  await dialog.getByLabel('Singular noun').fill('[e2e] Gadget');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(new RegExp(`${objectsPath}/e2e_gadgets/general$`));
  await expect(page.getByRole('heading', { name: '[e2e] Gadgets', level: 1 })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Attributes/ })).toContainText('5');
});

test('configuration: autosave nouns, change slug with typed confirmation', async ({ page }) => {
  await signIn(page, `${objectsPath}/e2e_gadgets/general`);
  const singular = page.getByLabel('Singular noun');
  await singular.fill('[e2e] Widget');
  const saved = page.waitForResponse((r) => r.url().includes('schema.objects.update') && r.ok());
  await singular.press('Enter');
  await saved;
  await page.reload();
  await expect(page.getByLabel('Singular noun')).toHaveValue('[e2e] Widget');

  await page.getByRole('button', { name: 'Change slug' }).click();
  const dialog = page.getByRole('dialog', { name: 'Change slug' });
  await dialog.getByLabel('Slug').fill('Bad Slug');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await expect(
    dialog.getByText('Slug must be lowercase and contain only letters, numbers and underscores.'),
  ).toBeVisible();

  await dialog.getByLabel('Slug').fill('projects');
  await dialog.getByRole('button', { name: /Save/ }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('button', { name: 'Update' })).toBeDisabled();
  await confirm.getByLabel('Enter the confirmation text').fill('Integrations using "e2e_gadgets" may be affected');
  await confirm.getByRole('button', { name: 'Update' }).click();
  await expect(dialog.getByText('This slug is already in use by another object.')).toBeVisible();

  await dialog.getByLabel('Slug').fill('e2e_widgets');
  await dialog.getByRole('button', { name: /Save/ }).click();
  await page
    .getByRole('alertdialog')
    .getByLabel('Enter the confirmation text')
    .fill('Integrations using "e2e_gadgets" may be affected');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Update' }).click();
  await expect(page).toHaveURL(new RegExp(`${objectsPath}/e2e_widgets/general$`));
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: /^Slug/ })).toHaveValue('e2e_widgets');
});

test('attributes: create select with options and default, edit, duplicate, archive + Undo, restore', async ({
  page,
}) => {
  await signIn(page, `${objectsPath}/e2e_widgets/attributes`);
  await expect(row(page, 'Attributes', 'Record ID')).toContainText('System');

  await page.getByRole('button', { name: 'Create attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create attribute' });
  await dialog.getByRole('button', { name: 'Attribute Type' }).click();
  await page.getByRole('menuitemradio', { name: 'Select', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Priority');
  await dialog.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Create option' }).click();
  await page.keyboard.type('High');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create option' }).click();
  await page.keyboard.type('Low');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Select a default option...' }).click();
  await page.getByRole('menuitemradio', { name: 'Low' }).click();
  await dialog.getByRole('button', { name: /Create attribute/ }).click();
  await expect(dialog).toBeHidden();
  const priority = row(page, 'Attributes', 'Priority');
  await expect(priority).toContainText('Select');

  // Edit: rename, add an option, make it required.
  await priority.click();
  const edit = page.getByRole('dialog', { name: 'Edit attribute' });
  await expect(edit.getByRole('button', { name: 'Type' })).toBeDisabled();
  await edit.getByLabel('Name', { exact: true }).fill('Priority level');
  await edit.getByText('Required', { exact: true }).click();
  await edit.getByRole('button', { name: 'Options', exact: true }).click();
  await page.getByRole('button', { name: 'Create option' }).click();
  await page.keyboard.type('Medium');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Options' })).toBeHidden();
  await edit.getByRole('button', { name: /Save changes/ }).click();
  await expect(edit).toBeHidden();
  const level = row(page, 'Attributes', 'Priority level');
  await expect(level).toContainText('Required');

  // Duplicate.
  await level.getByRole('button', { name: 'options' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate attribute' }).click();
  await expect(row(page, 'Attributes', 'Priority level (2)')).toBeVisible();

  // Archive with Undo (acceptance 7).
  await level.getByRole('button', { name: 'options' }).click();
  await page.getByRole('menuitem', { name: 'Archive attribute' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive attribute' }).click();
  await expect(page.getByText('attribute archived')).toBeVisible();
  await expect(table(page, 'Attributes').getByRole('button', { name: 'Archived' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(table(page, 'Attributes').getByRole('button', { name: 'Archived' })).toHaveCount(0);
  await expect(row(page, 'Attributes', 'Priority level')).toBeVisible();

  // Archive again, then restore from the Archived section.
  await row(page, 'Attributes', 'Priority level (2)').getByRole('button', { name: 'options' }).click();
  await page.getByRole('menuitem', { name: 'Archive attribute' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive attribute' }).click();
  await table(page, 'Attributes').getByRole('button', { name: 'Archived' }).click();
  await row(page, 'Attributes', 'Priority level (2)').getByRole('button', { name: 'options' }).click();
  await page.getByRole('menuitem', { name: 'Restore attribute' }).click();
  await expect(table(page, 'Attributes').getByRole('button', { name: 'Archived' })).toHaveCount(0);
});

test('attributes: status with stage settings, relationship pair, slug change', async ({ page }) => {
  await signIn(page, `${objectsPath}/e2e_widgets/attributes`);
  await page.getByRole('button', { name: 'Create attribute' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create attribute' });
  await dialog.getByRole('button', { name: 'Attribute Type' }).click();
  await page.getByRole('menuitemradio', { name: 'Status', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Stage');
  await dialog.getByRole('button', { name: 'Statuses', exact: true }).click();
  await page.getByRole('button', { name: 'Add status' }).click();
  await page.keyboard.type('Todo');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add status' }).click();
  await page.keyboard.type('Done');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Status options' }).last().click();
  await page.getByRole('switch', { name: 'Confetti' }).check({ force: true });
  await page.getByLabel('Time in status').fill('7');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Status options' })).toBeHidden();
  // Focus returns to the Statuses popover after the nested one closes (asynchronously): Escape must reach it.
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Statuses"]'))))
    .toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Statuses' })).toBeHidden();
  await dialog.getByRole('button', { name: /Create attribute/ }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Attributes', 'Stage')).toContainText('Status');

  // Relationship: both sides in one write.
  await page.getByRole('button', { name: 'Create attribute' }).click();
  dialog = page.getByRole('dialog', { name: 'Create attribute' });
  await dialog.getByRole('button', { name: 'Attribute Type' }).click();
  await page.getByRole('menuitemradio', { name: 'Relationship', exact: true }).click();
  await dialog.getByRole('button', { name: 'Relationship type' }).click();
  await page.getByRole('menuitemradio', { name: 'One to many' }).click();
  const names = dialog.getByLabel('Associated attribute name');
  await names.nth(0).fill('Contacts');
  await names.nth(1).fill('Widget');
  await dialog.getByRole('button', { name: /Create attribute/ }).click();
  await expect(dialog).toBeHidden();
  const contacts = row(page, 'Attributes', 'Contacts');
  await expect(contacts).toContainText('Relationship');
  await expect(contacts).toContainText('People');

  await page.goto(`${objectsPath}/people/attributes`);
  await expect(row(page, 'Attributes', 'Widget')).toContainText('Relationship');

  // Attribute slug change.
  await page.goto(`${objectsPath}/e2e_widgets/attributes`);
  await row(page, 'Attributes', 'Stage').getByRole('button', { name: 'options' }).click();
  await page.getByRole('menuitem', { name: 'Change slug' }).click();
  const slugDialog = page.getByRole('dialog', { name: 'Change slug' });
  await slugDialog.getByLabel('Slug').fill('pipeline_stage');
  await slugDialog.getByRole('button', { name: /Save/ }).click();
  await page
    .getByRole('alertdialog')
    .getByLabel('Enter the confirmation text')
    .fill('Integrations using "stage" may be affected');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Update' }).click();
  await expect(slugDialog).toBeHidden();
});
