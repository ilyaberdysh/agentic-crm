// AI autofill attributes (BACKLOG 10.05; I-ai-calls/ai-attributes.md): create a Summarize record attribute from the
// type picker's "AI Autofill" group, see the "AI Autofill" badge in settings, run it over a view's column with the
// "Recalculate values" confirmation (records × credits), watch the cells go "AI is thinking..." → generated value
// (realtime, no reload — X-24), and run one value from the record page. Runs with AGENTIC_CRM_LLM=fake (fixture
// packages/domain/src/ai/fixtures/e2e/formulas-ai-attributes.json answers "Summarize this project").
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { attributes, findProject, trpc } from './record-support.ts';
import { signIn } from './support.ts';

const settings = `/${WORKSPACE_SLUG}/settings/data/objects/projects/attributes`;
const shots = 'e2e/out/shots';
const SUMMARY = 'A build-phase project with a dedicated team and an approved budget.';

test.describe.configure({ mode: 'serial' });

/** Unique per run (the stack may be reused across runs). */
const name = `AI summary ${Date.now() % 100_000}`;

test('create a Summarize record attribute from the AI Autofill picker group', async ({ page }) => {
  await signIn(page, settings);
  await page.getByRole('button', { name: 'Create attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create attribute' });
  await dialog.getByRole('button', { name: 'Attribute Type' }).click();
  await expect(page.getByRole('group', { name: 'AI Autofill' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Summarize record' }).click();
  // Text type with AI autofill switched on: no Required / Unique constraints.
  await expect(dialog.getByRole('button', { name: 'Attribute Type' })).toContainText('Text');
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  const card = dialog.getByTestId('ai-autofill-card');
  await expect(card.getByRole('switch', { name: 'Set up AI autofill' })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Autofill type' })).toContainText('Summarize record');
  await expect(card).toContainText('Prompt (optional)');
  await expect(card).toContainText('AI will have access to all record attributes');
  await expect(dialog.getByText('Constraints')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/ai-attribute-create-summarize.png` });

  // Prompt completion requires a prompt; switching back to Summarize keeps it optional.
  await card.getByRole('button', { name: 'Autofill type' }).click();
  await page.getByRole('menuitemradio', { name: /Prompt completion/ }).click();
  await expect(card).toContainText('Use variables to specify which record attributes AI will have access to');
  await card.getByRole('button', { name: 'Autofill type' }).click();
  await page.getByRole('menuitemradio', { name: /Summarize record/ }).click();

  await dialog.getByRole('button', { name: /Create attribute/ }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Text');
  await expect(row).toContainText('AI Autofill');
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${shots}/ai-attribute-settings-row.png` });
});

test('run on a column with credit confirmation: thinking → value, then one value from the record page', async ({
  page,
}) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  const attrs = (await attributes(page, 'projects')) as (Awaited<ReturnType<typeof attributes>>[number] & {
    title: string;
  })[];
  const ai = attrs.find((a) => a.title === name);
  const code = attrs.find((a) => a.apiSlug === 'code');
  if (!ai || !code) throw new Error('missing attributes');
  const project = await findProject(page, 'SEED-001');
  const viewId = randomUUID();
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: project.entityDefinitionId,
    type: 'table',
    title: `AI ${name}`,
    sortOrder: 'zy',
    columns: [code, ai].map((a) => ({
      id: randomUUID(),
      path: [{ entityDefinitionId: project.entityDefinitionId, attributeDefinitionId: a.id }],
    })),
  });
  await page.goto(`/${WORKSPACE_SLUG}/custom/projects/view/${viewId}`);
  const header = page.getByTestId('column-header').filter({ hasText: name });
  await expect(header.getByRole('img', { name: 'AI autofill' })).toBeVisible();
  await header.click();
  await page.getByRole('menuitem', { name: 'Run AI autofill' }).click();
  const confirm = page.getByTestId('ai-recalculate-dialog');
  await expect(confirm).toContainText('Recalculate values');
  await expect(confirm).toContainText('By confirming the recalculation, 12 records will be updated.');
  await expect(confirm.getByTestId('ai-credits')).toHaveText('12 credits will be used');
  await page.screenshot({ path: `${shots}/ai-attribute-recalc-confirm-column.png` });
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('AI Recalculation has been requested')).toBeVisible();
  const cell = page
    .locator(`[role="row"][data-record-id="${project.entityInstanceId}"]`)
    .locator('[role="gridcell"][aria-colindex="3"]');
  // Every row is queued at once ("AI is thinking..."), then fills in live.
  await expect(cell).toHaveText(SUMMARY, { timeout: 20_000 });
  await expect(page.getByTestId('ai-thinking')).toHaveCount(0, { timeout: 20_000 });

  // Record page: the sparkle marker, hover "Run AI autofill" → 1 record / 1 credit.
  await page.goto(`/${WORKSPACE_SLUG}/custom/projects/record/${project.entityInstanceId}/overview`);
  await page.getByRole('button', { name: 'View all values' }).click();
  const field = page.locator(`[data-attribute="${ai.apiSlug}"]`);
  await expect(field.getByRole('img', { name: 'AI autofill' })).toBeVisible();
  const value = field.getByTestId('attribute-value');
  await expect(value).toContainText(SUMMARY);
  await value.hover();
  await field.getByRole('button', { name: 'Run AI autofill' }).click();
  await expect(confirm).toContainText('By confirming the recalculation, 1 record will be updated.');
  await expect(confirm.getByTestId('ai-credits')).toHaveText('1 credit will be used');
  await page.screenshot({ path: `${shots}/ai-attribute-recalc-confirm.png` });
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(value).toContainText(SUMMARY, { timeout: 20_000 });
  await expect(field.getByTestId('ai-thinking')).toHaveCount(0);
});

test('edit: the prompt keeps variable chips; switching autofill off removes the badge', async ({ page }) => {
  await signIn(page, settings);
  const row = page.getByRole('row').filter({ hasText: name });
  await row.click();
  const edit = page.getByRole('dialog', { name: 'Edit attribute' });
  const card = edit.getByTestId('ai-autofill-card');
  await expect(card.getByRole('switch', { name: 'Set up AI autofill' })).toBeChecked();
  await expect(card.getByRole('button', { name: 'Autofill type' })).toContainText('Summarize record');
  // "Use variable" opens the attribute picker; picking inserts a chip into the prompt.
  const prompt = card.getByTestId('prompt-editor');
  await prompt.click();
  await page.keyboard.type('Mention the budget ');
  await card.getByRole('button', { name: 'Use variable' }).click();
  await page.keyboard.type('Budg');
  await expect(page.locator('.cm-formula-completion')).toContainText('Budget');
  await page.waitForTimeout(150);
  await page.keyboard.press('Enter');
  await expect(prompt.getByTestId('formula-chip')).toHaveText('{Budget}');
  await edit.getByRole('button', { name: /Save changes/ }).click();
  await expect(edit).toHaveCount(0);

  await row.click();
  await expect(edit.getByTestId('prompt-editor')).toContainText('Mention the budget');
  await expect(edit.getByTestId('prompt-editor').getByTestId('formula-chip')).toHaveText('{Budget}');
  // The visually hidden switch input sits under its track.
  await edit
    .getByTestId('ai-autofill-card')
    .getByRole('switch', { name: 'Set up AI autofill' })
    .uncheck({ force: true });
  await edit.getByRole('button', { name: /Save changes/ }).click();
  await expect(edit).toHaveCount(0);
  await expect(row).not.toContainText('AI Autofill');
});
