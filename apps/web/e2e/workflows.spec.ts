// Slice 8 workflows e2e (BACKLOG §8 acceptance 2, 4, 5): build "Record created → If amount > 10 → Create task" in the
// canvas editor, publish, create records and check one run per record with the right path in the run viewer; edit the
// live workflow (unpublished changes banner, publish confirmation), then restore the first version from the version
// history (a new draft forks from it); a failed run is retried from the failed block.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { signedInPage, trpc, ws } from './slice3-support.ts';
import {
  buildWorkflow,
  createOpportunity,
  type Opportunities,
  opportunities,
  poll,
  runsOf,
} from './workflows-support.ts';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

let page: Page;
let opp: Opportunities;
let workflowId = '';
const title = `Big deal follow-up ${Date.now().toString(36).slice(-4)}`;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ({ page } = await signedInPage(browser, ws('automations/workflows')));
  opp = await opportunities(page);
});

test.afterAll(async () => {
  // Leave the sidebar's Records section as it was for specs that run later on the same database.
  if (workflowId) await trpc(page, 'workflows.disable', { workflowId }).catch(() => {});
  if (opp) await trpc(page, 'schema.objects.archive', { entityDefinitionId: opp.objectId }).catch(() => {});
  await page.context().close();
});

/** Picks a variable in the open picker: a block row, then items by label. */
async function pickVariable(blockTitle: string, ...labels: string[]) {
  const picker = page.getByTestId('variable-picker').last();
  await picker.getByTestId('picker-block').filter({ hasText: blockTitle }).first().click();
  for (const label of labels) {
    await page
      .getByTestId('variable-picker')
      .last()
      .locator(`[data-testid="picker-item"][data-label="${label}"]`)
      .first()
      .click();
  }
}

test('acceptance 2: Record created → If amount > 10 → Create task, built in the editor', async () => {
  await page.goto(ws('automations/workflows'));
  await page.getByTestId('new-workflow').click();
  await expect(page.getByTestId('empty-editor')).toBeVisible();
  workflowId = (await page.getByTestId('workflow-page').getAttribute('data-workflow-id')) ?? '';
  expect(workflowId).not.toBe('');

  const titleInput = page.getByTestId('workflow-title');
  await titleInput.fill(title);
  await titleInput.press('Enter');

  // Trigger: Record created on the opportunities object.
  await page.getByTestId('start-from-scratch').click();
  await page.getByTestId('trigger-picker').locator('[data-slug="on-record-created"]').click();
  await expect(page.getByTestId('block-panel')).toHaveAttribute('data-slug', 'on-record-created');
  await page.getByTestId('definition-select-object').click();
  await page.getByRole('option', { name: opp.plural }).click();
  await expect(page.getByTestId('definition-select-object')).toContainText(opp.plural);

  // Next step: If, with "Amount greater than 10".
  await page.getByTestId('select-next-block').click();
  await expect(page.getByTestId('next-placeholder')).toBeVisible();
  await page.getByTestId('block-palette').locator('[data-slug="branch"]').click();
  await expect(page.getByTestId('block-panel')).toHaveAttribute('data-slug', 'branch');
  await page.getByTestId('add-condition').click();
  await pickVariable('Record created', opp.singular, 'Amount');
  await page.getByRole('menuitem', { name: 'greater than', exact: true }).click();
  await page.getByTestId('condition-value').fill('10');
  await page.getByTestId('condition-value').press('Enter');
  await expect(page.getByTestId('condition-operator')).toHaveText(/greater than/);

  // True → Create task, its content with an inline variable typed after "{".
  await page.locator('[data-outcome="true"] [data-testid="select-next-block"]').click();
  await page.getByTestId('block-palette').locator('[data-slug="create-task"]').click();
  await expect(page.getByTestId('block-panel')).toHaveAttribute('data-slug', 'create-task');
  const content = page.locator('[data-testid="config-field"][data-key="content"] [data-testid="variable-text"]');
  await content.click();
  await page.keyboard.type('Follow up on a deal of ');
  await page.keyboard.type('{');
  await pickVariable('Record created', opp.singular, 'Amount');
  await expect(content.getByTestId('variable-chip')).toBeVisible();
  await page.getByTestId('block-description').click();

  // The canvas shows the three blocks and two paths.
  await expect(page.getByTestId('block-node')).toHaveCount(3);
  await expect(page.locator('.react-flow__edge')).toHaveCount(2);

  // First publish: no confirmation; the workflow goes live.
  await expect(page.getByTestId('unpublished-banner')).toBeVisible();
  await page.getByTestId('publish-changes').click();
  await expect(page.getByTestId('unpublished-banner')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('switch', { name: 'Live' })).toBeChecked();

  // One run per created record.
  const big = await createOpportunity(page, opp, 25);
  const small = await createOpportunity(page, opp, 5);
  const runs = await poll(
    () => runsOf(page, workflowId),
    (r) => r.length === 2 && r.every((x) => x.status === 'completed'),
    45_000,
  );
  expect(runs).toHaveLength(2);

  // The task exists for the big deal only.
  const tasks = await trpc<{ groups: { tasks: { content: { text: string }; linkedRecords?: unknown }[] }[] }>(
    page,
    'tasks.list',
    { groupBy: 'none', filter: {} },
  );
  const texts = tasks.groups.flatMap((g) => g.tasks.map((t) => t.content.text));
  expect(texts).toContain('Follow up on a deal of 25');
  expect(texts).not.toContain('Follow up on a deal of 5');
  expect(big).not.toBe(small);

  // Run viewer: both runs listed; each shows its path.
  await page.getByTestId('workflow-tab-runs').click();
  await expect(page.getByTestId('run-row')).toHaveCount(2);
  const tagsOf = async () =>
    page.locator('[data-testid="block-node"]').evaluateAll((nodes) =>
      nodes.map((n) => ({
        slug: n.getAttribute('data-slug'),
        tag: n.querySelector('[data-testid="run-tag"]')?.getAttribute('data-status') ?? null,
      })),
    );
  const seen: Record<string, string | null>[] = [];
  for (const i of [0, 1]) {
    await page.getByTestId('run-row').nth(i).click();
    await expect(page.getByTestId('run-chip')).toHaveAttribute('data-status', 'completed');
    await expect(page.locator('[data-slug="branch"] [data-testid="run-tag"]')).toHaveAttribute(
      'data-status',
      'completed',
    );
    const tags = await tagsOf();
    seen.push(Object.fromEntries(tags.map((t) => [t.slug as string, t.tag])));
  }
  // Exactly one run reached Create task (true path); the other stopped after If (false path).
  expect(seen.filter((s) => s['create-task'] === 'completed')).toHaveLength(1);
  expect(seen.filter((s) => s['create-task'] === null)).toHaveLength(1);
  expect(seen.every((s) => s['on-record-created'] === 'completed')).toBe(true);

  // Block detail: the If block of the open run.
  await page.locator('[data-testid="block-node"][data-slug="branch"]').click();
  await expect(page.getByTestId('run-block-panel')).toBeVisible();
  await expect(page.getByTestId('run-block-status')).toHaveText(/Completed/);

  // The index lists the workflow as Live.
  await page.goto(ws('automations/workflows'));
  const row = page.locator(`[data-testid="workflow-row"][data-workflow-id="${workflowId}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId('workflow-status')).toHaveAttribute('data-status', 'live');
});

test('acceptance 4: unpublished changes on a live workflow; restoring a version forks a new draft', async () => {
  await page.goto(ws(`automations/workflows/${workflowId}/editor`));
  await expect(page.getByTestId('workflow-canvas')).toBeVisible();
  await expect(page.getByTestId('unpublished-banner')).toBeHidden();

  // Edit the live workflow: the condition value 10 → 20.
  await page.locator('[data-testid="block-node"][data-slug="branch"]').click();
  await page.getByTestId('condition-value').fill('20');
  await page.getByTestId('condition-value').press('Enter');
  await expect(page.getByTestId('unpublished-banner')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('discard-changes')).toBeVisible();

  // Publishing changes to a live workflow asks first.
  await page.getByTestId('publish-changes').click();
  await expect(page.getByRole('alertdialog')).toContainText('Are you sure you want to publish these changes?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByTestId('unpublished-banner')).toBeHidden({ timeout: 15_000 });

  // Version history: current draft + two published versions (newest Live).
  await page
    .getByTestId('workflow-canvas')
    .locator('.react-flow__pane')
    .click({ position: { x: 40, y: 400 } });
  await page.getByTestId('version-history-toggle').click();
  const rows = page.getByTestId('version-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'live');

  // Open the first version read-only and restore it.
  await rows.nth(2).click();
  await expect(page.getByTestId('old-version-banner')).toBeVisible();
  await page.getByTestId('restore-version').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('old-version-banner')).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId('version-history')).toContainText('Current draft, restored from');
  await expect(page.getByTestId('unpublished-banner')).toBeVisible({ timeout: 10_000 });

  // The new draft carries the first version's condition (> 10) while the live version keeps > 20.
  const detail = await trpc<{ version: { blocks: { slug: string; config: { entries: Record<string, unknown> } }[] } }>(
    page,
    'workflows.get',
    { workflowId },
  );
  const branch = detail.version.blocks.find((b) => b.slug === 'branch');
  expect(JSON.stringify(branch?.config.entries.predicate)).toContain('"value":10');
});

test('acceptance 5: a failed run is retried from the failed block', async () => {
  let server: Server | null = null;
  // A port that is closed at first: the HTTP request fails.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const { workflowId: id } = await buildWorkflow(
    page,
    `Retry check ${Date.now().toString(36).slice(-4)}`,
    [
      { slug: 'on-manual-run' },
      {
        slug: 'send-http-request',
        config: {
          method: { type: 'string', value: 'GET' },
          url: { type: 'rich-text', blocks: [{ plaintext: `http://127.0.0.1:${port}/ok`, variables: [] }] },
        },
      },
      { slug: 'formula', config: { formula: { type: 'rich-text', blocks: [{ plaintext: '1 + 1', variables: [] }] } } },
    ],
    [
      [0, 'done', 1],
      [1, 'done', 2],
    ],
  );
  await trpc(page, 'workflows.publish', { workflowId: id });

  try {
    await page.goto(ws(`automations/workflows/${id}/editor`));
    await page.getByTestId('trigger-workflow').click();
    await expect(page).toHaveURL(/\/runs\/[^/]+\/[^/]+$/);
    await expect(page.getByTestId('run-chip')).toHaveAttribute('data-status', 'failed', { timeout: 30_000 });
    await expect(page.locator('[data-slug="send-http-request"] [data-testid="run-tag"]')).toHaveAttribute(
      'data-status',
      'failed',
    );
    await page.locator('[data-testid="block-node"][data-slug="send-http-request"]').click();
    await expect(page.getByTestId('run-block-error')).toContainText('Request failed');

    // Bring the endpoint up, then Retry → Retry from failed.
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server?.listen(port, '127.0.0.1', resolve));
    await page.getByTestId('retry-menu').click();
    await page.getByRole('menuitem', { name: 'Retry from failed' }).click();
    await expect(page.getByTestId('run-chip')).toHaveAttribute('data-status', 'completed', { timeout: 30_000 });
    await expect(page.getByTestId('attempt-menu')).toHaveText(/Attempt #2/);
    await expect(page.locator('[data-slug="formula"] [data-testid="run-tag"]')).toHaveAttribute(
      'data-status',
      'completed',
    );
    const runs = await runsOf(page, id);
    expect(runs).toHaveLength(1);
  } finally {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }
});

test('canvas: B opens the palette, drag to connect, Organize with Undo, copy / paste and delete', async () => {
  const { workflowId: id, ids } = await buildWorkflow(
    page,
    `Canvas check ${Date.now().toString(36).slice(-4)}`,
    [
      { slug: 'on-manual-run', position: { x: 0, y: 0 } },
      {
        slug: 'formula',
        position: { x: 120, y: 260 },
        config: { formula: { type: 'rich-text', blocks: [{ plaintext: '2 * 21', variables: [] }] } },
      },
    ],
    [],
  );
  const detail = () =>
    trpc<{ version: { blocks: { id: string; position: { x: number; y: number } }[]; paths: unknown[] } }>(
      page,
      'workflows.get',
      { workflowId: id },
    );
  await page.goto(ws(`automations/workflows/${id}/editor`));
  await expect(page.getByTestId('block-node')).toHaveCount(2);

  // B: the block palette with All | Triggers | Steps; Esc goes back.
  await page
    .getByTestId('workflow-canvas')
    .locator('.react-flow__pane')
    .click({ position: { x: 30, y: 600 } });
  await page.keyboard.press('b');
  await expect(page.getByTestId('block-palette')).toHaveAttribute('data-purpose', 'add');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('block-palette')).toBeHidden();

  // Drag from the trigger's handle onto the formula card.
  const handle = page.locator(`[data-block-id="${ids[0]}"] [data-testid="outcome-handle"]`);
  const target = page.locator(`[data-block-id="${ids[1]}"]`);
  const from = await handle.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('no boxes');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 20, { steps: 12 });
  await expect(target.locator('[data-drop-target]')).toBeVisible();
  await page.mouse.up();
  await poll(detail, (d) => d.version.paths.length === 1, 10_000);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);

  // Organize blocks, then Undo restores the previous positions.
  await page.getByTestId('organize-blocks').click();
  const organized = await poll(detail, (d) => d.version.blocks.some((b) => b.id === ids[1] && b.position.x === 270));
  expect(organized.version.blocks.find((b) => b.id === ids[1])?.position).toEqual({ x: 270, y: 0 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await poll(detail, (d) =>
    d.version.blocks.some((b) => b.id === ids[1] && b.position.x === 120 && b.position.y === 260),
  );

  // Right-click: Copy block, then Paste on the canvas; Delete removes the copy after confirming.
  await page.locator(`[data-block-id="${ids[1]}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Copy block' }).click();
  await page
    .getByTestId('workflow-canvas')
    .locator('.react-flow__pane')
    .click({ button: 'right', position: { x: 60, y: 620 } });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect(page.getByTestId('block-node')).toHaveCount(3);
  await poll(detail, (d) => d.version.blocks.length === 3, 10_000);
  await page.keyboard.press('Delete');
  await expect(page.getByRole('alertdialog')).toContainText('Are you sure you want to delete this block?');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('block-node')).toHaveCount(2);
  await poll(detail, (d) => d.version.blocks.length === 2, 10_000);
});
