// Merge / delete polish (BACKLOG 3.07, 3.08, 3.11; D §2.6, §3.10, §3.10a; decision X-22).
import { describe, expect, it } from 'vitest';
import { collabFixture, createList, createRecord } from './collab-fixtures.ts';
import { domain, newId } from './support/harness.ts';

describe('record merge and delete', () => {
  it('carries notes, tasks, comments, files, list entries and favorites over to the merged record', async () => {
    const f = await collabFixture();
    const dup = await createRecord(f, 'companies', { name: [{ value: 'Acme Inc' }] });
    const dupRef = { entityDefinitionId: f.companies, entityInstanceId: dup };
    const shared = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [f.record, dupRef] });
    const noteOnDup = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [dupRef] });
    const task = await domain.tasks.create(f.ctx, {
      id: newId(),
      content: { text: 't', mentions: [] },
      linkedRecords: [dupRef, f.record],
    });
    const comment = await domain.comments.create(f.ctx, {
      id: newId(),
      target: { kind: 'record', ...dupRef },
      content: { text: 'c', mentions: [], styles: [] },
    });
    const upload = async (ref: typeof f.record, name: string) =>
      domain.files.upload(f.ctx, {
        record: ref,
        parentFolderId: null,
        name,
        contentType: 'text/plain',
        body: new TextEncoder().encode(name),
      });
    await upload(f.record, 'deck.pdf');
    await upload(dupRef, 'deck.pdf');
    await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: f.company,
    });
    await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: dup,
    });
    const list = await createList(f, f.companies);
    await list.addEntry(dup);

    // dup is the target (priority) record.
    const merged = await domain.records.merge(f.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: f.company,
      targetEntityInstanceId: dup,
    });
    const mergedRef = { entityDefinitionId: f.companies, entityInstanceId: merged.record.entityInstanceId };

    expect((await domain.notes.get(f.ctx, shared.id)).parentRecords).toEqual([mergedRef]);
    expect((await domain.notes.list(f.ctx, { record: mergedRef })).notes.map((n) => n.id).sort()).toEqual(
      [shared.id, noteOnDup.id].sort(),
    );
    expect((await domain.tasks.get(f.ctx, task.id)).linkedRecords).toEqual([mergedRef]);
    expect((await domain.comments.locate(f.ctx, comment.id)).target).toEqual({ kind: 'record', ...mergedRef });
    const files = (await domain.files.list(f.ctx, mergedRef)).entries.map((e) => e.name).sort();
    expect(files).toEqual(['deck (2).pdf', 'deck.pdf']);
    const favorites = (await domain.favorites.list(f.ctx)).favorites;
    expect(favorites.map((x) => x.targetId)).toEqual([mergedRef.entityInstanceId]);
    const { counts } = await domain.recordPage.relatedCounts(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceIds: [mergedRef.entityInstanceId],
    });
    expect(counts[mergedRef.entityInstanceId]).toEqual({
      lists: 1,
      notes: 2,
      tasks: 1,
      openTasks: 1,
      comments: 1,
      files: 2,
    });
  });

  it('reports record states: live, merged (following the chain), deleted, not found (D §2.6)', async () => {
    const f = await collabFixture();
    const b = await createRecord(f, 'companies', { name: [{ value: 'B' }] });
    const c = await createRecord(f, 'companies', { name: [{ value: 'C' }] });
    const ab = await domain.records.merge(f.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: f.company,
      targetEntityInstanceId: b,
    });
    const abc = await domain.records.merge(f.ctx, {
      entityDefinitionId: 'companies',
      baseEntityInstanceId: ab.record.entityInstanceId,
      targetEntityInstanceId: c,
    });
    const state = (id: string, object = 'companies') =>
      domain.recordPage.state(f.ctx, { entityDefinitionId: object, entityInstanceId: id });
    expect(await state(abc.record.entityInstanceId)).toMatchObject({ state: 'live', mergedInto: null });
    expect(await state(f.company)).toMatchObject({
      state: 'merged',
      mergedInto: { entityDefinitionId: f.companies, entityInstanceId: abc.record.entityInstanceId },
    });
    await domain.records.delete(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: abc.record.entityInstanceId,
    });
    expect(await state(abc.record.entityInstanceId)).toMatchObject({ state: 'deleted', deletedAt: expect.any(String) });
    expect(await state(f.company)).toMatchObject({ state: 'merged', mergedInto: null });
    expect(await state(newId())).toMatchObject({ state: 'not-found', entityDefinitionId: null });
    expect(await state(f.person)).toMatchObject({ state: 'not-found' }); // a person id under companies
  });

  it('deleting a record soft-deletes its comments and comes back whole on restore (X-22)', async () => {
    const f = await collabFixture();
    const comment = await domain.comments.create(f.ctx, {
      id: newId(),
      target: { kind: 'record', ...f.record },
      content: { text: 'c', mentions: [], styles: [] },
    });
    await domain.records.delete(f.ctx, f.record);
    await expect(domain.comments.get(f.ctx, comment.id)).rejects.toMatchObject({ statusCode: 404 });
    await domain.records.restore(f.ctx, f.record);
    expect((await domain.comments.get(f.ctx, comment.id)).id).toBe(comment.id);
  });
});
