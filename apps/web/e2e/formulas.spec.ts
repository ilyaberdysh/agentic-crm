// Formula attributes (BACKLOG 10.06; I-ai-calls/formulas.md): create a formula attribute from Settings → Objects →
// Projects with the editor sheet (chips from `{`, diagnostics with the error hover and Fix, preview against a record,
// output type), save it, see the values in the table and on the record page, and change a dependency so the value
// recomputes (< 2 s, acceptance 5). Runs with AGENTIC_CRM_LLM=fake (the AI composer answers from fixtures).
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { attributes, findProject, patchValues, trpc } from './record-support.ts';
import { signIn } from './support.ts';

const settings = `/${WORKSPACE_SLUG}/settings/data/objects/projects/attributes`;
const shots = 'e2e/out/shots';

test.describe.configure({ mode: 'serial' });

/** Unique per run (the stack may be reused across runs). */
const name = `Budget per head ${Date.now() % 100_000}`;

const sheet = (page: Page) => page.getByTestId('formula-sheet');
const editor = (page: Page) => sheet(page).getByTestId('formula-editor');

async function openFormulaEditor(page: Page, name: string) {
  await page.getByRole('button', { name: 'Create attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create attribute' });
  await dialog.getByRole('button', { name: 'Attribute Type' }).click();
  await page.getByRole('menuitemradio', { name: 'Formula', exact: true }).click();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create formula' }).click();
  await expect(sheet(page)).toBeVisible();
  return dialog;
}

test('create a formula attribute: chips, diagnostics, fix, preview, save, values recompute', async ({ page }) => {
  await signIn(page, settings);
  await expect(page.getByRole('button', { name: 'Create attribute' })).toBeVisible();
  const dialog = await openFormulaEditor(page, name);
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await page.screenshot({ path: `${shots}/formula-editor-empty.png` });

  // AI composer: a refusal shows the warning banner (unsupported function → "Try a different function").
  const composer = page.getByRole('textbox', { name: 'Generate with AI' });
  await composer.fill('Use a regular expression');
  await composer.press('Enter');
  const failure = page.getByTestId('formula-ai-failure');
  await expect(failure).toContainText('Regular expressions are not supported. Try a different function', {
    timeout: 15_000,
  });
  await failure.getByRole('button', { name: 'Dismiss' }).click();
  await expect(failure).toHaveCount(0);

  // Generate from a prompt (thinking → result highlighted in the editor).
  await composer.fill('Add one and two');
  await composer.press('Enter');
  await expect(page.getByTestId('formula-ai-thinking')).toBeVisible();
  await expect(editor(page)).toHaveText('1 + 2', { timeout: 15_000 });
  await expect(editor(page).locator('.cm-highlighted')).toHaveCount(1);
  await expect(page.getByTestId('formula-ai-thinking')).toHaveCount(0);
  await expect(composer).toHaveAttribute('placeholder', 'Refine your formula');

  // An unknown function: diagnostics summary, hover tooltip on the error, Save disabled.
  await editor(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' + unknownFn(1)');
  await expect(page.getByTestId('formula-diagnostics')).toHaveText(/Invalid function name unknownFn/);
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeDisabled();
  await editor(page).locator('.cm-formula-error').first().hover();
  await expect(page.locator('.cm-formula-tooltip')).toHaveText('Invalid function name unknownFn');
  await page.screenshot({ path: `${shots}/formula-editor-error-tooltip.png` });

  // Fix (fake LLM fixture) repairs the formula; the result is highlighted.
  await sheet(page).getByRole('button', { name: 'Fix' }).click();
  await expect(page.getByTestId('formula-diagnostics')).toHaveCount(0, { timeout: 15_000 });
  await expect(editor(page)).toHaveText('1 + 2');
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeEnabled();

  // References: `{Bud` filters the helper to Budget (partial text marked as an error), Enter inserts the chip.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('{Bud');
  const helper = page.getByTestId('formula-helper');
  // Only attributes match (earlier runs may have added "Budget per head …" formulas).
  await expect(helper.getByRole('group', { name: 'Functions' })).toHaveCount(0);
  await expect(helper.getByTestId('formula-helper-row').first()).toHaveText('Budget');
  await expect(page.getByTestId('formula-helper-detail')).toContainText('Returns currency.');
  await expect(page.getByTestId('formula-diagnostics')).toBeVisible();
  await page.screenshot({ path: `${shots}/formula-editor-helper-filter.png` });
  await page.keyboard.press('Enter');
  await expect(editor(page).getByTestId('formula-chip')).toHaveCount(1);
  await page.keyboard.type(' / {Headc');
  await page.keyboard.press('Enter');
  await expect(editor(page).getByTestId('formula-chip')).toHaveCount(2);
  // Valid: preview against the first project, Save enabled.
  await expect(page.getByTestId('formula-preview-value')).toHaveText(/\d/, { timeout: 10_000 });
  await expect(sheet(page).getByRole('button', { name: 'Save' })).toBeEnabled();
  await page.screenshot({ path: `${shots}/formula-editor-preview.png` });

  // Escape with unsaved edits asks first; Cancel keeps the sheet.
  await page.keyboard.press('Escape');
  const discard = page.getByRole('alertdialog');
  await expect(discard).toContainText('Discard changes?');
  await discard.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet(page)).toBeVisible();

  // Output type: Auto shows the inferred Number.
  await sheet(page).getByRole('button', { name: 'Output type' }).click();
  await expect(page.getByRole('menuitem', { name: /Auto/ })).toContainText('Number');
  await page.keyboard.press('Escape');

  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(dialog.getByTestId('formula-output')).toContainText('Number');
  await expect(dialog.getByTestId('formula-preview')).toBeVisible();
  await page.screenshot({ path: `${shots}/formula-create-dialog-filled.png` });
  await dialog.getByRole('button', { name: /Create attribute/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: name })).toContainText('Formula');
});

test('formula values: table column and record page, recomputed live when a dependency changes', async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  const project = await findProject(page, 'SEED-001');
  const attrs = (await attributes(page, 'projects')) as (Awaited<ReturnType<typeof attributes>>[number] & {
    title: string;
  })[];
  const formula = attrs.find((a) => a.title === name);
  const code = attrs.find((a) => a.apiSlug === 'code');
  const headcount = attrs.find((a) => a.apiSlug === 'headcount');
  if (!formula || !code || !headcount) throw new Error('missing attributes');
  // Headcount 12 → €120,000 / 12.
  await patchValues(page, project, { [headcount.id]: [{ value: 12 }] });
  const read = async () => {
    const { values } = await trpc<{ values: Record<string, { value: { values: { value: unknown }[] } }> }>(
      page,
      'values.list',
      {
        entityDefinitionId: project.entityDefinitionId,
        attributeDefinitionId: formula.id,
        entityInstanceIds: [project.entityInstanceId],
      },
    );
    return values[project.entityInstanceId]?.value.values[0]?.value ?? null;
  };
  await expect.poll(read, { timeout: 10_000 }).toBe(10_000);

  // A view with Code and the formula column.
  const viewId = randomUUID();
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: project.entityDefinitionId,
    type: 'table',
    title: `Formulas ${name}`,
    sortOrder: 'zz',
    columns: [code, formula].map((a) => ({
      id: randomUUID(),
      path: [{ entityDefinitionId: project.entityDefinitionId, attributeDefinitionId: a.id }],
    })),
  });
  await page.goto(`/${WORKSPACE_SLUG}/custom/projects/view/${viewId}`);
  const header = page.getByTestId('column-header').filter({ hasText: name });
  await expect(header.getByRole('button', { name: 'Formula' })).toBeVisible();
  const cell = page
    .locator(`[role="row"][data-record-id="${project.entityInstanceId}"]`)
    .locator('[role="gridcell"][aria-colindex="3"]');
  await expect(cell).toHaveText('10,000');
  await page.screenshot({ path: `${shots}/formula-table-column.png` });

  // Dependency change → the cell follows within 2 s (acceptance 5), without a reload.
  await patchValues(page, project, { [headcount.id]: [{ value: 8 }] });
  const started = Date.now();
  await expect(cell).toHaveText('15,000', { timeout: 5_000 });
  expect(Date.now() - started).toBeLessThan(3_000);

  // Record page: the fx marker and the read-only value.
  await page.goto(`/${WORKSPACE_SLUG}/custom/projects/record/${project.entityInstanceId}/overview`);
  await page.getByRole('button', { name: 'View all values' }).click();
  const row = page.locator(`[data-attribute="${formula.apiSlug}"]`);
  await expect(row.getByRole('img', { name: 'Formula' })).toBeVisible();
  await expect(row.getByTestId('attribute-value')).toHaveText('15,000');
  await patchValues(page, project, { [headcount.id]: [{ value: 12 }] });
  await expect(row.getByTestId('attribute-value')).toHaveText('10,000', { timeout: 5_000 });
});

test('edit a formula attribute: the saved formula reopens in the editor; a new snapshot recomputes the values', async ({
  page,
}) => {
  await signIn(page, settings);
  await page.getByRole('row').filter({ hasText: name }).click();
  const edit = page.getByRole('dialog', { name: 'Edit attribute' });
  await expect(edit.getByRole('button', { name: 'Type' })).toBeDisabled();
  await expect(edit.getByRole('button', { name: 'Type' })).toContainText('Formula');
  await expect(edit.getByTestId('formula-output')).toContainText('Number');
  const preview = edit.getByTestId('formula-preview');
  await expect(preview.getByTestId('formula-chip')).toHaveCount(2);
  await preview.click();
  await expect(editor(page).getByTestId('formula-chip')).toHaveCount(2);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' * 2');
  await expect(page.getByTestId('formula-preview-value')).toHaveText(/\d/, { timeout: 10_000 });
  // An output override that changes the attribute type asks before erasing values; Cancel keeps the sheet.
  await sheet(page).getByRole('button', { name: 'Output type' }).click();
  await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
  await expect(sheet(page).getByRole('button', { name: 'Output type' })).toHaveText(/Output: Text/);
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Different formula output type');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await sheet(page).getByRole('button', { name: 'Output type' }).click();
  await page.getByRole('menuitem', { name: /Auto/ }).click();
  await sheet(page).getByRole('button', { name: 'Save' }).click();
  await expect(edit.getByTestId('formula-preview')).toContainText('* 2');
  await edit.getByRole('button', { name: /Save changes/ }).click();
  await expect(edit).toHaveCount(0);

  const project = await findProject(page, 'SEED-001');
  const attrs = (await attributes(page, 'projects')) as (Awaited<ReturnType<typeof attributes>>[number] & {
    title: string;
  })[];
  const formula = attrs.find((a) => a.title === name);
  const read = async () => {
    const { values } = await trpc<{ values: Record<string, { value: { values: { value: unknown }[] } }> }>(
      page,
      'values.list',
      {
        entityDefinitionId: project.entityDefinitionId,
        attributeDefinitionId: formula?.id,
        entityInstanceIds: [project.entityInstanceId],
      },
    );
    return values[project.entityInstanceId]?.value.values[0]?.value ?? null;
  };
  await expect.poll(read, { timeout: 10_000 }).toBe(20_000);
});
