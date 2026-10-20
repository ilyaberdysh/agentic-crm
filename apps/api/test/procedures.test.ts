// tRPC procedures over HTTP against the real domain: workspaces, members, invites, schema, records, values, views,
// snapshots, permission call sites and the Attio error envelope (BACKLOG §1: 1.03, 1.04, 1.06, 1.10; acceptance 4, 6).
import { randomUUID } from 'node:crypto';
import { type ActionFlags, flagsForScope, rankBetween } from '@agentic-crm/contracts';
import type { PolicyResolver } from '@agentic-crm/domain';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  type TrpcOptions,
  trpcCall,
  trpcError,
  verifyEmail,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
const slug = `proc-${Date.now().toString(36)}`;
let workspaceId: string;
let memberId: string;

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

beforeAll(async () => {
  h = await startHarness();
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  outsider = await signUp(h, 'Olga Outsider');
  const created = await call<Out['workspaces']['create']>(admin, 'workspaces.create', { name: 'Proc Co', slug });
  workspaceId = created.workspace.id;
  const invite = await call<Out['invites']['create']>(admin, 'invites.create', {
    invites: [{ emailAddress: member.email }],
  });
  await verifyEmail(h, member);
  const joined = await call<Out['invites']['accept']>(member, 'invites.accept', { inviteId: invite.invites[0]?.id });
  memberId = joined.workspace.membership.id;
  await call(outsider, 'workspaces.create', { name: 'Elsewhere', slug: `${slug}-x` }, { slug: undefined });
});
afterAll(async () => {
  await h?.close();
});

describe('workspaces', () => {
  it('checks handle availability (taken, reserved, malformed)', async () => {
    const check = (s: string) => call<Out['workspaces']['checkSlug']>(admin, 'workspaces.checkSlug', { slug: s });
    expect(await check(`${slug}-free`)).toMatchObject({ valid: true, available: true });
    expect(await check(slug)).toMatchObject({ valid: true, available: false });
    expect(await check('settings')).toMatchObject({ available: false });
    expect(await check('Not A Slug')).toMatchObject({ valid: false, available: false });
  });

  it('creates idempotently by client id and answers 409 SLUG_IN_USE / 400 RESERVED_SLUG', async () => {
    const id = randomUUID();
    const input = { id, name: 'Replay', slug: `${slug}-r` };
    const first = await call<Out['workspaces']['create']>(admin, 'workspaces.create', input);
    const again = await call<Out['workspaces']['create']>(admin, 'workspaces.create', input);
    expect(again.workspace).toEqual(first.workspace);
    expect(first.workspace.membership.accessLevel).toBe('admin');

    const taken = await trpcError(call(member, 'workspaces.create', { name: 'Dup', slug }));
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      status_code: 409,
      additional_information: { code: 'SLUG_IN_USE', conflicting_field: 'slug' },
    });
    const reserved = await trpcError(call(member, 'workspaces.create', { name: 'Res', slug: 'settings' }));
    expect(reserved.body).toMatchObject({ statusCode: 400, additional_information: { code: 'RESERVED_SLUG' } });
  });

  it('lists the caller’s workspaces and resolves the current one with the membership', async () => {
    const list = await call<Out['workspaces']['list']>(member, 'workspaces.list');
    expect(list.map((w) => w.slug)).toEqual([slug]);
    const current = await call<Out['workspaces']['current']>(member, 'workspaces.current');
    expect(current).toMatchObject({ id: workspaceId, slug, membership: { id: memberId, accessLevel: 'member' } });
  });

  it('lets admins rename the workspace; members get 403', async () => {
    const renamed = await call<Out['workspaces']['update']>(admin, 'workspaces.update', { name: 'Proc Company' });
    expect(renamed.workspace.name).toBe('Proc Company');
    expect(renamed.seq).toMatch(/^\d+$/);
    const denied = await trpcError(call(member, 'workspaces.update', { name: 'Nope' }));
    expect(denied.body).toMatchObject({ statusCode: 403, message: 'Only workspace admins can do this' });
  });
});

describe('members and invites', () => {
  it('lists members; only admins change access levels', async () => {
    const members = await call<Out['members']['list']>(member, 'members.list');
    expect(members.map((m) => m.emailAddress).sort()).toEqual([admin.email, member.email].sort());
    expect(
      (await trpcError(call(member, 'members.updateAccessLevel', { memberId, accessLevel: 'admin' }))).status,
    ).toBe(403);
    const promoted = await call<Out['members']['updateAccessLevel']>(admin, 'members.updateAccessLevel', {
      memberId,
      accessLevel: 'admin',
    });
    expect(promoted.member.accessLevel).toBe('admin');
    await call(admin, 'members.updateAccessLevel', { memberId, accessLevel: 'member' });
  });

  it('keeps the last admin', async () => {
    const solo = await signUp(h, 'Solo Admin');
    const soloSlug = `${slug}-solo`;
    const ws = await call<Out['workspaces']['create']>(solo, 'workspaces.create', { name: 'Solo', slug: soloSlug });
    const err = await trpcError(
      call(
        solo,
        'members.updateAccessLevel',
        { memberId: ws.workspace.membership.id, accessLevel: 'member' },
        { slug: soloSlug },
      ),
    );
    expect(err.body).toMatchObject({ statusCode: 409, additional_information: { code: 'LAST_ADMIN' } });
  });

  it('invites (admin only), lists pending invites, accepts by token for the verified invited email', async () => {
    const guest = await signUp(h, 'Gus Guest');
    expect((await trpcError(call(member, 'invites.create', { invites: [{ emailAddress: guest.email }] }))).status).toBe(
      403,
    );
    const { invites } = await call<Out['invites']['create']>(admin, 'invites.create', {
      invites: [{ emailAddress: guest.email, accessLevel: 'member' }],
    });
    const pending = await call<Out['invites']['list']>(admin, 'invites.list');
    expect(pending.map((i) => i.emailAddress)).toContain(guest.email);
    expect((await trpcError(call(member, 'invites.list'))).status).toBe(403);

    const mine = await call<Out['invites']['listMine']>(guest, 'invites.listMine', undefined, { slug: undefined });
    expect(mine).toEqual([
      expect.objectContaining({ id: invites[0]?.id, workspace: expect.objectContaining({ slug }) }),
    ]);

    // By slug there is no proof of the mailbox: an unverified account is refused.
    const unverified = await trpcError(call(guest, 'invites.accept', { workspaceSlug: slug }));
    expect(unverified.status).toBe(403);
    await verifyEmail(h, guest);
    const wrongToken = await trpcError(call(guest, 'invites.accept', { inviteId: randomUUID() }));
    expect(wrongToken.body).toMatchObject({ statusCode: 404, additional_information: { code: 'INVITE_NOT_FOUND' } });
    const accepted = await call<Out['invites']['accept']>(guest, 'invites.accept', { inviteId: invites[0]?.id });
    expect(accepted.workspace).toMatchObject({ slug, membership: { accessLevel: 'member' } });
    // Accepting again (by slug) is idempotent for members.
    const again = await call<Out['invites']['accept']>(guest, 'invites.accept', { workspaceSlug: slug });
    expect(again.workspace.membership.id).toBe(accepted.workspace.membership.id);
  });

  it('invited sign-up: a new account with the invited email accepts by token and becomes verified', async () => {
    const email = `invited-${randomUUID().slice(0, 8)}@example.com`;
    const { invites } = await call<Out['invites']['create']>(admin, 'invites.create', {
      invites: [{ emailAddress: email, accessLevel: 'member' }],
    });
    const token = invites[0]?.id as string;
    // Someone else (another email) cannot use the token, and is not verified by trying.
    const stranger = await signUp(h, 'Sam Stranger');
    const stolen = await trpcError(call(stranger, 'invites.accept', { inviteId: token }, { slug: undefined }));
    expect(stolen.body).toMatchObject({ statusCode: 404, additional_information: { code: 'INVITE_NOT_FOUND' } });
    expect((await call<Out['me']>(stranger, 'me', undefined, { slug: undefined })).user.emailVerified).toBe(false);

    // The invitee signs up through the link (self sign-ups start unverified) and accepts by token.
    const invitee = await signUp(h, 'Ina Invitee', email);
    expect((await call<Out['me']>(invitee, 'me', undefined, { slug: undefined })).user.emailVerified).toBe(false);
    const joined = await call<Out['invites']['accept']>(
      invitee,
      'invites.accept',
      { inviteId: token },
      { slug: undefined },
    );
    expect(joined.workspace).toMatchObject({ slug, membership: { accessLevel: 'member' } });
    expect((await call<Out['me']>(invitee, 'me', undefined, { slug: undefined })).user.emailVerified).toBe(true);
    // The member can use the workspace at once, and the invite is no longer pending.
    expect((await call<Out['workspaces']['current']>(invitee, 'workspaces.current')).slug).toBe(slug);
    const pending = await call<Out['invites']['list']>(admin, 'invites.list');
    expect(pending.some((i) => i.emailAddress === email)).toBe(false);
    // The used token has no pending invite any more; accepting by slug stays idempotent for the member.
    const replay = await trpcError(call(invitee, 'invites.accept', { inviteId: token }, { slug: undefined }));
    expect(replay.status).toBe(404);
    const bySlug = await call<Out['invites']['accept']>(invitee, 'invites.accept', { workspaceSlug: slug });
    expect(bySlug.workspace.membership.id).toBe(joined.workspace.membership.id);
  });

  it('revokes an invite', async () => {
    const email = `revoked-${randomUUID().slice(0, 8)}@example.com`;
    const { invites } = await call<Out['invites']['create']>(admin, 'invites.create', {
      invites: [{ emailAddress: email }],
    });
    const revoked = await call<Out['invites']['revoke']>(admin, 'invites.revoke', { inviteId: invites[0]?.id });
    expect(revoked.invite.revokedAt).not.toBeNull();
    const pending = await call<Out['invites']['list']>(admin, 'invites.list');
    expect(pending.some((i) => i.emailAddress === email)).toBe(false);
  });

  it('removes (suspends) a member, who then loses access; admins cannot remove themselves', async () => {
    const temp = await signUp(h, 'Tim Temp');
    const { invites } = await call<Out['invites']['create']>(admin, 'invites.create', {
      invites: [{ emailAddress: temp.email }],
    });
    await verifyEmail(h, temp);
    const joined = await call<Out['invites']['accept']>(temp, 'invites.accept', { inviteId: invites[0]?.id });
    expect((await call<Out['workspaces']['current']>(temp, 'workspaces.current')).slug).toBe(slug);

    const self = await trpcError(call(admin, 'members.remove', { memberId: (await adminMembership()).id }));
    expect(self.status).toBe(400);
    const removed = await call<Out['members']['remove']>(admin, 'members.remove', {
      memberId: joined.workspace.membership.id,
    });
    expect(removed.member.accessLevel).toBe('suspended');
    expect((await trpcError(call(temp, 'workspaces.current'))).status).toBe(403);
  });
});

async function adminMembership() {
  return (await call<Out['workspaces']['current']>(admin, 'workspaces.current')).membership;
}

describe('schema', () => {
  it('lists objects and activates Deals (seeding its attributes once)', async () => {
    const objects = await call<Out['schema']['objects']['list']>(member, 'schema.objects.list', {
      entityTypes: ['company-record', 'person-record', 'standard-object'],
    });
    expect(objects.map((o) => o.apiSlug)).toEqual(['companies', 'people', 'deals', 'users', 'workspaces']);
    expect(objects.find((o) => o.apiSlug === 'deals')?.isArchived).toBe(true);
    const activated = await call<Out['schema']['objects']['activate']>(admin, 'schema.objects.activate', {
      entityDefinitionId: 'deals',
    });
    expect(activated.object.isArchived).toBe(false);
    expect(activated.seq).toMatch(/^\d+$/);
    const attrs = await call<Out['schema']['attributes']['list']>(member, 'schema.attributes.list', {
      entityDefinitionId: 'deals',
    });
    expect(attrs.map((a) => a.apiSlug)).toEqual(expect.arrayContaining(['name', 'stage', 'owner', 'value']));
  });

  it('creates custom objects (admin only, idempotent) and renames them', async () => {
    // Slice 6 (X-06): new objects default to workspace Read and write; the members below configure it, so the dialog's
    // "Workspace access" is Full access here.
    const input = {
      id: randomUUID(),
      apiSlug: 'projects',
      singularNoun: 'Project',
      pluralNoun: 'Projects',
      workspaceAccess: 'full-access',
    };
    expect((await trpcError(call(member, 'schema.objects.create', input))).status).toBe(403);
    const created = await call<Out['schema']['objects']['create']>(admin, 'schema.objects.create', input);
    const replay = await call<Out['schema']['objects']['create']>(admin, 'schema.objects.create', input);
    expect(replay.object).toEqual(created.object);
    expect(replay.seq).toBeNull(); // nothing changed
    const renamed = await call<Out['schema']['objects']['update']>(member, 'schema.objects.update', {
      entityDefinitionId: 'projects',
      singularNoun: 'Initiative',
    });
    expect(renamed.object.singularNoun).toBe('Initiative');
    const fetched = await call<Out['schema']['objects']['get']>(member, 'schema.objects.get', {
      entityDefinitionId: created.object.id,
    });
    expect(fetched.apiSlug).toBe('projects');
  });

  it('attributes: create with options, update, duplicate (options copied), archive and restore', async () => {
    const id = randomUUID();
    const [low, high] = [randomUUID(), randomUUID()];
    const created = await call<Out['schema']['attributes']['create']>(member, 'schema.attributes.create', {
      id,
      entityDefinitionId: 'projects',
      title: 'Priority',
      type: 'select',
      options: [
        { id: low, title: 'Low' },
        { id: high, title: 'High' },
      ],
    });
    expect(created.attribute).toMatchObject({ id, apiSlug: 'priority', type: 'select' });
    const updated = await call<Out['schema']['attributes']['update']>(member, 'schema.attributes.update', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: 'priority',
      description: 'How urgent',
    });
    expect(updated.attribute.description).toBe('How urgent');

    const copyId = randomUUID();
    const copy = await call<Out['schema']['attributes']['duplicate']>(member, 'schema.attributes.duplicate', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: id,
      id: copyId,
    });
    expect(copy.attribute).toMatchObject({
      id: copyId,
      title: 'Priority (copy)',
      type: 'select',
      description: 'How urgent',
    });
    const copied = await call<Out['schema']['options']['list']>(member, 'schema.options.list', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: copyId,
    });
    expect(copied.map((o) => o.title)).toEqual(['Low', 'High']);
    expect(copied.map((o) => o.id)).not.toContain(low); // fresh ids (X-02)

    const archived = await call<Out['schema']['attributes']['archive']>(member, 'schema.attributes.archive', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: copyId,
    });
    expect(archived.attribute.isArchived).toBe(true);
    const restored = await call<Out['schema']['attributes']['restore']>(member, 'schema.attributes.restore', {
      entityDefinitionId: 'projects',
      attributeDefinitionId: copyId,
    });
    expect(restored.attribute.isArchived).toBe(false);
  });

  it('select options: create, reorder, archive, title conflicts', async () => {
    const ref = { entityDefinitionId: 'projects', attributeDefinitionId: 'priority' };
    const medium = randomUUID();
    const created = await call<Out['schema']['options']['create']>(member, 'schema.options.create', {
      ...ref,
      id: medium,
      title: 'Medium',
    });
    expect(created.option.title).toBe('Medium');
    const options = await call<Out['schema']['options']['list']>(member, 'schema.options.list', ref);
    const [first] = options;
    const moved = await call<Out['schema']['options']['reorder']>(member, 'schema.options.reorder', {
      ...ref,
      selectOptionId: medium,
      sortOrder: rankBetween(null, first?.sortOrder ?? null),
    });
    const after = await call<Out['schema']['options']['list']>(member, 'schema.options.list', ref);
    expect(after[0]?.id).toBe(moved.option.id);
    const dup = await trpcError(call(member, 'schema.options.create', { ...ref, id: randomUUID(), title: 'medium' }));
    expect(dup.body).toMatchObject({ statusCode: 409, additional_information: { code: 'TITLE_IN_USE' } });
    const archived = await call<Out['schema']['options']['archive']>(member, 'schema.options.archive', {
      ...ref,
      selectOptionId: medium,
    });
    expect(archived.option.isArchived).toBe(true);
  });

  it('statuses: create a status attribute, add, reorder and archive stages', async () => {
    const attrId = randomUUID();
    await call(member, 'schema.attributes.create', {
      id: attrId,
      entityDefinitionId: 'projects',
      title: 'Phase',
      type: 'pipeline',
      stages: [{ title: 'Discovery' }, { title: 'Build' }],
    });
    const ref = { entityDefinitionId: 'projects', attributeDefinitionId: attrId };
    const done = randomUUID();
    const created = await call<Out['schema']['statuses']['create']>(member, 'schema.statuses.create', {
      ...ref,
      id: done,
      title: 'Done',
      lifecyclePhase: 'WON',
    });
    expect(created.status).toMatchObject({ title: 'Done', lifecyclePhase: 'WON' });
    const stages = await call<Out['schema']['statuses']['list']>(member, 'schema.statuses.list', ref);
    expect(stages.map((s) => s.title)).toEqual(['Discovery', 'Build', 'Done']);
    await call(member, 'schema.statuses.reorder', {
      ...ref,
      pipelineStageId: done,
      sortOrder: rankBetween(null, stages[0]?.sortOrder ?? null),
    });
    expect((await call<Out['schema']['statuses']['list']>(member, 'schema.statuses.list', ref))[0]?.title).toBe('Done');
    const archived = await call<Out['schema']['statuses']['archive']>(member, 'schema.statuses.archive', {
      ...ref,
      pipelineStageId: done,
    });
    expect(archived.status.isArchived).toBe(true);
  });
});

describe('records and values', () => {
  const companyId = randomUUID();
  const domain = `acme-${randomUUID().slice(0, 6)}.example.com`;

  it('PUT-creates idempotently and answers the 409 unique envelope (acceptance 6)', async () => {
    const input = {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      values: { name: [{ value: 'Acme' }], domains: [{ value: domain }] },
    };
    const first = await call<Out['records']['put']>(member, 'records.put', input);
    expect(first).toMatchObject({ created: true, record: { entityInstanceId: companyId } });
    expect(first.seq).toMatch(/^\d+$/);
    expect(first.record.accurateAt).toMatch(/Z$/);
    const replay = await call<Out['records']['put']>(member, 'records.put', { ...input, values: {} });
    expect(replay).toMatchObject({ created: false, seq: null });

    const clash = await trpcError(
      call(member, 'records.put', {
        ...input,
        entityInstanceId: randomUUID(),
        values: { domains: [{ value: domain }] },
      }),
    );
    expect(clash.status).toBe(409);
    const { data: _data, message, ...envelope } = clash.body;
    expect(typeof message).toBe('string');
    expect(envelope).toMatchObject({
      statusCode: 409,
      error: 'Conflict',
      status_code: 409,
      additional_information: { code: 'UNIQUE_CONSTRAINT_VIOLATION', entity_instance_ids: [companyId] },
    });
  });

  it('a value write retires the old row; history has both; activeAt reads the old value (acceptance 4)', async () => {
    const before = await call<Out['records']['get']>(member, 'records.get', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
    });
    const nameAttr = Object.keys(before.values).find((k) => before.values[k]?.[0]?.value === 'Acme') as string;
    const put = await call<Out['values']['put']>(member, 'values.put', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      attributeDefinitionId: 'name',
      attributeValueId: randomUUID(),
      value: 'Acme Inc',
    });
    expect(put.values.map((v) => v.value)).toEqual(['Acme Inc']);
    expect(put.seq).toMatch(/^\d+$/);
    expect(put.accurateAt).toMatch(/Z$/);

    const history = await call<Out['records']['history']>(member, 'records.history', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      attributeDefinitionId: nameAttr,
    });
    expect(history.values.map((v) => [v.value, v.activeUntil === null])).toEqual([
      ['Acme Inc', true],
      ['Acme', false],
    ]);
    const old = history.values[1];
    const pointInTime = await call<Out['records']['get']>(member, 'records.get', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      activeAt: old?.activeFrom,
    });
    expect(pointInTime.values[nameAttr]?.map((v) => v.value)).toEqual(['Acme']);
  });

  it('PATCH, batch reads with per-id state, multi-value put/reorder/retire', async () => {
    const patched = await call<Out['records']['patch']>(member, 'records.patch', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      values: { description: [{ value: 'Rockets' }] },
    });
    expect(
      Object.values(patched.values)
        .flat()
        .some((v) => v.value === 'Rockets'),
    ).toBe(true);
    expect(patched.seq).toMatch(/^\d+$/);

    const missing = randomUUID();
    const batch = await call<Out['records']['batchGet']>(member, 'records.batchGet', {
      entityDefinitionId: 'companies',
      entityInstanceIds: [companyId, missing],
    });
    expect(batch.records[companyId]).toMatchObject({ state: 'complete', value: { entityInstanceId: companyId } });
    expect(batch.records[missing]).toEqual({ state: 'error', error: 'NOT_FOUND' });

    const second = await call<Out['values']['put']>(member, 'values.put', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      attributeDefinitionId: 'domains',
      attributeValueId: randomUUID(),
      value: `alt-${domain}`,
    });
    expect(second.values).toHaveLength(2);
    const [a, b] = second.values;
    const reordered = await call<Out['values']['reorder']>(member, 'values.reorder', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      attributeDefinitionId: 'domains',
      attributeValueId: b?.id,
      sortOrder: rankBetween(null, a?.sortOrder ?? null),
    });
    expect(reordered.values[0]?.id).toBe(b?.id);
    const retired = await call<Out['values']['retire']>(member, 'values.retire', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
      attributeDefinitionId: 'domains',
      attributeValueId: b?.id,
    });
    expect(retired.values.map((v) => v.id)).toEqual([a?.id]);

    const listed = await call<Out['values']['list']>(member, 'values.list', {
      entityDefinitionId: 'companies',
      attributeDefinitionId: 'domains',
      entityInstanceIds: [companyId, missing],
    });
    expect(listed.values[companyId]).toMatchObject({ state: 'complete' });
    expect(listed.values[missing]).toEqual({ state: 'error', error: 'NOT_FOUND' });
  });

  it('deletes and restores; merges two people into a new record', async () => {
    const deleted = await call<Out['records']['delete']>(member, 'records.delete', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
    });
    expect(deleted.record.archivedAt).not.toBeNull();
    const gone = await trpcError(
      call(member, 'records.get', { entityDefinitionId: 'companies', entityInstanceId: companyId }),
    );
    expect(gone.status).toBe(404);
    const restored = await call<Out['records']['restore']>(member, 'records.restore', {
      entityDefinitionId: 'companies',
      entityInstanceId: companyId,
    });
    expect(restored.record.archivedAt).toBeNull();

    const [p1, p2, merged] = [randomUUID(), randomUUID(), randomUUID()];
    await call(member, 'records.put', {
      entityDefinitionId: 'people',
      entityInstanceId: p1,
      values: { email_addresses: [{ value: `p1-${p1.slice(0, 6)}@example.com` }], job_title: [{ value: 'CEO' }] },
    });
    await call(member, 'records.put', {
      entityDefinitionId: 'people',
      entityInstanceId: p2,
      values: { email_addresses: [{ value: `p2-${p2.slice(0, 6)}@example.com` }] },
    });
    const result = await call<Out['records']['merge']>(member, 'records.merge', {
      entityDefinitionId: 'people',
      baseEntityInstanceId: p1,
      targetEntityInstanceId: p2,
      mergedEntityInstanceId: merged,
    });
    expect(result.record.entityInstanceId).toBe(merged);
    expect(
      Object.values(result.values)
        .flat()
        .filter((v) => v.attributeType === 'email-address'),
    ).toHaveLength(2);
    const sources = await call<Out['records']['batchGet']>(member, 'records.batchGet', {
      entityDefinitionId: 'people',
      entityInstanceIds: [p1, p2, merged],
    });
    expect([p1, p2, merged].map((id) => sources.records[id]?.state)).toEqual(['error', 'error', 'complete']);
  });
});

describe('views and snapshots', () => {
  it('lists default views and edits a view: create, update, filter, sorts, columns, delete', async () => {
    const defaults = await call<Out['views']['list']>(member, 'views.list', { entityDefinitionId: 'companies' });
    expect(defaults.map((v) => v.title)).toEqual(['All Companies', 'US Companies', 'UK, French and German Companies']);
    const companies = await call<Out['schema']['objects']['get']>(member, 'schema.objects.get', {
      entityDefinitionId: 'companies',
    });
    const attrs = await call<Out['schema']['attributes']['list']>(member, 'schema.attributes.list', {
      entityDefinitionId: companies.id,
    });
    const path = (slug: string) => [
      { entityDefinitionId: companies.id, attributeDefinitionId: attrs.find((a) => a.apiSlug === slug)?.id },
    ];
    const viewId = randomUUID();
    const columnId = randomUUID();
    const created = await call<Out['views']['create']>(member, 'views.create', {
      id: viewId,
      entityDefinitionId: 'companies',
      title: 'Mine',
      columns: [{ id: columnId, path: path('description') }],
    });
    expect(created.view).toMatchObject({ id: viewId, title: 'Mine', filter: null, sorts: [] });
    expect(created.seq).toMatch(/^\d+$/);
    const replay = await call<Out['views']['create']>(member, 'views.create', {
      id: viewId,
      entityDefinitionId: 'companies',
      title: 'Ignored',
    });
    expect(replay).toMatchObject({ view: { title: 'Mine' }, seq: null });

    const renamed = await call<Out['views']['update']>(member, 'views.update', { viewId, title: 'Mine 2' });
    expect(renamed.view.title).toBe('Mine 2');
    const filter = {
      path: path('name'),
      mode: 'must',
      constraints: [{ field: 'value', operator: 'contains', value: 'Acme' }],
    };
    const filtered = await call<Out['views']['setFilter']>(member, 'views.setFilter', { viewId, filter });
    expect(filtered.view.filter).toMatchObject({ mode: 'must' });
    const sorted = await call<Out['views']['setSorts']>(member, 'views.setSorts', {
      viewId,
      sorts: [{ path: path('name'), direction: 'asc' }],
    });
    expect(sorted.view.sorts).toHaveLength(1);
    const added = await call<Out['views']['addColumn']>(member, 'views.addColumn', {
      viewId,
      id: randomUUID(),
      path: path('domains'),
    });
    expect(added.view.columns).toHaveLength(2);
    const widened = await call<Out['views']['updateColumn']>(member, 'views.updateColumn', {
      viewId,
      columnId,
      tableColumnWidth: 300,
    });
    expect(widened.view.columns.find((c) => c.id === columnId)?.tableColumnWidth).toBe(300);
    const removed = await call<Out['views']['removeColumn']>(member, 'views.removeColumn', { viewId, columnId });
    expect(removed.view.columns).toHaveLength(1);

    const snapshot = await call<Out['snapshots']['query']>(member, 'snapshots.query', {
      entityDefinitionId: 'companies',
      viewId,
    });
    expect(snapshot).toMatchObject({ entityDefinitionId: companies.id, start: 0 });
    expect(snapshot.total).toBe(snapshot.ids.length);

    const deleted = await call<Out['views']['delete']>(member, 'views.delete', { viewId });
    expect(deleted).toMatchObject({ id: viewId, entityDefinitionId: companies.id, seq: expect.any(String) });
    expect((await trpcError(call(member, 'views.get', { viewId }))).status).toBe(404);
  });

  it('snapshots: query, chunk, aggregate, resolve selection; a foreign object id is refused', async () => {
    const people = await call<Out['schema']['objects']['get']>(member, 'schema.objects.get', {
      entityDefinitionId: 'people',
    });
    const companies = await call<Out['schema']['objects']['get']>(member, 'schema.objects.get', {
      entityDefinitionId: 'companies',
    });
    for (let i = 0; i < 3; i += 1) {
      await call(member, 'records.put', {
        entityDefinitionId: 'people',
        entityInstanceId: randomUUID(),
        values: { job_title: [{ value: `Role ${i}` }] },
      });
    }
    const snap = await call<Out['snapshots']['query']>(member, 'snapshots.query', {
      entityDefinitionId: people.id,
      initialRange: { start: 0, size: 2 },
    });
    expect(snap.ids).toHaveLength(2);
    expect(snap.total).toBeGreaterThanOrEqual(3);
    const chunk = await call<Out['snapshots']['chunk']>(member, 'snapshots.chunk', {
      snapshotId: snap.snapshotId,
      entityDefinitionId: people.id,
      start: 1,
      size: 2,
    });
    expect(chunk.ids[0]).toBe(snap.ids[1]);
    const foreign = await trpcError(
      call(member, 'snapshots.chunk', { snapshotId: snap.snapshotId, entityDefinitionId: companies.id, start: 0 }),
    );
    expect(foreign.body).toMatchObject({ statusCode: 404, additional_information: { code: 'SNAPSHOT_NOT_FOUND' } });

    const attrs = await call<Out['schema']['attributes']['list']>(member, 'schema.attributes.list', {
      entityDefinitionId: people.id,
    });
    const jobTitle = attrs.find((a) => a.apiSlug === 'job_title')?.id;
    const filled = await call<Out['snapshots']['aggregate']>(member, 'snapshots.aggregate', {
      snapshotId: snap.snapshotId,
      path: [{ entityDefinitionId: people.id, attributeDefinitionId: jobTitle }],
      aggregation: 'filled',
    });
    expect(filled.value).toBeGreaterThanOrEqual(3);
    const selection = await call<Out['snapshots']['resolveSelection']>(member, 'snapshots.resolveSelection', {
      snapshotId: snap.snapshotId,
      entityDefinitionId: people.id,
      zebraEdges: [0, 2],
    });
    expect(selection.ids).toEqual(snap.ids);

    // Bulk delete of a selection: exactly those snapshot rows, with a change seq.
    const removed = await call<Out['records']['deleteSelection']>(member, 'records.deleteSelection', {
      entityDefinitionId: people.id,
      snapshotId: snap.snapshotId,
      zebraEdges: [1, 2],
    });
    expect(removed).toMatchObject({ deletedIds: [snap.ids[1]], skipped: 0, seq: expect.any(String) });
    const gone = await call<Out['records']['batchGet']>(member, 'records.batchGet', {
      entityDefinitionId: people.id,
      entityInstanceIds: [snap.ids[1] as string],
    });
    expect(gone.records[snap.ids[1] as string]).toMatchObject({ state: 'error' });
  });
});

describe('permission hook', () => {
  it('resolves the caller’s action policies and capabilities', async () => {
    const { policies } = await call<Out['policies']['resolve']>(member, 'policies.resolve', {
      entityDefinitionIds: ['companies'],
    });
    expect(policies.companies).toMatchObject({
      state: 'complete',
      value: { workspaceMembershipId: memberId, read_entity_instance: true, update_entity_view: true },
    });
    const caps = await call<Out['capabilities']['get']>(member, 'capabilities.get');
    expect(caps.features.custom_objects).toBe(true);
  });

  it('enforces the resolved policy at every call site (read-only resolver)', async () => {
    const readOnly: PolicyResolver = {
      async resolve(_tx, subject, definitions) {
        const flags: ActionFlags = flagsForScope(subject.accessLevel === 'admin' ? 'full-access' : 'read-only');
        // Views are writable for read-only scopes in Attio's presets; deny them here to exercise view call sites.
        if (subject.accessLevel !== 'admin') flags.update_entity_view = false;
        return new Map(definitions.map((d) => [d.id, flags]));
      },
    };
    const strict = await startHarness({}, { policyResolver: readOnly });
    try {
      const boss = await signUp(strict, 'Bea Boss');
      const viewer = await signUp(strict, 'Vic Viewer');
      const strictSlug = `${slug}-ro`;
      const as = <T>(user: TestUser, path: string, input?: unknown) =>
        trpcCall<T>(strict, path, input, { user, slug: strictSlug });
      await as(boss, 'workspaces.create', { name: 'Strict', slug: strictSlug });
      const { invites } = await as<Out['invites']['create']>(boss, 'invites.create', {
        invites: [{ emailAddress: viewer.email }],
      });
      await verifyEmail(strict, viewer);
      await as(viewer, 'invites.accept', { inviteId: invites[0]?.id });

      // Reads pass.
      const snap = await as<Out['snapshots']['query']>(viewer, 'snapshots.query', { entityDefinitionId: 'companies' });
      expect(snap.total).toBe(0);
      // Writes are refused by the procedure's policy check, with the Attio envelope.
      const put = await trpcError(
        as(viewer, 'records.put', { entityDefinitionId: 'companies', entityInstanceId: randomUUID(), values: {} }),
      );
      expect(put.body).toMatchObject({
        statusCode: 403,
        error: 'Forbidden',
        additional_information: { code: 'FORBIDDEN', action: 'create_entity_instance' },
      });
      const [view] = await as<Out['views']['list']>(viewer, 'views.list', { entityDefinitionId: 'companies' });
      const rename = await trpcError(as(viewer, 'views.update', { viewId: view?.id, title: 'Nope' }));
      expect(rename.body).toMatchObject({ statusCode: 403, additional_information: { action: 'update_entity_view' } });
      const attr = await trpcError(
        as(viewer, 'schema.attributes.create', {
          id: randomUUID(),
          entityDefinitionId: 'companies',
          title: 'Secret',
          type: 'text',
        }),
      );
      expect(attr.status).toBe(403);
      // The admin (full access) still writes.
      const ok = await as<Out['records']['put']>(boss, 'records.put', {
        entityDefinitionId: 'companies',
        entityInstanceId: randomUUID(),
        values: {},
      });
      expect(ok.created).toBe(true);
    } finally {
      await strict.close();
    }
  });
});
