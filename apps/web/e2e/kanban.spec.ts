// Kanban behaviour (BACKLOG 4.05, 4.06; acceptance 2 and 3): pointer and keyboard drag and drop write a new stage
// value (visible in the value history and the record's activity), confetti on a celebration stage, the board-wide
// calculation per column (table kinds, X-23), stage menu hide/collapse, card fields and labels, add a card with the
// stage preset, and live updates from another session.
import { expect, test } from '@playwright/test';
import {
  type Board,
  card,
  cardsIn,
  column,
  countOf,
  createBoard,
  dragCard,
  openBoard,
  STAGES,
  uuidv7,
} from './kanban-support.ts';
import { signInTo, trpc } from './views-support.ts';

interface HistoryValue {
  value: { pipelineStageId?: string } | null;
  activeUntil: string | null;
}

async function stageHistory(page: Parameters<typeof trpc>[0], board: Board, recordId: string) {
  const out = await trpc<{ values: HistoryValue[] } | HistoryValue[]>(page, 'records.history', {
    entityDefinitionId: board.objectId,
    entityInstanceId: recordId,
    attributeDefinitionId: board.stageAttrId,
  });
  return Array.isArray(out) ? out : out.values;
}

let board: Board;

test.beforeEach(async ({ page }) => {
  await signInTo(page, '/mymeet/home');
  board = await createBoard(page);
  await openBoard(page, board);
});

// Each test's object leaves the sidebar afterwards (archived; the test database is recreated per run anyway).
test.afterEach(async ({ page }) => {
  await trpc(page, 'schema.objects.archive', { entityDefinitionId: board.objectId }).catch(() => {});
});

test('dragging a card to another stage writes a new status value (history and activity)', async ({ page }) => {
  const lead = board.stageIds.Lead as string;
  const proposal = board.stageIds.Proposal as string;
  const moved = board.records.Lead?.[0] as string;
  await expect(countOf(page, lead)).toHaveText('2');
  await expect(countOf(page, proposal)).toHaveText('2');

  await dragCard(page, moved, proposal);

  // Optimistic: counts move at once and the card sits in the destination.
  await expect(countOf(page, lead)).toHaveText('1');
  await expect(countOf(page, proposal)).toHaveText('3');
  await expect(column(page, proposal).locator(`[data-card-id="${moved}"]`)).toBeVisible();
  await expect(page.getByTestId('kanban-card-placeholder')).toHaveCount(0);

  // A new current value for Proposal; the Lead value is retired (I6) — the history shows both.
  await expect
    .poll(async () => {
      const values = await stageHistory(page, board, moved);
      const current = values.find((v) => !v.activeUntil)?.value?.pipelineStageId;
      const retired = values.filter((v) => v.activeUntil).map((v) => v.value?.pipelineStageId);
      return { current, retired };
    })
    .toEqual({ current: proposal, retired: [lead] });

  // The record's activity lists the change (D §3.8 attribute events).
  const timeline = await trpc<{ events: { kind?: string; type?: string }[] }>(page, 'timeline.list', {
    entityDefinitionId: board.objectId,
    entityInstanceId: moved,
    mode: 'past',
    disableGrouping: true,
  });
  expect(JSON.stringify(timeline.events)).toContain(board.stageAttrId);

  // Survives a reload (server order).
  await page.reload();
  await expect(countOf(page, proposal)).toHaveText('3');
  await expect(column(page, proposal).locator(`[data-card-id="${moved}"]`)).toBeVisible();
});

test('keyboard drag and drop: space picks up, arrows move between columns, space drops', async ({ page }) => {
  const qualified = board.stageIds.Qualified as string;
  const proposal = board.stageIds.Proposal as string;
  const moved = board.records.Qualified?.[1] as string;
  await page.locator(`[data-testid="kanban-card-handle"]:has([data-card-id="${moved}"])`).focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Card is over Qualified.');
  // dnd-kit's keyboard sensor starts listening for arrows on the next tick after the pick-up.
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Card is over Proposal.');
  await page.keyboard.press('Space');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Dropped card in Proposal.');
  await expect(countOf(page, qualified)).toHaveText('1');
  await expect(countOf(page, proposal)).toHaveText('3');
  await expect
    .poll(async () => (await stageHistory(page, board, moved)).find((v) => !v.activeUntil)?.value?.pipelineStageId)
    .toBe(proposal);

  // Escape cancels: nothing moves.
  const other = board.records.Lead?.[0] as string;
  await page.locator(`[data-testid="kanban-card-handle"]:has([data-card-id="${other}"])`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Card is over Lead.');
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Card is over Qualified.');
  await page.keyboard.press('Escape');
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText('Cancelled dragging card.');
  await expect(countOf(page, board.stageIds.Lead as string)).toHaveText('2');
});

test('confetti fires when a card lands in a celebration stage', async ({ page }) => {
  const before = await page.evaluate(() => (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti ?? 0);
  await dragCard(page, board.records.Negotiation?.[0] as string, board.stageIds.Won as string);
  await expect(countOf(page, board.stageIds.Won as string)).toHaveText('2');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti ?? 0))
    .toBe(before + 1);
  await expect(page.getByTestId('kanban-confetti')).toHaveCount(1);
  // No celebration on an ordinary stage.
  await dragCard(page, board.records.Lead?.[0] as string, board.stageIds.Qualified as string);
  await expect(countOf(page, board.stageIds.Qualified as string)).toHaveText('3');
  expect(await page.evaluate(() => (window as unknown as { __kanbanConfetti?: number }).__kanbanConfetti)).toBe(
    before + 1,
  );
});

test('the board calculation shows one value per column; counts and percents follow the table rule', async ({
  page,
}) => {
  const footer = (stage: string) => column(page, board.stageIds[stage] as string).getByTestId('kanban-calculation');
  await footer('Lead').click();
  await page.getByTestId('calc-kind-sum').click();
  await page.getByRole('button', { name: 'Deal value', exact: true }).click();
  // Lead holds records 1 and 2 (10 000 + 20 000), Won record 9 (90 000).
  await expect(footer('Lead')).toContainText('30,000');
  await expect(footer('Lead')).toContainText('sum');
  await expect(footer('Won')).toContainText('90,000');
  await expect(footer('Lost')).toContainText('100,000');

  // Count filled / percent empty of Deal value: blank one record in Proposal.
  const proposalRecord = board.records.Proposal?.[0] as string;
  await trpc(page, 'records.patch', {
    entityDefinitionId: board.objectId,
    entityInstanceId: proposalRecord,
    values: { [board.valueAttrId]: [] },
  });
  await footer('Proposal').click();
  await page.getByTestId('calc-kind-percent_empty').click();
  await page.getByRole('button', { name: 'Deal value', exact: true }).click();
  await expect(footer('Proposal')).toContainText('50');
  await expect(footer('Proposal')).toContainText('empty');
  await expect(footer('Lead')).toContainText('0');
  await footer('Lead').click();
  await page.getByTestId('calc-kind-count_not_empty').click();
  await page.getByRole('button', { name: 'Deal value', exact: true }).click();
  await expect(footer('Proposal')).toContainText(/^1\s*filled$/);
  await expect(footer('Lead')).toContainText(/^2\s*filled$/);
  // Shared on the view: a reload keeps it.
  await page.reload();
  await expect(footer('Negotiation')).toContainText(/^2\s*filled$/);
});

test('stage menu: hide and collapse; Visible columns brings a stage back', async ({ page }) => {
  const proposal = board.stageIds.Proposal as string;
  await column(page, proposal).getByRole('button', { name: 'Proposal stage options' }).click();
  await page.getByTestId('kanban-stage-menu').getByRole('button', { name: 'Collapse stage' }).click();
  await expect(column(page, proposal).getByRole('button', { name: '2 Proposal' })).toBeVisible();
  await page.reload();
  await expect(column(page, proposal).getByRole('button', { name: '2 Proposal' })).toBeVisible();
  await column(page, proposal).getByRole('button', { name: '2 Proposal' }).dblclick();
  await expect(column(page, proposal).getByTestId('kanban-column-header')).toBeVisible();

  await column(page, proposal).getByRole('button', { name: 'Proposal stage options' }).click();
  await page.getByTestId('kanban-stage-menu').getByRole('button', { name: 'Hide stage' }).click();
  await expect(column(page, proposal)).toHaveCount(0);
  await page.getByTestId('view-settings').click();
  await expect(page.getByTestId('kanban-settings-columns')).toContainText('5');
  await page.getByTestId('kanban-settings-columns').click();
  await page.getByTestId(`visible-${proposal}`).getByText('Proposal').click();
  await expect(column(page, proposal)).toHaveCount(1);
  await expect(countOf(page, proposal)).toHaveText('2');
});

test('card rows: added attributes render on cards, labels toggle, empty rows can be hidden', async ({ page }) => {
  await page.getByTestId('view-settings').click();
  await page.getByTestId('kanban-settings-add').click();
  await page.getByRole('option', { name: 'Deal value', exact: true }).click();
  await page.keyboard.press('Escape');
  const first = card(page, board.records.Lead?.[0] as string);
  await expect(first.getByTestId('kanban-card-field')).toContainText('$10,000.00');
  await page.getByTestId('view-settings').click();
  await page.getByText('Show attribute labels', { exact: true }).click();
  await expect(first.getByTestId('kanban-card-field')).toContainText('Deal value');
  await page.getByText('Hide empty attributes', { exact: true }).click();
  await trpc(page, 'records.patch', {
    entityDefinitionId: board.objectId,
    entityInstanceId: board.records.Lead?.[0] as string,
    values: { [board.valueAttrId]: [] },
  });
  await expect(first.getByTestId('kanban-card-field')).toHaveCount(0);
});

test('"+" in a stage header creates a card in that stage', async ({ page }) => {
  const lost = board.stageIds.Lost as string;
  await column(page, lost).getByRole('button', { name: 'New [seed] Project' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Lost');
  await dialog.getByRole('button', { name: /Create record/ }).click();
  await expect(countOf(page, lost)).toHaveText('2');
});

test('another session moving a card updates the board live', async ({ page, browser }) => {
  const won = board.stageIds.Won as string;
  const moved = board.records.Lost?.[0] as string;
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signInTo(page2, '/mymeet/home');
  await trpc(page2, 'values.put', {
    entityDefinitionId: board.objectId,
    entityInstanceId: moved,
    attributeDefinitionId: board.stageAttrId,
    attributeValueId: uuidv7(),
    value: { pipelineStageId: won },
  });
  await other.close();
  await expect(countOf(page, won)).toHaveText('2');
  await expect(cardsIn(page, won)).toHaveCount(2);
  await expect(countOf(page, board.stageIds.Lost as string)).toHaveText('0');
});

test('time in stage shows whole days on every card', async ({ page }) => {
  await expect(card(page, board.records.Lead?.[0] as string).getByTestId('time-in-stage')).toHaveText('0d');
  expect(STAGES.length).toBe(6);
});
