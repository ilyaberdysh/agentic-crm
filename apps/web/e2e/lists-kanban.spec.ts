// List boards (BACKLOG 4.05/4.06 on lists, acceptance 2 and 6): a kanban view of a list renders on the list page;
// dragging an entry writes the list's Stage (value history + the parent record's Activity) and fires confetti on a
// celebration stage; a board grouped through `parent_record` moves the parent record's stage; an entry created
// through the public API (/v2, API token) appears on the open board without a reload.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { API_ORIGIN, databaseUrl, E2E_DATABASE, WORKSPACE_SLUG } from './env.ts';
import { card, cardsIn, column, countOf, dragCard, uuidv7 } from './kanban-support.ts';
import { findRecord, type Hit } from './lists-support.ts';
import { signInTo, trpc } from './views-support.ts';

const STAGES = [
  { title: 'Lead', color: 'block_orange' },
  { title: 'Qualified', color: 'block_yellow' },
  { title: 'Won', color: 'block_green', celebrationEnabled: true },
] as const;
type StageTitle = (typeof STAGES)[number]['title'];

interface ListBoard {
  listId: string;
  viewId: string;
  stageAttrId: string;
  stageIds: Record<StageTitle, string>;
  path: string;
}

interface HistoryValue {
  value: { pipelineStageId?: string } | null;
  activeUntil: string | null;
}

async function history(page: Page, entityDefinitionId: string, entityInstanceId: string, attributeId: string) {
  const out = await trpc<{ values: HistoryValue[] } | HistoryValue[]>(page, 'records.history', {
    entityDefinitionId,
    entityInstanceId,
    attributeDefinitionId: attributeId,
  });
  return Array.isArray(out) ? out : out.values;
}

/** A Stage status (Lead / Qualified / Won with confetti) on `definitionId`. */
async function stageAttribute(page: Page, definitionId: string) {
  const stageAttrId = uuidv7();
  const stageIds = Object.fromEntries(STAGES.map((s) => [s.title, uuidv7()])) as Record<StageTitle, string>;
  await trpc(page, 'schema.attributes.create', {
    id: stageAttrId,
    entityDefinitionId: definitionId,
    title: 'Stage',
    apiSlug: 'stage',
    type: 'pipeline',
    stages: STAGES.map((s) => ({
      id: stageIds[s.title],
      title: s.title,
      color: s.color,
      celebrationEnabled: 'celebrationEnabled' in s,
    })),
  });
  return { stageAttrId, stageIds };
}

async function createListBoard(
  page: Page,
  parentObjectId: string,
  groupBy: (list: { id: string; parentRecordAttributeId: string }, stageAttrId: string) => unknown,
  stageOn: 'list' | { attrId: string; stageIds: Record<StageTitle, string> },
): Promise<ListBoard> {
  const { list } = await trpc<{ list: { id: string; parentRecordAttributeId: string } }>(page, 'lists.create', {
    id: uuidv7(),
    name: `[seed] Board list ${Date.now().toString(36)}`,
    icon: 'emoji:clipboard',
    parentEntityDefinitionIds: [parentObjectId],
  });
  const own = stageOn === 'list' ? await stageAttribute(page, list.id) : null;
  const stageAttrId = own?.stageAttrId ?? (stageOn as { attrId: string }).attrId;
  const stageIds = own?.stageIds ?? (stageOn as { stageIds: Record<StageTitle, string> }).stageIds;
  const viewId = uuidv7();
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: list.id,
    type: 'kanban',
    title: '[seed] Board',
    sortOrder: '0001',
    kanban: { groupBy: groupBy(list, stageAttrId) },
  });
  return {
    listId: list.id,
    viewId,
    stageAttrId,
    stageIds,
    path: `/${WORKSPACE_SLUG}/collection/${list.id}/view/${viewId}`,
  };
}

async function addEntry(page: Page, listId: string, record: Hit, values?: Record<string, unknown>) {
  const out = await trpc<{ entries: { id: string }[] }>(page, 'entries.add', {
    listId,
    parentRecords: [{ entityDefinitionId: record.entityDefinitionId, entityInstanceId: record.entityInstanceId }],
    ...(values ? { values } : {}),
    onDuplicate: 'keep',
  });
  return out.entries[0]?.id as string;
}

async function openListBoard(page: Page, board: ListBoard): Promise<void> {
  await page.goto(board.path);
  await expect(page.getByTestId('list-page')).toBeVisible();
  await expect(page.getByTestId('kanban-board')).toBeVisible();
}

/** A workspace API token for /v2 (the CLI, as an admin would: `pnpm --filter @agentic-crm/api token:create`). */
function apiToken(): string {
  const apiRoot = fileURLToPath(new URL('../../api', import.meta.url));
  const out = spawnSync('pnpm', ['exec', 'tsx', 'src/cli/token-create.ts', WORKSPACE_SLUG, 'e2e lists board', 'all'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl(E2E_DATABASE) },
    encoding: 'utf8',
  });
  const token = /Token: (\S+)/.exec(out.stdout)?.[1];
  if (!token) throw new Error(`token:create failed: ${out.stdout} ${out.stderr}`);
  return token;
}

test.describe.configure({ mode: 'serial' });

test('a list kanban view: drag writes the list Stage (history, Activity), confetti on Won', async ({ page }) => {
  await signInTo(page, '/mymeet/home');
  const companies = (await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: 'companies' })).id;
  const board = await createListBoard(
    page,
    companies,
    (list, stageAttrId) => [{ entityDefinitionId: list.id, attributeDefinitionId: stageAttrId }],
    'list',
  );
  const northwind = await findRecord(page, 'companies', 'Northwind');
  const bluefin = await findRecord(page, 'companies', 'Bluefin');
  const lead = board.stageIds.Lead;
  const qualified = board.stageIds.Qualified;
  const won = board.stageIds.Won;
  const e1 = await addEntry(page, board.listId, northwind, {
    [board.stageAttrId]: [{ value: { pipelineStageId: lead } }],
  });
  const e2 = await addEntry(page, board.listId, bluefin, {
    [board.stageAttrId]: [{ value: { pipelineStageId: lead } }],
  });

  await openListBoard(page, board);
  await expect(countOf(page, lead)).toHaveText('2');
  // Cards are entries titled by their parent record.
  await expect(card(page, e1)).toContainText('Northwind');

  await dragCard(page, e1, qualified);
  await expect(countOf(page, lead)).toHaveText('1');
  await expect(countOf(page, qualified)).toHaveText('1');
  await expect
    .poll(async () => {
      const values = await history(page, board.listId, e1, board.stageAttrId);
      return {
        current: values.find((v) => !v.activeUntil)?.value?.pipelineStageId,
        retired: values.filter((v) => v.activeUntil).map((v) => v.value?.pipelineStageId),
      };
    })
    .toEqual({ current: qualified, retired: [lead] });
  // The parent record's Activity shows the entry's stage change (lists events, D §3.8).
  const timeline = await trpc<{ events: unknown[] }>(page, 'timeline.list', {
    entityDefinitionId: northwind.entityDefinitionId,
    entityInstanceId: northwind.entityInstanceId,
    mode: 'past',
    disableGrouping: true,
  });
  expect(JSON.stringify(timeline.events)).toContain(board.stageAttrId);

  // Confetti on a celebration stage.
  const before = await page.evaluate(() => (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti ?? 0);
  await dragCard(page, e2, won);
  await expect(countOf(page, won)).toHaveText('1');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti ?? 0))
    .toBe(before + 1);

  // The time-in-stage chip (kanban.timeInStage) and a reload keep the server's columns.
  await expect(card(page, e1).getByTestId('time-in-stage')).toHaveText('0d');
  await page.reload();
  await expect(countOf(page, qualified)).toHaveText('1');
  await expect(column(page, won).locator(`[data-card-id="${e2}"]`)).toBeVisible();
  await trpc(page, 'lists.delete', { listId: board.listId }).catch(() => undefined);
});

test('a board grouped through parent_record moves the parent record’s stage', async ({ page }) => {
  await signInTo(page, '/mymeet/home');
  const objectId = uuidv7();
  const apiSlug = `listparent_${Date.now().toString(36)}`;
  await trpc(page, 'schema.objects.create', {
    id: objectId,
    apiSlug,
    singularNoun: '[seed] Opportunity',
    pluralNoun: '[seed] Opportunities',
  });
  const nameAttr = (
    await trpc<{ id: string; apiSlug: string }[]>(page, 'schema.attributes.list', { entityDefinitionId: objectId })
  ).find((a) => a.apiSlug === 'name');
  const stage = await stageAttribute(page, objectId);
  const recordId = uuidv7();
  await trpc(page, 'records.put', {
    entityDefinitionId: objectId,
    entityInstanceId: recordId,
    values: {
      ...(nameAttr ? { [nameAttr.id]: [{ value: '[seed] Parent-grouped' }] } : {}),
      [stage.stageAttrId]: [{ value: { pipelineStageId: stage.stageIds.Lead } }],
    },
  });
  const board = await createListBoard(
    page,
    objectId,
    (list, stageAttrId) => [
      { entityDefinitionId: list.id, attributeDefinitionId: list.parentRecordAttributeId },
      { entityDefinitionId: objectId, attributeDefinitionId: stageAttrId },
    ],
    { attrId: stage.stageAttrId, stageIds: stage.stageIds },
  );
  const entry = await addEntry(page, board.listId, {
    entityDefinitionId: objectId,
    entityInstanceId: recordId,
    title: null,
  });
  await openListBoard(page, board);
  await expect(column(page, stage.stageIds.Lead).locator(`[data-card-id="${entry}"]`)).toBeVisible();

  await dragCard(page, entry, stage.stageIds.Qualified);
  await expect(countOf(page, stage.stageIds.Qualified)).toHaveText('1');
  // kanban.move wrote the stage on the parent record (not on the entry).
  await expect
    .poll(
      async () =>
        (await history(page, objectId, recordId, stage.stageAttrId)).find((v) => !v.activeUntil)?.value
          ?.pipelineStageId,
    )
    .toBe(stage.stageIds.Qualified);
  await trpc(page, 'lists.delete', { listId: board.listId }).catch(() => undefined);
  await trpc(page, 'schema.objects.archive', { entityDefinitionId: objectId }).catch(() => undefined);
});

test('an entry created through the public API appears live on the open board', async ({ page }) => {
  test.setTimeout(60_000);
  await signInTo(page, '/mymeet/home');
  const companies = (await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: 'companies' })).id;
  const board = await createListBoard(
    page,
    companies,
    (list, stageAttrId) => [{ entityDefinitionId: list.id, attributeDefinitionId: stageAttrId }],
    'list',
  );
  const cedar = await findRecord(page, 'companies', 'Cedar');
  await openListBoard(page, board);
  await expect(cardsIn(page, board.stageIds.Lead)).toHaveCount(0);

  const token = apiToken();
  const res = await fetch(`${API_ORIGIN}/v2/lists/${board.listId}/entries`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      data: { parent_record_id: cedar.entityInstanceId, parent_object: 'companies', entry_values: { stage: 'Lead' } },
    }),
  });
  expect(res.status).toBe(200);
  const created = (await res.json()) as { data: { id: { entry_id: string } } };
  const entryId = created.data.id.entry_id;

  // No reload: the change feed invalidates the board's columns (realtime, I4).
  await expect(column(page, board.stageIds.Lead).locator(`[data-card-id="${entryId}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await expect(countOf(page, board.stageIds.Lead)).toHaveText('1');
  await expect(card(page, entryId)).toContainText('Cedar');
  await trpc(page, 'lists.delete', { listId: board.listId }).catch(() => undefined);
});
