// Slice 4 kanban (C2 kanban K1–K8, README §4): view settings, columns per stage with totals, first ids, per-column
// calculations (X-23), hidden and archived stages (X-08), moves on the card's own status or on the parent record's
// status through parent_record, Confetti, time in stage, object boards (Deals), permissions.
import type { Path } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { addMember, collabFixture, createRecord } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

type Fixture = Awaited<ReturnType<typeof collabFixture>>;

async function board(f: Fixture) {
  const { list } = await domain.lists.create(f.ctx, { name: 'Pipeline', parentEntityDefinitionIds: ['companies'] });
  const stage = await domain.schema.createAttribute(f.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    title: 'Stage',
    type: 'pipeline',
    stages: [
      { title: 'Lead' },
      { title: 'Qualified' },
      { title: 'Won', celebrationEnabled: true, targetTimeInStatus: 'P0Y0M7DT0H0M0S' },
      { title: 'Lost' },
    ],
  });
  const value = await domain.schema.createAttribute(f.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    title: 'Deal value',
    type: 'currency',
  });
  const [lead, qualified, won, lost] = (
    await domain.schema.listStages(f.ctx, { entityDefinitionId: list.id, attributeDefinitionId: stage.id })
  ).map((s) => s.id) as [string, string, string, string];
  const stagePath: Path = [{ entityDefinitionId: list.id, attributeDefinitionId: stage.id }];
  const valuePath: Path = [{ entityDefinitionId: list.id, attributeDefinitionId: value.id }];
  const entries: string[] = [];
  const add = async (name: string, stageId: string | null, amount: number | null) => {
    const company = await createRecord(f, 'companies', { name: [{ value: name }] });
    const { entries: created } = await domain.entries.add(f.ctx, {
      listId: list.id,
      parentRecords: [{ entityDefinitionId: f.companies, entityInstanceId: company }],
      values: {
        ...(stageId ? { stage: [{ value: { pipelineStageId: stageId } }] } : {}),
        ...(amount !== null ? { deal_value: [{ value: { currencyValue: amount } }] } : {}),
      },
    });
    const id = created[0]?.id as string;
    entries.push(id);
    return { entry: id, company };
  };
  return { list, stage, value, lead, qualified, won, lost, stagePath, valuePath, entries, add };
}

describe('kanban views', () => {
  it('stores kanban settings on the view and validates them', async () => {
    const f = await collabFixture();
    const b = await board(f);
    const companies = await domain.schema.getObject(f.ctx, 'companies');
    const name = (await domain.schema.getAttribute(f.ctx, 'companies', 'name')).id;
    const parentName: Path = [
      { entityDefinitionId: b.list.id, attributeDefinitionId: b.list.parentRecordAttributeId },
      { entityDefinitionId: companies.id, attributeDefinitionId: name },
    ];
    const view = await domain.views.create(f.ctx, {
      id: newId(),
      entityDefinitionId: b.list.id,
      type: 'kanban',
      title: 'Board',
      kanban: { groupBy: b.stagePath, cardAttributePaths: [b.valuePath, parentName] },
    });
    expect(view.kanban).toEqual({
      groupBy: b.stagePath,
      hiddenStageIds: [],
      cardAttributePaths: [b.valuePath, parentName],
      showLabels: false,
      showNoStage: true,
      showTimeInStage: true,
      calculation: null,
    });
    expect(view.kanbanPivotPath).toEqual(b.stagePath);
    const columnId = view.columns[1]?.id;
    const updated = await domain.views.update(f.ctx, {
      viewId: view.id,
      kanban: {
        cardAttributePaths: [parentName],
        showLabels: true,
        showNoStage: false,
        hiddenStageIds: [b.lost],
        calculation: { path: b.valuePath, aggregation: 'sum' },
      },
    });
    expect(updated.columns.map((c) => c.id)).toEqual([columnId]);
    expect(updated.kanban).toMatchObject({
      showLabels: true,
      showNoStage: false,
      hiddenStageIds: [b.lost],
      calculation: { path: b.valuePath, aggregation: 'sum' },
    });
    expect(updated.kanbanIsNoStatusVisible).toBe(false);

    await expectCode(
      domain.views.update(f.ctx, {
        viewId: view.id,
        kanban: { calculation: { path: b.stagePath, aggregation: 'sum' } },
      }),
      'VALIDATION_ERROR',
    );
    await expectCode(
      domain.views.update(f.ctx, { viewId: view.id, kanban: { groupBy: b.valuePath } }),
      'VALIDATION_ERROR',
    );
    const [table] = await domain.views.list(f.ctx, { entityDefinitionId: b.list.id });
    expect(table?.kanban).toBeNull();
    await expectCode(
      domain.views.update(f.ctx, { viewId: table?.id as string, kanban: { showLabels: true } }),
      'VALIDATION_ERROR',
    );
  });
});

describe('kanban columns', () => {
  it('returns one column per visible stage with totals, newest-first ids and per-column calculations', async () => {
    const f = await collabFixture();
    const b = await board(f);
    const a1 = await b.add('A1', b.lead, 100);
    const a2 = await b.add('A2', b.lead, null);
    const q1 = await b.add('Q1', b.qualified, 300);
    await b.add('None', null, 50);
    const view = await domain.views.create(f.ctx, {
      id: newId(),
      entityDefinitionId: b.list.id,
      type: 'kanban',
      title: 'Board',
      kanban: {
        groupBy: b.stagePath,
        hiddenStageIds: [b.lost],
        calculation: { path: b.valuePath, aggregation: 'percent_empty' },
      },
    });
    const out = await domain.kanban.columns(f.ctx, { entityDefinitionId: b.list.id, viewId: view.id });
    expect(out.attribute).toMatchObject({ attributeDefinitionId: b.stage.id, type: 'pipeline' });
    expect(out.stages.map((s) => [s.title, s.isHidden])).toEqual([
      ['Lead', false],
      ['Qualified', false],
      ['Won', false],
      ['Lost', true],
    ]);
    expect(out.columns.map((c) => [c.stageId, c.total])).toEqual([
      [null, 1],
      [b.lead, 2],
      [b.qualified, 1],
      [b.won, 0],
    ]);
    // No persisted in-column order: newest first by default (C.4 #11).
    expect(out.columns[1]?.firstIds).toEqual([a2.entry, a1.entry]);
    // X-23: percent empty per column from total and filled (Lead: 1 of 2 empty).
    expect(out.columns[1]?.aggregate).toMatchObject({ aggregation: 'percent_empty', value: 50, total: 2, filled: 1 });
    expect(out.columns[3]?.aggregate).toMatchObject({ value: 0, total: 0 });

    // Drafts override the view: a sum, a filter, the hidden stage shown, one card per column + paging.
    const sums = await domain.kanban.columns(f.ctx, {
      entityDefinitionId: b.list.id,
      viewId: view.id,
      calculation: { path: b.valuePath, aggregation: 'sum' },
      includeHidden: true,
      cardsPerColumn: 1,
      filter: {
        path: b.valuePath,
        mode: 'must',
        constraints: [{ field: 'raw_value', operator: 'gte', value: 100 }],
      },
    });
    expect(sums.columns.map((c) => [c.stageId, c.total, c.aggregate?.value])).toEqual([
      [null, 0, 0],
      [b.lead, 1, 100],
      [b.qualified, 1, 300],
      [b.won, 0, 0],
      [b.lost, 0, 0],
    ]);
    const unfiltered = await domain.kanban.columns(f.ctx, {
      entityDefinitionId: b.list.id,
      viewId: view.id,
      cardsPerColumn: 1,
    });
    const lead = unfiltered.columns[1];
    expect(lead?.firstIds).toEqual([a2.entry]);
    const more = await domain.kanban.columnChunk(f.ctx, {
      entityDefinitionId: b.list.id,
      snapshotId: lead?.snapshotId as string,
      start: 1,
      size: 10,
    });
    expect(more.ids).toEqual([a1.entry]);
    await expectCode(
      domain.kanban.columnChunk(f.ctx, {
        entityDefinitionId: 'companies',
        snapshotId: lead?.snapshotId as string,
        start: 0,
      }),
      'SNAPSHOT_NOT_FOUND',
    );

    // Archived stages are never columns (X-08); their cards keep the value.
    await domain.schema.updateStage(f.ctx, {
      entityDefinitionId: b.list.id,
      attributeDefinitionId: b.stage.id,
      pipelineStageId: b.qualified,
      isArchived: true,
    });
    const afterArchive = await domain.kanban.columns(f.ctx, { entityDefinitionId: b.list.id, viewId: view.id });
    expect(afterArchive.columns.map((c) => c.stageId)).toEqual([null, b.lead, b.won]);
    const q1Entry = await domain.entries.get(f.ctx, { listId: b.list.id, entryId: q1.entry });
    expect(q1Entry.values[b.stage.id]?.[0]?.value).toEqual({ pipelineStageId: b.qualified });
  });
});

describe('kanban moves', () => {
  it('moves a card on its own status: history, Confetti, No stage, archived targets refused', async () => {
    const f = await collabFixture();
    const b = await board(f);
    const card = await b.add('Acme', b.lead, 10);
    const move = (toStageId: string | null, attributeValueId?: string) =>
      domain.kanban.move(f.ctx, {
        entityDefinitionId: b.list.id,
        entityInstanceId: card.entry,
        groupBy: b.stagePath,
        toStageId,
        ...(attributeValueId ? { attributeValueId } : {}),
      });
    const valueId = newId();
    const won = await move(b.won, valueId);
    expect(won).toMatchObject({
      target: { entityDefinitionId: b.list.id, entityInstanceId: card.entry, attributeDefinitionId: b.stage.id },
      changed: true,
      celebrate: true,
    });
    expect(won.values.map((v) => [v.id, v.value])).toEqual([[valueId, { pipelineStageId: b.won }]]);
    expect((await move(b.won, valueId)).changed).toBe(false); // replay
    expect((await move(b.won)).changed).toBe(false); // already there
    const qualified = await move(b.qualified);
    expect(qualified).toMatchObject({ changed: true, celebrate: false });
    const history = await domain.values.history(f.ctx, {
      entityDefinitionId: b.list.id,
      entityInstanceId: card.entry,
      attributeDefinitionId: b.stage.id,
    });
    expect(history.values.map((v) => (v.value as { pipelineStageId: string }).pipelineStageId)).toEqual([
      b.qualified,
      b.won,
      b.lead,
    ]);
    const cleared = await move(null);
    expect(cleared).toMatchObject({ changed: true, values: [] });
    await domain.schema.updateStage(f.ctx, {
      entityDefinitionId: b.list.id,
      attributeDefinitionId: b.stage.id,
      pipelineStageId: b.lost,
      isArchived: true,
    });
    await expectCode(move(b.lost), 'VALUE_VALIDATION_FAILED');
    // The parent's activity shows the entry's stage changes.
    const timeline = await domain.timeline.list(f.ctx, {
      entityDefinitionId: f.companies,
      entityInstanceId: card.company,
      filters: ['lists'],
      disableGrouping: true,
    });
    expect(timeline.events.length).toBeGreaterThanOrEqual(4);
  });

  it('groups through parent_record: columns and moves use the parent record’s status', async () => {
    const f = await collabFixture();
    const b = await board(f);
    const tier = await domain.schema.createAttribute(f.ctx, {
      id: newId(),
      entityDefinitionId: 'companies',
      title: 'Tier',
      type: 'pipeline',
      stages: [{ title: 'Bronze' }, { title: 'Gold', celebrationEnabled: true }],
    });
    const [bronze, gold] = (
      await domain.schema.listStages(f.ctx, { entityDefinitionId: 'companies', attributeDefinitionId: tier.id })
    ).map((s) => s.id) as [string, string];
    const card = await b.add('Acme', b.lead, null);
    await b.add('Globex', b.lead, null);
    await domain.records.update(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: card.company,
      values: { tier: [{ value: { pipelineStageId: bronze } }] },
    });
    const groupBy: Path = [
      { entityDefinitionId: b.list.id, attributeDefinitionId: b.list.parentRecordAttributeId },
      { entityDefinitionId: f.companies, attributeDefinitionId: tier.id },
    ];
    const view = await domain.views.create(f.ctx, {
      id: newId(),
      entityDefinitionId: b.list.id,
      type: 'kanban',
      title: 'By tier',
      kanbanPivotPath: groupBy,
    });
    const cols = await domain.kanban.columns(f.ctx, { entityDefinitionId: b.list.id, viewId: view.id });
    expect(cols.attribute).toMatchObject({ entityDefinitionId: f.companies, attributeDefinitionId: tier.id });
    expect(cols.columns.map((c) => [c.stageId, c.total])).toEqual([
      [null, 1],
      [bronze, 1],
      [gold, 0],
    ]);
    const moved = await domain.kanban.move(f.ctx, {
      entityDefinitionId: b.list.id,
      entityInstanceId: card.entry,
      groupBy,
      toStageId: gold,
    });
    expect(moved).toMatchObject({
      target: { entityDefinitionId: f.companies, entityInstanceId: card.company, attributeDefinitionId: tier.id },
      changed: true,
      celebrate: true,
    });
    const company = await domain.records.get(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: card.company,
    });
    expect(company.values[tier.id]?.[0]?.value).toEqual({ pipelineStageId: gold });
    const entry = await domain.entries.get(f.ctx, { listId: b.list.id, entryId: card.entry });
    expect(entry.values[b.stage.id]?.[0]?.value).toEqual({ pipelineStageId: b.lead });
    const after = await domain.kanban.columns(f.ctx, { entityDefinitionId: b.list.id, viewId: view.id });
    expect(after.columns.map((c) => c.total)).toEqual([1, 0, 1]);
  });

  it('computes time in stage from the value history and flags overdue stages', async () => {
    const f = await collabFixture();
    const b = await board(f);
    const fresh = await b.add('Fresh', b.won, null);
    const stale = await b.add('Stale', b.won, null);
    const none = await b.add('None', null, null);
    await sql`UPDATE attribute_values SET active_from = now() - interval '10 days'
      WHERE instance_id = ${stale.entry}::uuid AND attribute_id = ${b.stage.id}::uuid`.execute(database.kysely);
    const { items } = await domain.kanban.timeInStage(f.ctx, {
      entityDefinitionId: b.list.id,
      entityInstanceIds: [fresh.entry, stale.entry, none.entry],
      groupBy: b.stagePath,
    });
    expect(items[fresh.entry]).toMatchObject({ stageId: b.won, days: 0, isOverdue: false });
    expect(items[stale.entry]).toMatchObject({
      stageId: b.won,
      days: 10,
      targetTimeInStatus: 'P0Y0M7DT0H0M0S',
      isOverdue: true,
    });
    expect(items[none.entry]).toEqual({
      stageId: null,
      enteredAt: null,
      days: null,
      targetTimeInStatus: null,
      isOverdue: false,
    });
  });

  it('works on object boards (Deals pipeline) and enforces list access on moves', async () => {
    const f = await collabFixture();
    await domain.schema.updateObject(f.ctx, { entityDefinitionId: 'deals', isArchived: false });
    const [pipelineView] = (await domain.views.list(f.ctx, { entityDefinitionId: 'deals' })).filter(
      (v) => v.type === 'kanban',
    );
    expect(pipelineView?.kanban?.groupBy).toHaveLength(1);
    const deal = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'deals',
      entityInstanceId: deal,
      values: { name: [{ value: 'Big deal' }] },
    });
    const cols = await domain.kanban.columns(f.ctx, {
      entityDefinitionId: 'deals',
      viewId: pipelineView?.id as string,
    });
    expect(cols.columns.find((c) => c.firstIds.includes(deal))?.stageId).toBe(cols.stages[0]?.id);
    const won = cols.stages.find((s) => s.title === 'Won');
    const moved = await domain.kanban.move(f.ctx, {
      entityDefinitionId: 'deals',
      entityInstanceId: deal,
      groupBy: pipelineView?.kanban?.groupBy as Path,
      toStageId: won?.id as string,
    });
    expect(moved.celebrate).toBe(true);
    // Deal stage is required: No stage is refused.
    await expectCode(
      domain.kanban.move(f.ctx, {
        entityDefinitionId: 'deals',
        entityInstanceId: deal,
        groupBy: pipelineView?.kanban?.groupBy as Path,
        toStageId: null,
      }),
      'VALUE_VALIDATION_FAILED',
    );

    const b = await board(f);
    const card = await b.add('Acme', b.lead, null);
    const bob = await addMember(f, 'Bob');
    await domain.lists.setAccess(f.ctx, { listId: b.list.id, workspaceAccess: 'read-only' });
    expect(
      (await domain.kanban.columns(bob.ctx, { entityDefinitionId: b.list.id, groupBy: b.stagePath })).columns,
    ).toHaveLength(5);
    await expectCode(
      domain.kanban.move(bob.ctx, {
        entityDefinitionId: b.list.id,
        entityInstanceId: card.entry,
        groupBy: b.stagePath,
        toStageId: b.won,
      }),
      'FORBIDDEN',
    );
  });
});
