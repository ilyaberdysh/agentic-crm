// Favorites and folders (BACKLOG 3.17; B sidebar §6, D §3.10b).
import { rankBetween } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { addMember, changeRows, collabFixture, lastChangeId } from './collab-fixtures.ts';
import { domain, expectCode, newId } from './support/harness.ts';

describe('favorites', () => {
  it('stars records, views, notes and templates with sidebar labels; personal to the member', async () => {
    const f = await collabFixture();
    const grace = await addMember(f);
    const view = (await domain.views.list(f.ctx, { entityDefinitionId: 'companies' }))[0];
    const note = await domain.notes.create(f.ctx, { id: newId(), title: 'Recap', parentRecords: [f.record] });
    const template = await domain.noteTemplates.create(f.ctx, { id: newId(), title: 'Tpl' });
    const before = await lastChangeId(f.workspaceId);
    await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: f.company,
    });
    await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'entity-view', targetId: view?.id as string });
    await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'note', targetId: note.id });
    await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'note-template', targetId: template.id });
    const { favorites } = await domain.favorites.list(f.ctx);
    // Newest on top.
    expect(favorites.map((x) => [x.favoriteType, x.target])).toEqual([
      ['note-template', { state: 'ok', label: 'Tpl', secondaryLabel: null }],
      ['note', { state: 'ok', label: 'Recap', secondaryLabel: 'Acme' }],
      ['entity-view', { state: 'ok', label: view?.title, secondaryLabel: 'Companies' }],
      ['record', { state: 'ok', label: 'Acme', secondaryLabel: 'Company' }],
    ]);
    expect((await domain.favorites.list(grace.ctx)).favorites).toHaveLength(0);
    const rows = await changeRows(f.workspaceId, before);
    expect(
      rows
        .filter((r) => r.resource === 'favorite-list')
        .every((r) => (r.audience as { userIds: string[] }).userIds.length === 1),
    ).toBe(true);
  });

  it('is idempotent per id and per target; removes by id or by target', async () => {
    const f = await collabFixture();
    const id = newId();
    const a = await domain.favorites.put(f.ctx, {
      id,
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: f.company,
    });
    expect(
      (
        await domain.favorites.put(f.ctx, {
          id,
          favoriteType: 'record',
          entityDefinitionId: 'companies',
          targetId: f.company,
        })
      ).id,
    ).toBe(id);
    expect(
      (
        await domain.favorites.put(f.ctx, {
          id: newId(),
          favoriteType: 'record',
          entityDefinitionId: 'companies',
          targetId: f.company,
        })
      ).id,
    ).toBe(a.id);
    await expectCode(
      domain.favorites.put(f.ctx, { id, favoriteType: 'record', entityDefinitionId: 'people', targetId: f.person }),
      'ID_CONFLICT',
      409,
    );
    expect(await domain.favorites.removeByTarget(f.ctx, { favoriteType: 'record', targetId: f.company })).toEqual({
      removedIds: [id],
    });
    await domain.favorites.delete(f.ctx, id);
    await expectCode(
      domain.favorites.put(f.ctx, {
        id: newId(),
        favoriteType: 'record',
        entityDefinitionId: 'companies',
        targetId: newId(),
      }),
      'NOT_FOUND',
    );
  });

  it('folders: create on top, move favorites in and out by rank, rename, delete with contents', async () => {
    const f = await collabFixture();
    const fav1 = await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: f.company,
    });
    const fav2 = await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'people',
      targetId: f.person,
    });
    const dir = await domain.favorites.putDirectory(f.ctx, { id: newId(), title: 'Clients' });
    const top = await domain.favorites.list(f.ctx);
    expect(dir.sortOrder < (top.favorites[0]?.sortOrder as string)).toBe(true);
    const moved = await domain.favorites.move(f.ctx, { favoriteId: fav1.id, directoryId: dir.id, sortOrder: 'i' });
    expect(moved.directoryId).toBe(dir.id);
    // Put fav2 before fav1 inside the folder.
    await domain.favorites.move(f.ctx, { favoriteId: fav2.id, directoryId: dir.id, sortOrder: rankBetween(null, 'i') });
    const inside = (await domain.favorites.list(f.ctx)).favorites
      .filter((x) => x.directoryId === dir.id)
      .map((x) => x.id);
    expect(inside).toEqual([fav2.id, fav1.id]);
    expect((await domain.favorites.updateDirectory(f.ctx, { directoryId: dir.id, title: 'Key clients' })).title).toBe(
      'Key clients',
    );
    await expectCode(
      domain.favorites.move(f.ctx, { favoriteId: fav1.id, directoryId: newId(), sortOrder: 'i' }),
      'NOT_FOUND',
    );
    const deleted = await domain.favorites.deleteDirectory(f.ctx, dir.id);
    expect(deleted.deletedFavoriteIds.sort()).toEqual([fav1.id, fav2.id].sort());
    expect(await domain.favorites.list(f.ctx)).toEqual({ directories: [], favorites: [] });
  });

  it('shows deleted targets as missing until cleaned up; record deletes remove record favorites', async () => {
    const f = await collabFixture();
    await domain.favorites.put(f.ctx, {
      id: newId(),
      favoriteType: 'record',
      entityDefinitionId: 'companies',
      targetId: f.company,
    });
    const fav = await domain.favorites.put(f.ctx, { id: newId(), favoriteType: 'workflow', targetId: newId() });
    expect(fav.target.state).toBe('unknown');
    await domain.records.delete(f.ctx, f.record);
    const { favorites } = await domain.favorites.list(f.ctx);
    expect(favorites.map((x) => x.favoriteType)).toEqual(['workflow']);
  });
});
