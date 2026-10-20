// Kanban e2e fixtures: a custom object per test run with a "Stage" status attribute (the stages of Attio's
// "[seed] Project pipeline" study list: Lead, Qualified, Proposal, Negotiation, Won, Lost — Won with confetti), a
// "Deal value" currency, records spread 2/2/2/2/1/1 over the stages and a kanban view "[seed] Board" that opens first.
import { expect, type Page } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { trpc } from './views-support.ts';

export function uuidv7(): string {
  const ms = Date.now().toString(16).padStart(12, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${rand.slice(0, 3)}-${((Number.parseInt(rand.slice(3, 4), 16) & 0x3) | 0x8).toString(16)}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}

export const STAGES = [
  { title: 'Lead', color: 'block_yellow', count: 2 },
  { title: 'Qualified', color: 'block_brown', count: 2 },
  { title: 'Proposal', color: 'block_grey', count: 2 },
  { title: 'Negotiation', color: 'block_green', count: 2 },
  { title: 'Won', color: 'block_grey', count: 1, celebrate: true },
  { title: 'Lost', color: 'block_orange', count: 1 },
] as const;

export interface Board {
  objectId: string;
  apiSlug: string;
  viewId: string;
  stageAttrId: string;
  valueAttrId: string;
  stageIds: Record<string, string>;
  /** Record ids per stage title, in creation order. */
  records: Record<string, string[]>;
  values: Record<string, number>;
  path: string;
}

/** Creates the board fixture (an admin call: the e2e user owns the workspace). */
export async function createBoard(
  page: Page,
  opts: { slug?: string; plural?: string; singular?: string; withValues?: boolean; empty?: boolean } = {},
): Promise<Board> {
  const apiSlug = opts.slug ?? `kanban_${Date.now().toString(36)}`;
  const objectId = uuidv7();
  await trpc(page, 'schema.objects.create', {
    id: objectId,
    apiSlug,
    singularNoun: opts.singular ?? '[seed] Project',
    pluralNoun: opts.plural ?? '[seed] Project pipeline',
  });
  const stageAttrId = uuidv7();
  const stageIds: Record<string, string> = {};
  for (const st of STAGES) stageIds[st.title] = uuidv7();
  await trpc(page, 'schema.attributes.create', {
    id: stageAttrId,
    entityDefinitionId: objectId,
    title: 'Stage',
    apiSlug: 'stage',
    type: 'pipeline',
    stages: STAGES.map((st) => ({
      id: stageIds[st.title],
      title: st.title,
      color: st.color,
      celebrationEnabled: 'celebrate' in st,
    })),
  });
  const valueAttrId = uuidv7();
  await trpc(page, 'schema.attributes.create', {
    id: valueAttrId,
    entityDefinitionId: objectId,
    title: 'Deal value',
    apiSlug: 'deal_value',
    type: 'currency',
    currencyConfiguration: {
      defaultCurrencyCode: 'USD',
      defaultDisplayType: 'symbol',
      defaultDecimalPlaces: 'two-decimals',
      defaultGroups: 'default',
    },
  });
  const records: Record<string, string[]> = {};
  const values: Record<string, number> = {};
  let n = 0;
  for (const st of STAGES) {
    records[st.title] = [];
    for (let i = 0; i < (opts.empty ? 0 : st.count); i++) {
      n++;
      const id = uuidv7();
      const value = n * 10_000;
      await trpc(page, 'records.put', {
        entityDefinitionId: objectId,
        entityInstanceId: id,
        values: {
          [stageAttrId]: [{ value: { pipelineStageId: stageIds[st.title] } }],
          ...(opts.withValues !== false ? { [valueAttrId]: [{ value: { currencyValue: value } }] } : {}),
        },
      });
      records[st.title]?.push(id);
      values[id] = value;
    }
  }
  const viewId = uuidv7();
  await trpc(page, 'views.create', {
    id: viewId,
    entityDefinitionId: objectId,
    type: 'kanban',
    title: '[seed] Board',
    sortOrder: '0001',
    kanbanPivotPath: [{ entityDefinitionId: objectId, attributeDefinitionId: stageAttrId }],
    columns: [],
    sorts: [],
    filter: null,
  });
  return {
    objectId,
    apiSlug,
    viewId,
    stageAttrId,
    valueAttrId,
    stageIds,
    records,
    values,
    path: `/${WORKSPACE_SLUG}/custom/${apiSlug}/view/${viewId}`,
  };
}

export const column = (page: Page, stageId: string) =>
  page.locator(`[data-testid="kanban-column"][data-stage="${stageId}"]`);
export const cardsIn = (page: Page, stageId: string) => column(page, stageId).getByTestId('kanban-card');
export const countOf = (page: Page, stageId: string) => column(page, stageId).getByTestId('kanban-column-count');
export const card = (page: Page, recordId: string) =>
  page.locator(`[data-testid="kanban-card"][data-card-id="${recordId}"]`);

export async function openBoard(page: Page, board: Board): Promise<void> {
  await page.goto(board.path);
  await expect(page.getByTestId('kanban-board')).toBeVisible();
  await expect(page.getByTestId('kanban-card').first()).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[data-testid="kanban-card"] [data-loading]'), null, {
    timeout: 5_000,
  });
}

/** Pointer drag of a card onto a column (4 px activation, then a few moves so dnd-kit sees "over"). */
export async function dragCard(page: Page, recordId: string, toStageId: string): Promise<void> {
  await column(page, toStageId).scrollIntoViewIfNeeded();
  await card(page, recordId).scrollIntoViewIfNeeded();
  const from = await card(page, recordId).boundingBox();
  const to = await column(page, toStageId).boundingBox();
  if (!from || !to) throw new Error('card or column not on screen');
  await page.mouse.move(from.x + 40, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y + 24, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 160, { steps: 10 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}
