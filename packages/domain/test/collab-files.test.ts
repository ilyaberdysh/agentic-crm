// Record files (BACKLOG 3.06; D §3.9, §4.4; contract E5) against SeaweedFS (config.s3).
import { describe, expect, it } from 'vitest';
import { collabFixture } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

async function upload(
  f: Awaited<ReturnType<typeof collabFixture>>,
  name: string,
  bytes: string,
  parentFolderId: string | null = null,
) {
  const body = new TextEncoder().encode(bytes);
  const { session, upload } = await domain.files.createUploadSession(f.ctx, {
    id: newId(),
    ...f.record,
    parentFolderId,
    filename: name,
    contentType: 'text/plain',
    contentSize: body.byteLength,
  });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body });
  expect(put.ok, await put.text()).toBe(true);
  return domain.files.complete(f.ctx, { sessionId: session.id });
}

describe('files', () => {
  it('uploads in three steps and downloads through a short-lived signed URL', async () => {
    const f = await collabFixture();
    const { session, entry } = await upload(f, 'notes.txt', 'hello files');
    expect(session).toMatchObject({ state: 'accepted', fileEntryId: entry.id });
    expect(entry).toMatchObject({
      entryType: 'file',
      name: 'notes.txt',
      contentType: 'text/plain',
      contentSize: 11,
      parentFolderId: null,
      rootEntryId: entry.id,
      storageProvider: 'attio',
      hasChildren: null,
      createdBy: { type: 'workspace-member', id: f.memberId },
    });
    expect((await domain.files.list(f.ctx, f.record)).entries.map((e) => e.id)).toEqual([entry.id]);
    const { url, expiresAt } = await domain.files.downloadUrl(f.ctx, { entryId: entry.id });
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
    const res = await fetch(url);
    expect(await res.text()).toBe('hello files');
    // complete() is idempotent.
    expect((await domain.files.complete(f.ctx, { sessionId: session.id })).entry.id).toBe(entry.id);
  });

  it('refuses to accept a session before the bytes arrive or with another size', async () => {
    const f = await collabFixture();
    const { session, upload: target } = await domain.files.createUploadSession(f.ctx, {
      id: newId(),
      ...f.record,
      filename: 'a.bin',
      contentType: 'application/octet-stream',
      contentSize: 4,
    });
    await expectCode(domain.files.complete(f.ctx, { sessionId: session.id }), 'UPLOAD_INCOMPLETE', 400);
    await fetch(target.url, { method: 'PUT', headers: target.headers, body: new Uint8Array([1, 2]) });
    await expectCode(domain.files.complete(f.ctx, { sessionId: session.id }), 'UPLOAD_INCOMPLETE', 400);
    const replay = await domain.files.createUploadSession(f.ctx, {
      id: session.id,
      ...f.record,
      filename: 'a.bin',
      contentType: 'application/octet-stream',
      contentSize: 4,
    });
    expect(replay.session.id).toBe(session.id);
    await expectCode(domain.files.complete(f.ctx, { sessionId: newId() }), 'NOT_FOUND', 404);
  });

  it('folders: create, upload into, list (flat and recursive), rename, unique names, delete with contents', async () => {
    const f = await collabFixture();
    const folder = await domain.files.createFolder(f.ctx, { id: newId(), ...f.record, name: 'Contracts' });
    expect(folder).toMatchObject({ entryType: 'folder', hasChildren: false, rootEntryId: folder.id });
    const sub = await domain.files.createFolder(f.ctx, {
      id: newId(),
      ...f.record,
      parentFolderId: folder.id,
      name: '2026',
    });
    expect(sub.rootEntryId).toBe(folder.id);
    const { entry } = await upload(f, 'msa.txt', 'msa', sub.id);
    expect(entry).toMatchObject({ parentFolderId: sub.id, rootEntryId: folder.id });
    await upload(f, 'b.txt', 'b');
    const root = await domain.files.list(f.ctx, f.record);
    expect(root.entries.map((e) => [e.name, e.hasChildren])).toEqual([
      ['Contracts', true],
      ['b.txt', null],
    ]);
    const all = await domain.files.list(f.ctx, { ...f.record, parentFolderId: folder.id, recursive: true });
    expect(all.entries.map((e) => e.name).sort()).toEqual(['2026', 'msa.txt']);
    await expectCode(
      domain.files.createFolder(f.ctx, { id: newId(), ...f.record, name: 'contracts' }),
      'NAME_IN_USE',
      409,
    );
    await expectCode(
      domain.files.createUploadSession(f.ctx, { id: newId(), ...f.record, filename: 'B.TXT', contentSize: 1 }),
      'NAME_IN_USE',
    );
    expect((await domain.files.rename(f.ctx, { entryId: entry.id, name: 'MSA final.txt' })).name).toBe('MSA final.txt');
    const deleted = await domain.files.delete(f.ctx, folder.id);
    expect(deleted.deletedIds.sort()).toEqual([folder.id, sub.id, entry.id].sort());
    expect((await domain.files.list(f.ctx, f.record)).entries.map((e) => e.name)).toEqual(['b.txt']);
    await expectCode(domain.files.get(f.ctx, entry.id), 'NOT_FOUND', 404);
    await expectCode(domain.files.downloadUrl(f.ctx, { entryId: folder.id }), 'NOT_FOUND');
  });

  it('validates the record and the folder', async () => {
    const f = await collabFixture();
    await expectCode(
      domain.files.createFolder(f.ctx, {
        id: newId(),
        entityDefinitionId: 'companies',
        entityInstanceId: newId(),
        name: 'x',
      }),
      'NOT_FOUND',
    );
    const otherFolder = await domain.files.createFolder(f.ctx, {
      id: newId(),
      entityDefinitionId: 'people',
      entityInstanceId: f.person,
      name: 'Elsewhere',
    });
    await expectCode(
      domain.files.createFolder(f.ctx, { id: newId(), ...f.record, parentFolderId: otherFolder.id, name: 'x' }),
      'NOT_FOUND',
    );
  });

  it('uploads directly (public API path) and files of deleted records disappear', async () => {
    const f = await collabFixture();
    const entry = await domain.files.upload(f.ctx, {
      record: f.record,
      parentFolderId: null,
      name: 'direct.txt',
      contentType: 'text/plain',
      body: new TextEncoder().encode('direct'),
    });
    expect(entry).toMatchObject({ name: 'direct.txt', contentSize: 6 });
    const res = await fetch((await domain.files.downloadUrl(f.ctx, { entryId: entry.id })).url);
    expect(await res.text()).toBe('direct');
    await domain.records.delete(f.ctx, f.record);
    await expectCode(domain.files.get(f.ctx, entry.id), 'NOT_FOUND');
    await domain.records.restore(f.ctx, f.record);
    expect((await domain.files.get(f.ctx, entry.id)).id).toBe(entry.id);
  });
});
