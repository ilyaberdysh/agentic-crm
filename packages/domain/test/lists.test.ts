// Slice 4 domain: lists (create, sidebar order, update, duplicate with new ids, delete), entries (add with duplicate
// handling, remove, a record's entries, list_entries bookkeeping, timeline), views/snapshots/aggregates over entries
// incl. paths through parent_record, access levels, and record delete/restore/merge carrying entries.
import type { TimelineEvent, TimelineItem } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { addMember, collabFixture, createRecord } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

type Fixture = Awaited<ReturnType<typeof collabFixture>>;

const flat = (items: TimelineItem[]): TimelineEvent[] =>
  items.flatMap((i) => (i.kind === 'single' ? [i.event] : i.events));

/** A companies list with a Stage status (Lead → Won, Won has Confetti), a Deal value and a Tags select. */
async function pipeline(f: Fixture, name = 'Deals pipeline') {
  const { list, view } = await domain.lists.create(f.ctx, { name, parentEntityDefinitionIds: ['companies'] });
  const stage = await domain.schema.createAttribute(f.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    title: 'Stage',
    type: 'pipeline',
    stages: [
      { title: 'Lead', color: 'block_blue' },
      { title: 'Qualified', color: 'block_yellow' },
      { title: 'Won', color: 'block_green', celebrationEnabled: true, targetTimeInStatus: 'P0Y0M7DT0H0M0S' },
    ],
  });
  const value = await domain.schema.createAttribute(f.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    title: 'Deal value',
    type: 'currency',
  });
  const tags = await domain.schema.createAttribute(f.ctx, {
    id: newId(),
    entityDefinitionId: list.id,
    title: 'Tags',
    type: 'select',
    isMultiselect: true,
    options: [{ title: 'Hot' }, { title: 'Cold' }],
  });
  const stages = await domain.schema.listStages(f.ctx, {
    entityDefinitionId: list.id,
    attributeDefinitionId: stage.id,
  });
  const [lead, qualified, won] = stages.map((s) => s.id) as [string, string, string];
  return { list, view, stage, value, tags, lead, qualified, won };
}

const companyRef = (f: Fixture, id: string) => ({ entityDefinitionId: f.companies, entityInstanceId: id });

describe('lists', () => {
  it('creates a list with system attributes, grants, a default view and a sidebar rank', async () => {
    const f = await collabFixture();
    const { list, view } = await domain.lists.create(f.ctx, {
      name: '  Investors  ',
      parentEntityDefinitionIds: ['companies'],
    });
    expect(list).toMatchObject({
      name: 'Investors',
      icon: 'emoji:clipboard',
      apiSlug: 'investors',
      parentEntityDefinitionIds: [f.companies],
      workspaceAccess: 'read-write',
      memberAccess: [{ memberId: f.memberId, scope: 'full-access' }],
      myAccess: 'full-access',
      entryCount: 0,
    });
    expect(view).toMatchObject({ type: 'table', title: 'All entries table', entityDefinitionId: list.id });
    const attrs = await domain.schema.listAttributes(f.ctx, { entityDefinitionId: list.id });
    expect(attrs.map((a) => [a.apiSlug, a.title, a.systemAttributeType])).toEqual([
      ['entry_id', 'Entry ID', 'id'],
      ['parent_record', 'Parent Record', 'entry-parent-record'],
      ['created_at', 'Added to list at', 'created-at'],
      ['created_by', 'Added to list by', 'created-by'],
    ]);
    expect(attrs[1]).toMatchObject({
      isRequired: true,
      isReadOnly: true,
      config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [f.companies] } },
    });
    expect((await domain.schema.getObject(f.ctx, list.id)).entityType).toBe('collection-entry');

    // Idempotent per id; API-style creates have no view; slugs stay unique.
    const id = newId();
    const a = await domain.lists.create(f.ctx, {
      id,
      name: 'Investors',
      parentEntityDefinitionIds: ['people'],
      createDefaultView: false,
      workspaceAccess: 'read-only',
    });
    const again = await domain.lists.create(f.ctx, { id, name: 'Other', parentEntityDefinitionIds: ['people'] });
    expect(a.view).toBeNull();
    expect(again.list).toMatchObject({ id, name: 'Investors', apiSlug: 'investors_2', workspaceAccess: 'read-only' });
    const sidebar = await domain.lists.list(f.ctx);
    expect(sidebar.map((l) => l.id)).toEqual([list.id, id]);
    expect((sidebar[0]?.sortOrder ?? '') < (sidebar[1]?.sortOrder ?? '')).toBe(true);

    await expectCode(
      domain.lists.create(f.ctx, { name: 'Tasks?', parentEntityDefinitionIds: ['workspace_members'] }),
      'VALIDATION_ERROR',
    );
    await expect(domain.lists.create(f.ctx, { name: ' ', parentEntityDefinitionIds: ['people'] })).rejects.toThrow(
      /name/,
    );
  });

  it('renames, changes icon and parents, and reorders the sidebar', async () => {
    const f = await collabFixture();
    const { list: a } = await domain.lists.create(f.ctx, { name: 'A', parentEntityDefinitionIds: ['companies'] });
    const { list: b } = await domain.lists.create(f.ctx, { name: 'B', parentEntityDefinitionIds: ['companies'] });
    const renamed = await domain.lists.update(f.ctx, {
      listId: a.id,
      name: 'Accounts',
      icon: 'emoji:rocket',
      parentEntityDefinitionIds: ['companies', 'people'],
    });
    expect(renamed).toMatchObject({
      name: 'Accounts',
      icon: 'emoji:rocket',
      parentEntityDefinitionIds: [f.companies, f.people],
    });
    const parent = await domain.schema.getAttribute(f.ctx, a.id, 'parent_record');
    expect(parent.config.entityReferenceConfiguration?.allowedEntityDefinitionIds).toEqual([f.companies, f.people]);
    await domain.lists.update(f.ctx, { listId: b.id, sortOrder: '0a' });
    expect((await domain.lists.list(f.ctx)).map((l) => l.id)).toEqual([b.id, a.id]);
    expect((await domain.lists.get(f.ctx, { listId: renamed.apiSlug })).id).toBe(a.id);
  });
});

describe('entries', () => {
  it('adds records with values, detects duplicates (cancel / skip / keep) and replays by entry id', async () => {
    const f = await collabFixture();
    const p = await pipeline(f);
    const other = await createRecord(f, 'companies', { name: [{ value: 'Globex' }] });
    const entryId = newId();
    const first = await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record],
      entryIds: [entryId],
      values: { stage: [{ value: { pipelineStageId: p.won } }], deal_value: [{ value: { currencyValue: 5000 } }] },
    });
    expect(first.celebrate).toBe(true);
    expect(first.duplicates).toEqual([]);
    expect(first.entries[0]).toMatchObject({ id: entryId, listId: p.list.id, parentRecord: f.record });
    expect(first.entries[0]?.values[p.stage.id]?.[0]?.value).toEqual({ pipelineStageId: p.won });
    // Added to list at / by are system values.
    const createdBy = (await domain.schema.getAttribute(f.ctx, p.list.id, 'created_by')).id;
    expect(first.entries[0]?.values[createdBy]?.[0]?.value).toEqual({
      referencedActorType: 'workspace-member',
      referencedActorId: f.memberId,
    });

    // Replay: same id, nothing new.
    const replay = await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record],
      entryIds: [entryId],
    });
    expect(replay.entries.map((e) => e.id)).toEqual([entryId]);
    expect(replay.duplicates).toEqual([]);

    const dupCheck = await domain.entries.checkDuplicates(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record, companyRef(f, other)],
    });
    expect(dupCheck.duplicateCount).toBe(1);
    expect(dupCheck.duplicates[0]).toMatchObject({ parentRecord: f.record, entries: [{ id: entryId }] });

    const cancelled = await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record, companyRef(f, other)],
      onDuplicate: 'cancel',
    });
    expect(cancelled.entries).toEqual([]);
    expect(cancelled.duplicates.map((d) => d.parentRecord)).toEqual([f.record]);
    const skipped = await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record, companyRef(f, other)],
      onDuplicate: 'skip',
      values: { stage: [{ value: { pipelineStageId: p.lead } }] },
    });
    expect(skipped.entries.map((e) => e.parentRecord.entityInstanceId)).toEqual([other]);
    expect(skipped.celebrate).toBe(false);
    const kept = await domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [f.record], onDuplicate: 'keep' });
    expect(kept.entries).toHaveLength(1);
    expect((await domain.lists.get(f.ctx, { listId: p.list.id })).entryCount).toBe(3);

    // A record of another object, an unknown record and the read-only parent are refused.
    await expectCode(
      domain.entries.add(f.ctx, {
        listId: p.list.id,
        parentRecords: [{ entityDefinitionId: 'people', entityInstanceId: f.person }],
      }),
      'VALUE_VALIDATION_FAILED',
    );
    await expectCode(
      domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [companyRef(f, newId())] }),
      'NOT_FOUND',
    );
    await expectCode(
      domain.entries.add(f.ctx, {
        listId: p.list.id,
        parentRecords: [companyRef(f, other)],
        onDuplicate: 'keep',
        values: { parent_record: [{ value: f.record }] },
      }),
      'ATTRIBUTE_READ_ONLY',
    );
    await expectCode(
      domain.values.put(f.ctx, {
        entityDefinitionId: p.list.id,
        entityInstanceId: entryId,
        attributeDefinitionId: 'parent_record',
        attributeValueId: newId(),
        value: companyRef(f, other),
      }),
      'ATTRIBUTE_READ_ONLY',
    );
  });

  it('keeps list_entries on records, lists a record’s memberships and removes entries', async () => {
    const f = await collabFixture();
    const a = await pipeline(f, 'A');
    const b = await pipeline(f, 'B');
    const [ea] = (await domain.entries.add(f.ctx, { listId: a.list.id, parentRecords: [f.record] })).entries;
    const [eb] = (await domain.entries.add(f.ctx, { listId: b.list.id, parentRecords: [f.record] })).entries;
    const record = await domain.records.get(f.ctx, f.record);
    const listEntries = (await domain.schema.getAttribute(f.ctx, 'companies', 'list_entries')).id;
    expect(record.values[listEntries]?.map((v) => v.value)).toEqual([
      { entityDefinitionId: a.list.id, entityInstanceId: ea?.id },
      { entityDefinitionId: b.list.id, entityInstanceId: eb?.id },
    ]);

    const { memberships } = await domain.entries.forRecord(f.ctx, { recordRef: f.record });
    expect(memberships.map((m) => [m.listId, m.entryId, m.list.name])).toEqual([
      [a.list.id, ea?.id, 'A'],
      [b.list.id, eb?.id, 'B'],
    ]);

    const removed = await domain.entries.remove(f.ctx, { listId: a.list.id, entryIds: [ea?.id as string, newId()] });
    expect(removed.removedIds).toEqual([ea?.id]);
    const after = await domain.records.get(f.ctx, f.record);
    expect(after.values[listEntries]?.map((v) => (v.value as { entityInstanceId: string }).entityInstanceId)).toEqual([
      eb?.id,
    ]);
    expect((await domain.entries.forRecord(f.ctx, { recordRef: f.record })).memberships).toHaveLength(1);
    await expectCode(domain.entries.get(f.ctx, { listId: a.list.id, entryId: ea?.id as string }), 'NOT_FOUND');

    // Activity of the parent: added, attribute change on the entry, removed.
    await domain.records.update(f.ctx, {
      entityDefinitionId: b.list.id,
      entityInstanceId: eb?.id as string,
      values: { stage: [{ value: { pipelineStageId: b.qualified } }] },
    });
    const events = flat(
      (await domain.timeline.list(f.ctx, { ...f.record, filters: ['lists'], disableGrouping: true })).events,
    );
    expect(events.map((e) => e.eventType).sort()).toEqual(
      ['list-attribute-values-updated', 'list-entry-created', 'list-entry-created', 'list-entry-deleted'].sort(),
    );
  });

  it('records take their entries along on delete and restore, and to the merged record', async () => {
    const f = await collabFixture();
    const p = await pipeline(f);
    const [entry] = (await domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [f.record] })).entries;
    await domain.records.delete(f.ctx, f.record);
    expect((await domain.lists.get(f.ctx, { listId: p.list.id })).entryCount).toBe(0);
    await domain.records.restore(f.ctx, f.record);
    expect((await domain.entries.get(f.ctx, { listId: p.list.id, entryId: entry?.id as string })).parentRecord).toEqual(
      f.record,
    );
    const listEntries = (await domain.schema.getAttribute(f.ctx, 'companies', 'list_entries')).id;
    expect((await domain.records.get(f.ctx, f.record)).values[listEntries]).toHaveLength(1);

    const dup = await createRecord(f, 'companies', { name: [{ value: 'Acme 2' }] });
    const merged = await domain.records.merge(f.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: f.company,
      targetEntityInstanceId: dup,
    });
    const mergedRef = companyRef(f, merged.record.entityInstanceId);
    expect((await domain.entries.get(f.ctx, { listId: p.list.id, entryId: entry?.id as string })).parentRecord).toEqual(
      mergedRef,
    );
    expect(merged.values[listEntries]).toHaveLength(1);
    expect((await domain.records.get(f.ctx, mergedRef)).values[listEntries]?.[0]?.value).toEqual({
      entityDefinitionId: p.list.id,
      entityInstanceId: entry?.id,
    });
  });
});

describe('views over entries', () => {
  it('filters, sorts and aggregates entries by list attributes and by paths through parent_record', async () => {
    const f = await collabFixture();
    const p = await pipeline(f);
    const names = ['Zeta', 'Alpha', 'Mid'];
    const ids: string[] = [];
    for (const [i, name] of names.entries()) {
      const company = await createRecord(f, 'companies', { name: [{ value: name }] });
      const { entries } = await domain.entries.add(f.ctx, {
        listId: p.list.id,
        parentRecords: [companyRef(f, company)],
        values: {
          stage: [{ value: { pipelineStageId: i === 0 ? p.lead : p.won } }],
          deal_value: [{ value: { currencyValue: (i + 1) * 100 } }],
        },
      });
      ids.push(entries[0]?.id as string);
    }
    const companies = await domain.schema.getObject(f.ctx, 'companies');
    const nameAttr = (await domain.schema.getAttribute(f.ctx, 'companies', 'name')).id;
    const parentPath = [
      { entityDefinitionId: p.list.id, attributeDefinitionId: p.list.parentRecordAttributeId },
      { entityDefinitionId: companies.id, attributeDefinitionId: nameAttr },
    ];
    const sorted = await domain.views.query(f.ctx, {
      entityDefinitionId: p.list.id,
      sorts: [{ path: parentPath, direction: 'asc' }],
    });
    expect(sorted.ids).toEqual([ids[1], ids[2], ids[0]]);
    const filtered = await domain.views.query(f.ctx, {
      entityDefinitionId: p.list.id,
      filter: {
        and: [
          { path: parentPath, mode: 'must', constraints: [{ field: 'value', operator: 'contains', value: 'a' }] },
          {
            path: [{ entityDefinitionId: p.list.id, attributeDefinitionId: p.stage.id }],
            mode: 'must',
            constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: p.won }],
          },
        ],
      },
    });
    expect(new Set(filtered.ids)).toEqual(new Set([ids[1]]));
    const sum = await domain.views.aggregate(f.ctx, {
      snapshotId: sorted.snapshotId,
      path: [{ entityDefinitionId: p.list.id, attributeDefinitionId: p.value.id }],
      aggregation: 'sum',
    });
    expect(sum).toMatchObject({ value: 600, total: 3, filled: 3 });
    const report = await domain.schema.verifyProjection(f.sys, p.list.id);
    expect(report.mismatchedRows).toBe(0);

    // Record views can filter by list membership through list_entries.
    const listEntries = (await domain.schema.getAttribute(f.ctx, 'companies', 'list_entries')).id;
    const inWon = await domain.views.query(f.ctx, {
      entityDefinitionId: 'companies',
      filter: {
        path: [
          { entityDefinitionId: companies.id, attributeDefinitionId: listEntries },
          { entityDefinitionId: p.list.id, attributeDefinitionId: p.stage.id },
        ],
        mode: 'must',
        constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: p.won }],
      },
    });
    expect(inWon.total).toBe(2);
  });
});

describe('duplicate and delete', () => {
  it('duplicates with new ids for attributes, stages and views; entries only on request', async () => {
    const f = await collabFixture();
    const p = await pipeline(f, 'Fundraising');
    await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record],
      values: {
        stage: [{ value: { pipelineStageId: p.qualified } }],
        tags: [
          {
            value: {
              selectOptionId: (
                await domain.schema.listOptions(f.ctx, {
                  entityDefinitionId: p.list.id,
                  attributeDefinitionId: p.tags.id,
                })
              )[0]?.id,
            },
          },
        ],
      },
    });
    const stagePath = [{ entityDefinitionId: p.list.id, attributeDefinitionId: p.stage.id }];
    await domain.views.create(f.ctx, {
      id: newId(),
      entityDefinitionId: p.list.id,
      type: 'kanban',
      title: 'Board',
      filter: {
        path: stagePath,
        mode: 'must-not',
        constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: p.lead }],
      },
      kanban: {
        groupBy: stagePath,
        hiddenStageIds: [p.lead],
        calculation: {
          path: [{ entityDefinitionId: p.list.id, attributeDefinitionId: p.value.id }],
          aggregation: 'sum',
        },
      },
    });
    const copy = await domain.lists.duplicate(f.ctx, { listId: p.list.id });
    expect(copy).toMatchObject({ name: 'Fundraising (2)', entryCount: 0, parentEntityDefinitionIds: [f.companies] });
    expect(copy.id).not.toBe(p.list.id);
    const attrs = await domain.schema.listAttributes(f.ctx, { entityDefinitionId: copy.id });
    const stage = attrs.find((a) => a.apiSlug === 'stage');
    expect(stage?.id).toBeDefined();
    expect(stage?.id).not.toBe(p.stage.id);
    const stages = await domain.schema.listStages(f.ctx, {
      entityDefinitionId: copy.id,
      attributeDefinitionId: 'stage',
    });
    expect(stages.map((s) => s.title)).toEqual(['Lead', 'Qualified', 'Won']);
    expect(stages.map((s) => s.id)).not.toContain(p.lead);
    expect(stages[2]).toMatchObject({ celebrationEnabled: true, targetTimeInStatus: 'P0Y0M7DT0H0M0S' });
    const views = await domain.views.list(f.ctx, { entityDefinitionId: copy.id });
    expect(views.map((v) => v.title)).toEqual(['All entries table', 'Board']);
    const board = views[1];
    const newStagePath = [{ entityDefinitionId: copy.id, attributeDefinitionId: stage?.id }];
    expect(board?.kanban).toMatchObject({ groupBy: newStagePath, hiddenStageIds: [stages[0]?.id] });
    expect(JSON.stringify(board?.filter)).toContain(stages[0]?.id as string);
    expect(JSON.stringify(board)).not.toContain(p.stage.id);

    const withEntries = await domain.lists.duplicate(f.ctx, { listId: p.list.id, name: 'Copy', includeEntries: true });
    expect(withEntries.entryCount).toBe(1);
    const q = await domain.views.query(f.ctx, { entityDefinitionId: withEntries.id });
    const [entry] =
      (await domain.entries.add(f.ctx, { listId: withEntries.id, parentRecords: [f.record], onDuplicate: 'cancel' }))
        .duplicates[0]?.entries ?? [];
    expect(entry?.id).toBe(q.ids[0]);
    const copiedStage = (await domain.schema.getAttribute(f.ctx, withEntries.id, 'stage')).id;
    const qualified = (
      await domain.schema.listStages(f.ctx, { entityDefinitionId: withEntries.id, attributeDefinitionId: 'stage' })
    )[1];
    expect(entry?.values[copiedStage]?.[0]?.value).toEqual({ pipelineStageId: qualified?.id });
  });

  it('deletes a list: entries archived, gone from the sidebar, slug free, 404 afterwards', async () => {
    const f = await collabFixture();
    const p = await pipeline(f, 'Temp');
    await domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [f.record] });
    await domain.lists.delete(f.ctx, { listId: p.list.id });
    expect((await domain.lists.list(f.ctx)).map((l) => l.id)).not.toContain(p.list.id);
    await expectCode(domain.lists.get(f.ctx, { listId: p.list.id }), 'NOT_FOUND');
    await expectCode(domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [f.record] }), 'NOT_FOUND');
    expect((await domain.entries.forRecord(f.ctx, { recordRef: f.record })).memberships).toEqual([]);
    const again = await domain.lists.create(f.ctx, { name: 'Temp', parentEntityDefinitionIds: ['companies'] });
    expect(again.list.apiSlug).toBe('temp');
    await expectCode(
      domain.records.get(f.ctx, { entityDefinitionId: p.list.id, entityInstanceId: newId() }),
      'FORBIDDEN',
    );
  });
});

describe('access levels', () => {
  it('enforces Full access / Read and write / Read only / No access on lists and entries', async () => {
    const f = await collabFixture();
    const p = await pipeline(f, 'Secret');
    const [entry] = (await domain.entries.add(f.ctx, { listId: p.list.id, parentRecords: [f.record] })).entries;
    const bob = await addMember(f, 'Bob');
    const entryRef = { entityDefinitionId: p.list.id, entityInstanceId: entry?.id as string };
    const putStage = (ctx: typeof bob.ctx) =>
      domain.values.put(ctx, {
        ...entryRef,
        attributeDefinitionId: p.stage.id,
        attributeValueId: newId(),
        value: { pipelineStageId: p.qualified },
      });

    // Read and write (workspace default): edit values and add entries, but no list settings.
    expect((await domain.lists.get(bob.ctx, { listId: p.list.id })).myAccess).toBe('read-write');
    await putStage(bob.ctx);
    await expectCode(domain.lists.update(bob.ctx, { listId: p.list.id, name: 'Mine' }), 'FORBIDDEN');
    await expectCode(
      domain.lists.setAccess(bob.ctx, { listId: p.list.id, workspaceAccess: 'full-access' }),
      'FORBIDDEN',
    );
    await expectCode(domain.lists.delete(bob.ctx, { listId: p.list.id }), 'FORBIDDEN');

    // Read only: reads work, writes do not.
    await domain.lists.setAccess(f.ctx, { listId: p.list.id, workspaceAccess: 'read-only' });
    expect((await domain.lists.get(bob.ctx, { listId: p.list.id })).myAccess).toBe('read-only');
    expect((await domain.views.query(bob.ctx, { entityDefinitionId: p.list.id })).total).toBe(1);
    await expectCode(putStage(bob.ctx), 'FORBIDDEN');
    await expectCode(
      domain.entries.add(bob.ctx, { listId: p.list.id, parentRecords: [f.record], onDuplicate: 'keep' }),
      'FORBIDDEN',
    );
    await expectCode(
      domain.entries.remove(bob.ctx, { listId: p.list.id, entryIds: [entry?.id as string] }),
      'FORBIDDEN',
    );

    // No access: hidden from the sidebar and record page, every read refused.
    await domain.lists.setAccess(f.ctx, { listId: p.list.id, workspaceAccess: 'no-access' });
    expect((await domain.lists.list(bob.ctx)).map((l) => l.id)).not.toContain(p.list.id);
    await expectCode(domain.lists.get(bob.ctx, { listId: p.list.id }), 'FORBIDDEN');
    await expectCode(domain.views.query(bob.ctx, { entityDefinitionId: p.list.id }), 'FORBIDDEN');
    await expectCode(domain.records.get(bob.ctx, entryRef), 'FORBIDDEN');
    expect((await domain.entries.forRecord(bob.ctx, { recordRef: f.record })).memberships).toEqual([]);
    expect((await domain.entries.forRecord(f.ctx, { recordRef: f.record })).memberships).toHaveLength(1);
    const { policies } = await domain.policies.resolve(bob.ctx, { entityDefinitionIds: [p.list.id] });
    expect(policies[p.list.id]).toMatchObject({ state: 'complete', value: { read_entity_instance: false } });

    // A member override is more permissive than the workspace level; removing it falls back.
    await domain.lists.setAccess(f.ctx, {
      listId: p.list.id,
      memberAccess: [{ memberId: bob.memberId, scope: 'read-write' }],
    });
    expect((await domain.lists.list(bob.ctx)).map((l) => l.id)).toContain(p.list.id);
    await putStage(bob.ctx);
    const list = await domain.lists.setAccess(f.ctx, {
      listId: p.list.id,
      memberAccess: [{ memberId: bob.memberId, scope: null }],
    });
    expect(list.memberAccess).toEqual([{ memberId: f.memberId, scope: 'full-access' }]);
    await expectCode(domain.lists.get(bob.ctx, { listId: p.list.id }), 'FORBIDDEN');

    // Admins are not exempt from list access but can always grant themselves access; `all` is admin-only.
    await domain.lists.setAccess(f.ctx, {
      listId: p.list.id,
      memberAccess: [{ memberId: f.memberId, scope: 'no-access' }],
    });
    await expectCode(domain.views.query(f.ctx, { entityDefinitionId: p.list.id }), 'FORBIDDEN');
    expect((await domain.lists.get(f.ctx, { listId: p.list.id })).myAccess).toBe('no-access');
    expect((await domain.lists.list(f.ctx, { scope: 'all' })).map((l) => l.id)).toContain(p.list.id);
    await expectCode(domain.lists.list(bob.ctx, { scope: 'all' }), 'FORBIDDEN');
    await domain.lists.setAccess(f.ctx, {
      listId: p.list.id,
      memberAccess: [{ memberId: f.memberId, scope: 'full-access' }],
    });
    expect((await domain.views.query(f.ctx, { entityDefinitionId: p.list.id })).total).toBe(1);
  });
});

describe('list comments', () => {
  it('lists threads on the entries of a view snapshot (list Comments panel)', async () => {
    const f = await collabFixture();
    const p = await pipeline(f, 'Commented');
    const other = await createRecord(f, 'companies', { name: [{ value: 'Globex' }] });
    const { entries } = await domain.entries.add(f.ctx, {
      listId: p.list.id,
      parentRecords: [f.record, companyRef(f, other)],
      values: { stage: [{ value: { pipelineStageId: p.lead } }] },
    });
    const [e1, e2] = entries.map((e) => e.id) as [string, string];
    await domain.records.update(f.ctx, {
      entityDefinitionId: p.list.id,
      entityInstanceId: e2,
      values: { stage: [{ value: { pipelineStageId: p.won } }] },
    });
    const body = (text: string) => ({ text, mentions: [], styles: [] });
    for (const entry of [e1, e2]) {
      await domain.comments.create(f.ctx, {
        id: newId(),
        target: { kind: 'list-entry', entityDefinitionId: p.list.id, entityInstanceId: entry },
        content: body(`on ${entry}`),
      });
    }
    const all = await domain.comments.listThreads(f.ctx, { entityDefinitionId: p.list.id });
    expect(all.total).toBe(2);
    const leads = await domain.views.query(f.ctx, {
      entityDefinitionId: p.list.id,
      filter: {
        path: [{ entityDefinitionId: p.list.id, attributeDefinitionId: p.stage.id }],
        mode: 'must',
        constraints: [{ field: 'pipeline_stage_id', operator: 'eq', value: p.lead }],
      },
    });
    const scoped = await domain.comments.listThreads(f.ctx, {
      entityDefinitionId: p.list.id,
      snapshotId: leads.snapshotId,
    });
    expect(scoped.threads.map((t) => t.root.target.entityInstanceId)).toEqual([e1]);
    await expectCode(
      domain.comments.listThreads(f.ctx, { entityDefinitionId: 'companies', snapshotId: leads.snapshotId }),
      'SNAPSHOT_NOT_FOUND',
    );
  });
});
