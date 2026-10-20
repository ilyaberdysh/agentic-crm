// Bulk delete over a snapshot selection (C1 README §3.5; BACKLOG §2 acceptance 5): zebra edges resolve against the
// frozen snapshot, exactly the selected rows are soft-deleted in one transaction, and the row cap is enforced.
import { zebraFromIndices } from '@agentic-crm/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorkspace, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

let ws: TestWorkspace;
let objectId: string;
const ids: string[] = [];

beforeAll(async () => {
  ws = await createWorkspace();
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: 'bulk_things',
    singularNoun: 'Bulk thing',
    pluralNoun: 'Bulk things',
  });
  objectId = object.id;
  await domain.schema.createAttribute(ws.ctx, {
    id: newId(),
    entityDefinitionId: objectId,
    title: 'Name',
    type: 'text',
  });
  for (let i = 0; i < 12; i++) {
    const id = newId();
    ids.push(id);
    await domain.records.create(ws.ctx, {
      entityDefinitionId: objectId,
      entityInstanceId: id,
      values: { name: [{ value: `Thing ${String(i).padStart(2, '0')}` }] },
    });
  }
});

describe('records.deleteSelection', () => {
  it('deletes exactly the selected snapshot rows, even after the data moved on', async () => {
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: objectId });
    expect(snap.total).toBe(12);
    // A record created after the snapshot is not part of it and must survive a "select all".
    const late = newId();
    await domain.records.create(ws.ctx, { entityDefinitionId: objectId, entityInstanceId: late, values: {} });

    const edges = zebraFromIndices([0, 1, 2, 7, 11]);
    const result = await domain.records.deleteSelection(ws.ctx, {
      entityDefinitionId: objectId,
      snapshotId: snap.snapshotId,
      zebraEdges: edges,
    });
    const expected = [0, 1, 2, 7, 11].map((i) => snap.ids[i] as string);
    expect(result.deletedIds).toEqual(expected);
    expect(result.skipped).toBe(0);

    const after = await domain.views.query(ws.ctx, { entityDefinitionId: objectId });
    expect(after.total).toBe(12 - 5 + 1);
    expect(after.ids).toContain(late);
    for (const id of expected) expect(after.ids).not.toContain(id);

    // Replaying the same selection is idempotent: everything is already gone.
    const again = await domain.records.deleteSelection(ws.ctx, {
      entityDefinitionId: objectId,
      snapshotId: snap.snapshotId,
      zebraEdges: edges,
    });
    expect(again.deletedIds).toEqual([]);
    expect(again.skipped).toBe(5);
  });

  it('rejects a snapshot of another object and selections above the per-call cap', async () => {
    const other = await domain.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: 'other_things',
      singularNoun: 'Other thing',
      pluralNoun: 'Other things',
    });
    const snap = await domain.views.query(ws.ctx, { entityDefinitionId: objectId });
    await expectCode(
      domain.records.deleteSelection(ws.ctx, {
        entityDefinitionId: other.id,
        snapshotId: snap.snapshotId,
        zebraEdges: [0, 1],
      }),
      'NOT_FOUND',
      404,
    );
    await expectCode(
      domain.records.deleteSelection(ws.ctx, {
        entityDefinitionId: objectId,
        snapshotId: snap.snapshotId,
        zebraEdges: [3, 1],
      }),
      'VALIDATION_ERROR',
      400,
    );
  });
});
