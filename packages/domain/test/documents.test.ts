// Documents store (migration 0400, domain documents module): idempotent create from blocks/markdown, projections
// written with the Yjs state, merge-on-store, server-side content replacement, note bodies from markdown with a
// real Yjs state, access through the owning note / template, change_log rows.
import { flagsForScope } from '@agentic-crm/contracts';
import { blocksToState, stateToBlocks, textBlock, yDocFromState } from '@agentic-crm/editor/model';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDomain, DOCUMENT_STATE_CHANNEL, memberContext, type PolicyResolver } from '../src/index.ts';
import { databaseUrl } from './support/env.ts';
import { createUser, createWorkspace, database, domain, expectCode, newId } from './support/harness.ts';

async function documentChanges(workspaceId: string, documentId: string) {
  return database.kysely
    .selectFrom('change_log')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .where('resource', '=', 'document')
    .where('resource_id', '=', documentId)
    .orderBy('id')
    .execute();
}

async function companyRef(ctx: Parameters<typeof domain.schema.getObject>[0]) {
  const companies = await domain.schema.getObject(ctx, 'companies');
  const entityInstanceId = newId();
  await domain.records.create(ctx, {
    entityDefinitionId: companies.id,
    entityInstanceId,
    values: { name: [{ value: 'Cedar Health' }] },
  });
  return { entityDefinitionId: companies.id, entityInstanceId };
}

async function addMember(workspaceId: string, memberId: string, firstName: string) {
  const user = await createUser(firstName, 'Member');
  await database.kysely
    .insertInto('workspace_members')
    .values({
      id: memberId,
      workspace_id: workspaceId,
      user_id: user.userId,
      access_level: 'member',
      email_address: user.emailAddress,
      first_name: firstName,
      last_name: 'Member',
    })
    .execute();
}

describe('documents', () => {
  it('creates a standalone document from markdown with its projections, idempotently', async () => {
    const ws = await createWorkspace();
    const id = newId();
    const markdown = '# Agenda\n- Introductions\n  - Current **tooling**\n1. Owner';
    const created = await domain.documents.create(ws.ctx, { id, docType: 'note-template', content: { markdown } });
    expect(created).toMatchObject({ id, workspaceId: ws.workspaceId, docType: 'note-template', parentId: null });
    expect(created).toMatchObject({ version: 1, markdown });
    expect(created.blocks.map((b) => [b.type, b.indent, b.text])).toEqual([
      ['h1', 0, 'Agenda'],
      ['ul', 0, 'Introductions'],
      ['ul', 1, 'Current tooling'],
      ['ol', 0, 'Owner'],
    ]);
    expect(created.plaintext).toBe('Agenda\nIntroductions\nCurrent tooling\nOwner');
    // The Yjs state holds the same content.
    const stored = await domain.documents.loadState(ws.ctx, id);
    expect(stateToBlocks(stored?.state)).toEqual(created.blocks);
    // Same id + same type and owner → same document; a different type → 409.
    expect((await domain.documents.create(ws.ctx, { id, docType: 'note-template' })).version).toBe(1);
    await expectCode(domain.documents.create(ws.ctx, { id, docType: 'note' }), 'ID_CONFLICT', 409);
    const changes = await documentChanges(ws.workspaceId, id);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.scope).toMatchObject({ docType: 'note-template', parentId: null, version: 1 });
  });

  it('merges stored state instead of overwriting, and bumps the version only when projections change', async () => {
    const ws = await createWorkspace();
    const id = newId();
    await domain.documents.create(ws.ctx, { id, docType: 'note' });
    // Two editors start from the same (empty) state and diverge.
    const a = new Y.Doc();
    const b = new Y.Doc();
    Y.applyUpdate(a, blocksToState([textBlock('unstyled', 'from A')]));
    Y.applyUpdate(b, blocksToState([textBlock('h1', 'from B')]));
    const first = await domain.documents.storeState(ws.ctx, { id, state: Y.encodeStateAsUpdate(a) });
    expect(first).toMatchObject({ written: true, projectionChanged: true, version: 2 });
    const second = await domain.documents.storeState(ws.ctx, { id, state: Y.encodeStateAsUpdate(b) });
    expect(second).toMatchObject({ written: true, projectionChanged: true, version: 3 });
    // Both edits survive; the returned state carries A's edit back to B.
    const view = await domain.documents.get(ws.ctx, id);
    expect(view.blocks.map((x) => x.text).sort()).toEqual(['from A', 'from B']);
    Y.applyUpdate(b, second.state);
    expect(stateToBlocks(Y.encodeStateAsUpdate(b))).toEqual(view.blocks);
    // Storing what is already there writes nothing.
    const noop = await domain.documents.storeState(ws.ctx, { id, state: second.state });
    expect(noop).toMatchObject({ written: false, projectionChanged: false, version: 3 });
    expect(await documentChanges(ws.workspaceId, id)).toHaveLength(3);
  });

  it('replaces content as a diff, notifies the collab channel and keeps concurrent edits', async () => {
    const ws = await createWorkspace();
    const id = newId();
    await domain.documents.create(ws.ctx, {
      id,
      docType: 'note',
      content: { blocks: [textBlock('unstyled', 'one'), textBlock('unstyled', 'two')] },
    });
    // An editor holding the document appends a block that is not stored yet.
    const editor = yDocFromState((await domain.documents.loadState(ws.ctx, id))?.state);
    const listener = new pg.Client({ connectionString: databaseUrl() });
    await listener.connect();
    const notes: string[] = [];
    listener.on('notification', (n) => {
      if (n.channel === DOCUMENT_STATE_CHANNEL && n.payload) notes.push(n.payload);
    });
    await listener.query(`LISTEN ${DOCUMENT_STATE_CHANNEL}`);
    try {
      const replaced = await domain.documents.replaceContent(ws.ctx, { id, content: { markdown: '# Replaced\ntwo' } });
      expect(replaced.markdown).toBe('# Replaced\ntwo');
      await new Promise((r) => setTimeout(r, 100));
      expect(notes.map((n) => JSON.parse(n))).toEqual([{ id, op: 'update' }]);
      // The editor's concurrent change merges with the replacement.
      const body = editor.getXmlFragment('default');
      editor.transact(() => {
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('three')]);
        body.insert(body.length, [p]);
      });
      const result = await domain.documents.storeState(ws.ctx, { id, state: Y.encodeStateAsUpdate(editor) });
      expect(stateToBlocks(result.state).map((b) => [b.type, b.text])).toEqual([
        ['h1', 'Replaced'],
        ['unstyled', 'two'],
        ['unstyled', 'three'],
      ]);
    } finally {
      await listener.end();
    }
  });

  it('writes note bodies from markdown with a real Yjs state; legacy rows without one still load', async () => {
    const ws = await createWorkspace();
    const record = await companyRef(ws.ctx);
    const note = await domain.notes.create(
      ws.ctx,
      { id: newId(), parentRecords: [record] },
      { markdown: '# Hi\n- **one**' },
    );
    expect(note.content).toMatchObject({ markdown: '# Hi\n- **one**', plaintext: 'Hi\none' });
    const loaded = await domain.documents.loadState(ws.ctx, note.documentId);
    expect(stateToBlocks(loaded?.state).map((b) => [b.type, b.text])).toEqual([
      ['h1', 'Hi'],
      ['ul', 'one'],
    ]);
    // A row written by an older path (markdown only, no state, no blocks) is rebuilt from its markdown.
    await database.kysely
      .updateTable('documents')
      .set({ yjs_state: null, blocks: null, markdown: '## Legacy\n1. step' })
      .where('id', '=', note.documentId)
      .execute();
    const legacy = await domain.documents.loadState(ws.ctx, note.documentId);
    expect(stateToBlocks(legacy?.state).map((b) => [b.type, b.text])).toEqual([
      ['h2', 'Legacy'],
      ['ol', 'step'],
    ]);
  });

  it('resolves access through the owning note: editors, readers, no access, other workspaces', async () => {
    const ws = await createWorkspace();
    const record = await companyRef(ws.ctx);
    const note = await domain.notes.create(ws.ctx, { id: newId(), parentRecords: [record] });
    expect(await domain.documents.resolveAccess(ws.ctx, note.documentId)).toBe('edit');
    expect(await domain.documents.owner(ws.ctx, note.documentId)).toEqual({ kind: 'note', id: note.id });

    // A read-only member (custom resolver) can read but not edit; a no-access member sees nothing.
    const reader = newId();
    const blocked = newId();
    const resolver: PolicyResolver = {
      async resolve(_tx, subject, defs) {
        const scope =
          subject.memberId === reader ? 'read-only' : subject.memberId === blocked ? 'no-access' : 'full-access';
        return new Map(defs.map((d) => [d.id, flagsForScope(scope)]));
      },
    };
    const restricted = createDomain({ database, policyResolver: resolver });
    await addMember(ws.workspaceId, reader, 'Reader');
    await addMember(ws.workspaceId, blocked, 'Blocked');
    const asReader = memberContext(ws.workspaceId, reader);
    expect(await restricted.documents.resolveAccess(asReader, note.documentId)).toBe('read');
    expect(await restricted.documents.resolveAccess(memberContext(ws.workspaceId, blocked), note.documentId)).toBe(
      'none',
    );
    await expectCode(
      restricted.documents.replaceContent(asReader, { id: note.documentId, content: { markdown: 'x' } }),
      'FORBIDDEN',
      403,
    );
    // A deleted note takes its body with it.
    await domain.notes.delete(ws.ctx, note.id);
    expect(await domain.documents.resolveAccess(ws.ctx, note.documentId)).toBe('none');
    // Another workspace never sees a document (RLS + workspace scoping).
    const id = newId();
    await domain.documents.create(ws.ctx, { id, docType: 'note-template' });
    const other = await createWorkspace();
    await expectCode(domain.documents.get(other.ctx, id), 'NOT_FOUND', 404);
    expect(await domain.documents.resolveAccess(other.ctx, id)).toBe('none');
    expect(await domain.documents.locate(id)).toMatchObject({ workspaceId: ws.workspaceId, deleted: false });
  });

  it('soft-deletes: the document disappears and the collab channel is told', async () => {
    const ws = await createWorkspace();
    const id = newId();
    await domain.documents.create(ws.ctx, { id, docType: 'note' });
    await domain.documents.delete(ws.ctx, id);
    await expectCode(domain.documents.get(ws.ctx, id), 'NOT_FOUND', 404);
    expect(await domain.documents.loadState(ws.ctx, id)).toBeNull();
    expect(await domain.documents.locate(id)).toMatchObject({ deleted: true });
    const changes = await documentChanges(ws.workspaceId, id);
    expect(changes.at(-1)?.scope).toMatchObject({ deleted: true });
  });
});
