// Notes and note templates (BACKLOG 3.12, 3.14; E README §3.1–3.2, §4.1–4.2, §5.7).
import { describe, expect, it } from 'vitest';
import {
  changeRows,
  collabFixture,
  createRecord,
  documentRow,
  lastChangeId,
  storeDocument,
} from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

describe('notes', () => {
  it('creates a note with a document, replays idempotently and reads it back', async () => {
    const f = await collabFixture();
    const id = newId();
    const before = await lastChangeId(f.workspaceId);
    const note = await domain.notes.create(f.ctx, { id, title: 'Call recap', parentRecords: [f.record] });
    expect(note).toMatchObject({
      id,
      title: 'Call recap',
      meetingId: null,
      parentRecords: [f.record],
      createdBy: { type: 'workspace-member', id: f.memberId },
      favoriteId: null,
      content: { markdown: null, plaintext: null, blocks: null },
    });
    const doc = await documentRow(note.documentId);
    expect(doc).toMatchObject({ workspace_id: f.workspaceId, doc_type: 'note', parent_ref: id });
    const replay = await domain.notes.create(f.ctx, { id, title: 'Other', parentRecords: [f.record] });
    expect(replay.title).toBe('Call recap');
    const resources = (await changeRows(f.workspaceId, before)).map((r) => r.resource);
    expect(resources).toEqual(expect.arrayContaining(['note', 'note-list', 'record-timeline']));
    expect(await domain.notes.get(f.ctx, id)).toMatchObject({ id, title: 'Call recap' });
  });

  it('accepts several parent records and lists the note on each', async () => {
    const f = await collabFixture();
    const id = newId();
    await domain.notes.create(f.ctx, {
      id,
      parentRecords: [f.record, { entityDefinitionId: 'people', entityInstanceId: f.person }],
    });
    const onCompany = await domain.notes.list(f.ctx, { record: f.record });
    const onPerson = await domain.notes.list(f.ctx, {
      record: { entityDefinitionId: f.people, entityInstanceId: f.person },
    });
    expect(onCompany.notes.map((n) => n.id)).toEqual([id]);
    expect(onPerson.notes.map((n) => n.id)).toEqual([id]);
    const updated = await domain.notes.update(f.ctx, {
      noteId: id,
      parentRecords: [{ entityDefinitionId: f.people, entityInstanceId: f.person }],
      meetingId: newId(),
    });
    expect(updated.parentRecords).toEqual([{ entityDefinitionId: f.people, entityInstanceId: f.person }]);
    expect(updated.meetingId).not.toBeNull();
    expect((await domain.notes.list(f.ctx, { record: f.record })).total).toBe(0);
  });

  it.each([
    [
      'an unknown record',
      (f: Awaited<ReturnType<typeof collabFixture>>) => ({
        entityDefinitionId: f.companies,
        entityInstanceId: newId(),
      }),
      'NOT_FOUND',
    ],
    [
      'a record of another object',
      (f: Awaited<ReturnType<typeof collabFixture>>) => ({ entityDefinitionId: f.people, entityInstanceId: f.company }),
      'NOT_FOUND',
    ],
    ['an unknown object', () => ({ entityDefinitionId: 'nope', entityInstanceId: newId() }), 'NOT_FOUND'],
    [
      'a non-record definition',
      () => ({ entityDefinitionId: 'workspace_members', entityInstanceId: newId() }),
      'VALIDATION_ERROR',
    ],
  ])('rejects %s as parent', async (_label, ref, code) => {
    const f = await collabFixture();
    await expectCode(domain.notes.create(f.ctx, { id: newId(), parentRecords: [ref(f)] }), code);
  });

  it('lists with sort, created-at range, creator filter and offset paging', async () => {
    const f = await collabFixture();
    const ids: string[] = [];
    for (const createdAt of ['2026-01-05T10:00:00Z', '2026-02-05T10:00:00Z', '2026-03-05T10:00:00Z']) {
      const id = newId();
      ids.push(id);
      await domain.notes.create(f.ctx, { id, title: createdAt, parentRecords: [f.record] }, { createdAt });
    }
    const desc = await domain.notes.list(f.ctx, { record: f.record });
    expect(desc.notes.map((n) => n.id)).toEqual([...ids].reverse());
    const asc = await domain.notes.list(f.ctx, { record: f.record, sort: 'created_at:asc', limit: 2, offset: 1 });
    expect(asc).toMatchObject({ total: 3 });
    expect(asc.notes.map((n) => n.id)).toEqual([ids[1], ids[2]]);
    const feb = await domain.notes.list(f.ctx, {
      createdFrom: '2026-02-01T00:00:00Z',
      createdTo: '2026-03-01T00:00:00Z',
    });
    expect(feb.notes.map((n) => n.id)).toEqual([ids[1]]);
    expect((await domain.notes.list(f.ctx, { createdByMemberId: newId() })).total).toBe(0);
    expect(
      (await domain.notes.list(f.ctx, { createdByMemberId: f.memberId, includeContent: false })).notes[0]?.content,
    ).toBeUndefined();
  });

  it('marks favorites and filters by them; deleting removes the note and its favorites without undo', async () => {
    const f = await collabFixture();
    const id = newId();
    await domain.notes.create(f.ctx, { id, parentRecords: [f.record] });
    const other = newId();
    await domain.notes.create(f.ctx, { id: other, parentRecords: [f.record] });
    const fav = await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'note', targetId: id });
    expect((await domain.notes.get(f.ctx, id)).favoriteId).toBe(fav.id);
    expect((await domain.notes.list(f.ctx, { favoritesOnly: true })).notes.map((n) => n.id)).toEqual([id]);
    await domain.notes.delete(f.ctx, id);
    await expectCode(domain.notes.get(f.ctx, id), 'NOT_FOUND', 404);
    await expectCode(domain.notes.delete(f.ctx, id), 'NOT_FOUND', 404);
    expect((await domain.notes.list(f.ctx, { record: f.record })).notes.map((n) => n.id)).toEqual([other]);
    expect((await domain.favorites.list(f.ctx)).favorites).toHaveLength(0);
    expect((await domain.notes.batchGet(f.ctx, { noteIds: [id, other] })).notes.map((n) => n.id)).toEqual([other]);
  });

  it('reads content projections written by the collab server; markdown writes build the Yjs state', async () => {
    const f = await collabFixture();
    const note = await domain.notes.create(
      f.ctx,
      { id: newId(), parentRecords: [f.record] },
      { markdown: '# Hi\n- **one**' },
    );
    expect(note.content).toMatchObject({ markdown: '# Hi\n- **one**', plaintext: 'Hi\none' });
    expect(note.content?.blocks).toHaveLength(2);
    await storeDocument(note.documentId, {
      markdown: '# Stored',
      blocks: [{ plaintext: 'Stored' }, { plaintext: 'Line' }],
    });
    expect((await domain.notes.get(f.ctx, note.id)).content).toMatchObject({
      markdown: '# Stored',
      plaintext: 'Stored\nLine',
    });
    await domain.notes.update(f.ctx, { noteId: note.id }, { markdown: 'Replaced' });
    const doc = await documentRow(note.documentId);
    // Markdown goes through the editor model (S3-COLLAB): projections and a Yjs state in the same transaction.
    expect(doc).toMatchObject({ markdown: 'Replaced', blocks: [{ type: 'unstyled', text: 'Replaced' }] });
    expect(doc?.yjs_state).not.toBeNull();
  });

  it('notes of deleted records disappear with them and come back on restore', async () => {
    const f = await collabFixture();
    const only = newId();
    const shared = newId();
    await domain.notes.create(f.ctx, { id: only, parentRecords: [f.record] });
    await domain.notes.create(f.ctx, {
      id: shared,
      parentRecords: [f.record, { entityDefinitionId: 'people', entityInstanceId: f.person }],
    });
    await domain.records.delete(f.ctx, f.record);
    await expectCode(domain.notes.get(f.ctx, only), 'NOT_FOUND');
    expect((await domain.notes.get(f.ctx, shared)).id).toBe(shared);
    await domain.records.restore(f.ctx, f.record);
    expect((await domain.notes.get(f.ctx, only)).id).toBe(only);
  });

  it('tells the collab server which note owns a document', async () => {
    const f = await collabFixture();
    const note = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [f.record] });
    expect(await domain.documents.owner(f.ctx, note.documentId)).toEqual({ kind: 'note', id: note.id });
    expect(await domain.documents.owner(f.ctx, newId())).toBeNull();
    await domain.notes.delete(f.ctx, note.id);
    expect(await domain.documents.owner(f.ctx, note.documentId)).toBeNull();
  });
});

describe('note templates', () => {
  it('creates, renames (header title follows), lists with search and deletes', async () => {
    const f = await collabFixture();
    const id = newId();
    const created = await domain.noteTemplates.create(f.ctx, { id, title: 'Discovery' });
    expect(created).toMatchObject({ id, title: 'Discovery', headerTitle: 'Discovery', favoriteId: null });
    expect((await documentRow(created.documentId))?.doc_type).toBe('note-template');
    const renamed = await domain.noteTemplates.update(f.ctx, { templateId: id, title: 'Discovery call' });
    expect(renamed).toMatchObject({ title: 'Discovery call', headerTitle: 'Discovery call' });
    const header = await domain.noteTemplates.update(f.ctx, { templateId: id, headerTitle: 'Call with …' });
    expect(header).toMatchObject({ title: 'Discovery call', headerTitle: 'Call with …' });
    await domain.noteTemplates.create(f.ctx, { id: newId(), title: 'Onboarding' });
    expect((await domain.noteTemplates.list(f.ctx, { search: 'disc' })).templates.map((t) => t.id)).toEqual([id]);
    await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'note-template', targetId: id });
    expect((await domain.noteTemplates.list(f.ctx, { favoritesOnly: true })).templates.map((t) => t.id)).toEqual([id]);
    await domain.noteTemplates.delete(f.ctx, id);
    await expectCode(domain.noteTemplates.get(f.ctx, id), 'NOT_FOUND');
    expect((await domain.noteTemplates.list(f.ctx, {})).templates).toHaveLength(1);
    expect((await domain.favorites.list(f.ctx)).favorites).toHaveLength(0);
  });

  it('creates a template from a note, copying the body (E README §5.7)', async () => {
    const f = await collabFixture();
    const note = await domain.notes.create(f.ctx, { id: newId(), title: 'Weekly sync', parentRecords: [f.record] });
    await storeDocument(note.documentId, { markdown: '## Agenda' });
    const template = await domain.noteTemplates.createFromNote(f.ctx, { id: newId(), noteId: note.id });
    expect(template).toMatchObject({
      title: 'Weekly sync',
      headerTitle: 'Weekly sync',
      content: { markdown: '## Agenda' },
    });
    const copy = await documentRow(template.documentId);
    expect(copy).toMatchObject({ doc_type: 'note-template', parent_ref: template.id, markdown: '## Agenda' });
    expect(copy?.yjs_state).not.toBeNull();
  });

  it('starts notes from templates and applies templates to pristine notes only', async () => {
    const f = await collabFixture();
    const template = await domain.noteTemplates.create(f.ctx, {
      id: newId(),
      title: 'T',
      headerTitle: 'From template',
    });
    await storeDocument(template.documentId, { markdown: '- point' });
    const fromTemplate = await domain.notes.create(f.ctx, {
      id: newId(),
      parentRecords: [f.record],
      templateId: template.id,
    });
    expect(fromTemplate).toMatchObject({ title: 'From template', content: { markdown: '- point' } });

    const pristine = await domain.notes.create(f.ctx, { id: newId(), title: 'x', parentRecords: [f.record] });
    const applied = await domain.notes.applyTemplate(f.ctx, { noteId: pristine.id, templateId: template.id });
    expect(applied).toMatchObject({
      bodyCopied: true,
      note: { title: 'From template', content: { markdown: '- point' } },
    });

    const edited = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [f.record] });
    await storeDocument(edited.documentId, { markdown: 'typed already' });
    const second = await domain.notes.applyTemplate(f.ctx, { noteId: edited.id, templateId: template.id });
    expect(second).toMatchObject({
      bodyCopied: false,
      note: { content: { markdown: 'typed already' } },
      template: { content: { markdown: '- point' } },
    });
    await expectCode(domain.notes.applyTemplate(f.ctx, { noteId: edited.id, templateId: newId() }), 'NOT_FOUND');
  });

  it('lets a second record keep a note after merge-free relinking via update', async () => {
    const f = await collabFixture();
    const other = await createRecord(f, 'companies', { name: [{ value: 'Beta' }] });
    const note = await domain.notes.create(f.ctx, { id: newId(), parentRecords: [f.record] });
    const updated = await domain.notes.update(f.ctx, {
      noteId: note.id,
      parentRecords: [{ entityDefinitionId: 'companies', entityInstanceId: other }, f.record],
    });
    expect(updated.parentRecords.map((p) => p.entityInstanceId)).toEqual([other, f.company]);
  });
});
