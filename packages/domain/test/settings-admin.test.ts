// Slice 6 administration (BACKLOG 6.01–6.03, 6.09): teams CRUD, membership and usage; members suspend / reactivate /
// remove (history kept, re-invite restores); profile; workspace general and security settings; export protection.
import { describe, expect, it } from 'vitest';
import { protectFormula } from '../src/exports/csv.ts';
import { addMember } from './collab-fixtures.ts';
import {
  createUser,
  createWorkspace,
  database,
  domain,
  expectCode,
  newId,
  type TestWorkspace,
} from './support/harness.ts';
import { dt } from './support/imports.ts';

describe('teams', () => {
  it('create, rename, add and remove members, usage, delete (admin only)', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const carol = await addMember(ws, 'Carol');
    const id = newId();
    const team = await domain.teams.create(ws.ctx, {
      id,
      name: 'Sales',
      description: 'Closers',
      icon: { id: 'rocket', color: 'blue' },
      memberIds: [bob.memberId],
    });
    expect(team).toMatchObject({ id, name: 'Sales', memberCount: 1, usageCount: 0, icon: { id: 'rocket' } });
    expect((await domain.teams.create(ws.ctx, { id, name: 'Sales' })).id).toBe(id); // idempotent replay
    await expectCode(domain.teams.create(bob.ctx, { id: newId(), name: 'Nope' }), 'FORBIDDEN', 403);
    await expect(domain.teams.create(ws.ctx, { id: newId(), name: ' ' })).rejects.toThrow(
      'Please provide a name for the team.',
    );

    await domain.teams.update(ws.ctx, { teamId: id, name: 'Revenue' });
    const added = await domain.teams.addMembers(ws.ctx, { teamId: id, memberIds: [carol.memberId, bob.memberId] });
    expect(added.members.map((m) => m.memberId).sort()).toEqual([bob.memberId, carol.memberId].sort());
    const removed = await domain.teams.removeMembers(ws.ctx, { teamId: id, memberIds: [carol.memberId] });
    expect(removed.memberCount).toBe(1);

    const { list } = await domain.lists.create(ws.ctx, { name: 'Pipeline', parentEntityDefinitionIds: ['companies'] });
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'list',
      resourceId: list.id,
      target: { type: 'team', id },
      level: 'full-access',
    });
    const detail = await domain.teams.get(bob.ctx, id);
    expect(detail.usage).toEqual([
      { type: 'list-permission', resourceId: list.id, name: 'Pipeline', level: 'full-access' },
    ]);
    expect((await domain.teams.list(bob.ctx))[0]).toMatchObject({ name: 'Revenue', memberCount: 1, usageCount: 1 });
    expect((await domain.members.get(ws.ctx, bob.memberId)).teams).toMatchObject([{ teamId: id, name: 'Revenue' }]);

    const deleted = await domain.teams.delete(ws.ctx, id);
    expect(deleted.affected).toHaveLength(1);
    expect(await domain.teams.list(ws.ctx)).toEqual([]);
    const tab = await domain.permissions.list(ws.ctx, { resourceKind: 'list', resourceId: list.id });
    expect(tab.grants.some((g) => g.target.type === 'team')).toBe(false);
    await expectCode(domain.teams.get(ws.ctx, id), 'NOT_FOUND', 404);
  });

  it('invites can add the new member to teams', async () => {
    const ws = await createWorkspace();
    const team = await domain.teams.create(ws.ctx, { id: newId(), name: 'Support' });
    const user = await createUser('Dana', 'Scully');
    await domain.invites.create(ws.ctx, { invites: [{ emailAddress: user.emailAddress, teamIds: [team.id] }] });
    const joined = await domain.invites.accept(user, { workspaceId: ws.workspaceId });
    expect((await domain.teams.get(ws.ctx, team.id)).members.map((m) => m.memberId)).toEqual([joined.membership.id]);
    await expectCode(
      domain.invites.create(ws.ctx, { invites: [{ emailAddress: 'x@example.com', teamIds: [newId()] }] }),
      'VALIDATION_ERROR',
      400,
    );
  });
});

describe('members', () => {
  it('suspend, reactivate and remove keep history; the last admin stays; a removed member can be invited back', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const team = await domain.teams.create(ws.ctx, { id: newId(), name: 'Ops', memberIds: [bob.memberId] });
    const { list } = await domain.lists.create(ws.ctx, { name: 'Shared', parentEntityDefinitionIds: ['people'] });
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'list',
      resourceId: list.id,
      target: { type: 'member', id: bob.memberId },
      level: 'full-access',
    });

    await expectCode(domain.members.suspend(bob.ctx, ws.memberId), 'FORBIDDEN', 403);
    await expectCode(domain.members.suspend(ws.ctx, ws.memberId), 'VALIDATION_ERROR', 400);
    const suspended = await domain.members.suspend(ws.ctx, bob.memberId);
    expect(suspended).toMatchObject({ accessLevel: 'suspended', removedAt: null });
    expect(suspended.suspendedAt).not.toBeNull();
    const back = await domain.members.reactivate(ws.ctx, bob.memberId);
    expect(back).toMatchObject({ accessLevel: 'member', suspendedAt: null });

    const removed = await domain.members.remove(ws.ctx, bob.memberId);
    expect(removed.accessLevel).toBe('suspended');
    expect(removed.removedAt).not.toBeNull();
    expect(removed.teams).toEqual([]);
    expect((await domain.teams.get(ws.ctx, team.id)).memberCount).toBe(0);
    const tab = await domain.permissions.list(ws.ctx, { resourceKind: 'list', resourceId: list.id });
    expect(tab.grants.some((g) => g.target.id === bob.memberId)).toBe(false);
    // History stays: the row is still listed (labels actor values) unless removed members are excluded.
    expect((await domain.members.list(ws.ctx)).some((m) => m.id === bob.memberId)).toBe(true);
    expect((await domain.members.list(ws.ctx, { includeRemoved: false })).some((m) => m.id === bob.memberId)).toBe(
      false,
    );
    await expectCode(domain.members.reactivate(ws.ctx, bob.memberId), 'NOT_FOUND', 404);

    // Invite again: the same membership comes back.
    const row = await database.kysely
      .selectFrom('workspace_members')
      .select(['email_address', 'user_id'])
      .where('id', '=', bob.memberId)
      .executeTakeFirstOrThrow();
    await domain.invites.create(ws.ctx, { invites: [{ emailAddress: row.email_address }] });
    const rejoined = await domain.invites.accept(
      { userId: row.user_id, emailAddress: row.email_address, firstName: 'Bob', lastName: 'Hopper' },
      { workspaceId: ws.workspaceId },
    );
    expect(rejoined.membership).toMatchObject({ id: bob.memberId, accessLevel: 'member' });

    await expectCode(domain.members.remove(ws.ctx, ws.memberId), 'VALIDATION_ERROR', 400);
    await domain.members.updateAccessLevel(ws.ctx, { memberId: bob.memberId, accessLevel: 'admin' });
    await domain.members.remove(bob.ctx, ws.memberId); // another admin remains
    await expectCode(
      domain.members.updateAccessLevel(bob.ctx, { memberId: bob.memberId, accessLevel: 'member' }),
      'LAST_ADMIN',
      409,
    );
  });
});

async function uploadImage(ctx: TestWorkspace['ctx'], memberId: string, contentType = 'image/png') {
  const body = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const { session, upload } = await domain.files.createUploadSession(ctx, {
    id: newId(),
    entityDefinitionId: 'workspace_members',
    entityInstanceId: memberId,
    parentFolderId: null,
    filename: `avatar-${newId().slice(-8)}.png`,
    contentType,
    contentSize: body.byteLength,
  });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body });
  expect(put.ok).toBe(true);
  return (await domain.files.complete(ctx, { sessionId: session.id })).entry.id;
}

describe('profile and workspace settings', () => {
  it('avatar and logo are image files uploaded to the member’s own record', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const avatar = await uploadImage(ws.ctx, ws.memberId);
    expect((await domain.profile.update(ws.ctx, { avatarFileId: avatar })).avatarFileId).toBe(avatar);
    expect((await domain.members.get(bob.ctx, ws.memberId)).avatarFileId).toBe(avatar);
    // Someone else's file, or a file that is not an image, is refused.
    await expectCode(domain.profile.update(bob.ctx, { avatarFileId: avatar }), 'VALIDATION_ERROR', 400);
    const text = await uploadImage(bob.ctx, bob.memberId, 'text/plain');
    await expectCode(domain.profile.update(bob.ctx, { avatarFileId: text }), 'VALIDATION_ERROR', 400);
    expect((await domain.profile.update(ws.ctx, { avatarFileId: null })).avatarFileId).toBeNull();

    const logo = await uploadImage(ws.ctx, ws.memberId);
    expect(await domain.workspace.update(ws.ctx, { logoFileId: logo })).toMatchObject({
      logoFileId: logo,
      logoUrl: null,
    });
    expect((await domain.workspace.get(bob.ctx)).logoFileId).toBe(logo);
  });

  it('profile: names (all workspaces), time zone, week start, locale', async () => {
    const ws = await createWorkspace();
    const other = await domain.workspaces.create(ws.user, { name: 'Second', slug: `second-${newId().slice(0, 8)}` });
    const profile = await domain.profile.update(ws.ctx, {
      name: { firstName: 'Ada', lastName: 'King' },
      timeZone: 'Europe/Berlin',
      weekStart: 'monday',
      locale: 'en-GB',
    });
    expect(profile).toMatchObject({
      firstName: 'Ada',
      lastName: 'King',
      timeZone: 'Europe/Berlin',
      weekStart: 'monday',
      locale: 'en-GB',
      avatarFileId: null,
    });
    const otherCtx = { workspaceId: other.id, actor: { type: 'workspace-member' as const, id: other.membership.id } };
    expect(await domain.profile.get(otherCtx)).toMatchObject({ lastName: 'King', timeZone: 'Europe/Berlin' });
    expect(await domain.preferences.get(ws.ctx)).toMatchObject({ weekStartDay: 1, timeZone: 'Europe/Berlin' });
    await expectCode(domain.profile.update(ws.ctx, { timeZone: 'Mars/Olympus' }), 'VALIDATION_ERROR');
    await expectCode(domain.profile.update(ws.ctx, { avatarFileId: newId() }), 'VALIDATION_ERROR');
  });

  it('workspace general: name and slug (admin; reserved and taken slugs refused)', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const other = await createWorkspace();
    const slug = `renamed-${newId().slice(0, 8)}`;
    expect(await domain.workspace.checkSlug(ws.ctx, slug)).toMatchObject({ available: true, reason: null });
    expect(await domain.workspace.checkSlug(ws.ctx, other.slug)).toMatchObject({ available: false, reason: 'taken' });
    expect(await domain.workspace.checkSlug(ws.ctx, 'settings')).toMatchObject({
      available: false,
      reason: 'reserved',
    });
    expect(await domain.workspace.checkSlug(ws.ctx, ws.slug)).toMatchObject({ available: true, reason: 'current' });
    expect(await domain.workspace.checkSlug(ws.ctx, 'Bad Slug')).toMatchObject({ valid: false });

    const updated = await domain.workspace.update(ws.ctx, { name: 'Renamed', slug });
    expect(updated).toMatchObject({ name: 'Renamed', slug, exportFormulaInjectionPrefix: false, logoFileId: null });
    await expectCode(domain.workspace.update(ws.ctx, { slug: other.slug }), 'SLUG_IN_USE', 409);
    await expectCode(domain.workspace.update(ws.ctx, { slug: 'admin' }), 'RESERVED_SLUG', 400);
    await expectCode(domain.workspace.update(bob.ctx, { name: 'Mine' }), 'FORBIDDEN', 403);
  });

  it('export security: exported CSV cells that start like formulas get an apostrophe when the switch is on', async () => {
    const ws = await createWorkspace();
    const object = await dt.schema.createObject(ws.ctx, {
      id: newId(),
      apiSlug: `sheets_${newId().slice(-6)}`,
      singularNoun: 'Sheet',
      pluralNoun: 'Sheets',
    });
    const note = await dt.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'Note',
      type: 'text',
    });
    const id = newId();
    await dt.records.create(ws.ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: id,
      values: { [note.id]: [{ value: '=HYPERLINK("http://evil")' }] },
    });
    const view = await dt.views.create(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'All',
      columns: [{ path: [{ entityDefinitionId: object.id, attributeDefinitionId: note.id }] }],
    });
    const run = async () => {
      const exportId = newId();
      await dt.exports.create(ws.ctx, { exportId, viewId: view.id, format: 'csv', locale: 'en-US', timeZone: 'UTC' });
      await dt.exports.execute(ws.workspaceId, exportId);
      const { url } = await dt.exports.downloadUrl(ws.ctx, { exportId });
      return new TextDecoder().decode(new Uint8Array(await (await fetch(url)).arrayBuffer()).slice(3));
    };
    expect(await run()).toContain(`${id},,"=HYPERLINK(""http://evil"")"`);
    await domain.workspace.updateSettings(ws.ctx, { exportFormulaInjectionPrefix: true });
    expect(await run()).toContain(`${id},,"'=HYPERLINK(""http://evil"")"`);
  });

  it('export security: the switch is stored and exports prefix formula-like cells', async () => {
    const ws = await createWorkspace();
    expect(
      (await domain.workspace.updateSettings(ws.ctx, { exportFormulaInjectionPrefix: true }))
        .exportFormulaInjectionPrefix,
    ).toBe(true);
    expect((await domain.workspace.get(ws.ctx)).exportFormulaInjectionPrefix).toBe(true);
    expect(['=SUM(A1)', '+1', '-2', '@x', '\tx', 'plain', ''].map(protectFormula)).toEqual([
      "'=SUM(A1)",
      "'+1",
      "'-2",
      "'@x",
      "'\tx",
      'plain',
      '',
    ]);
  });
});
