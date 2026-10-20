import { describe, expect, it } from 'vitest';
import { memberContext } from '../src/index.ts';
import { createUser, createWorkspace, database, domain, expectCode } from './support/harness.ts';

describe('workspace bootstrap', () => {
  it('seeds the standard data model (A §4.3)', async () => {
    const ws = await createWorkspace();
    const objects = await domain.schema.listObjects(ws.ctx);
    const bySlug = new Map(objects.map((o) => [o.apiSlug, o]));

    expect(bySlug.get('people')).toMatchObject({
      entityType: 'person-record',
      isArchived: false,
      singularNoun: 'Person',
    });
    expect(bySlug.get('companies')).toMatchObject({
      entityType: 'company-record',
      isArchived: false,
      pluralNoun: 'Companies',
    });
    for (const slug of ['deals', 'users', 'workspaces']) {
      expect(bySlug.get(slug)).toMatchObject({ entityType: 'standard-object', isArchived: true });
    }
    expect(bySlug.get('workspace_members')).toMatchObject({ entityType: 'workspace-member', isArchived: false });
    const tasks = objects.find((o) => o.entityType === 'task');
    expect(tasks?.apiSlug).toBe(tasks?.id); // tasks are addressed by their definition id
    expect(
      objects
        .filter((o) => o.entityType === 'interface')
        .map((o) => o.apiSlug)
        .sort(),
    ).toEqual(['entities', 'list_entries', 'objects', 'system']);
    const objectsIface = bySlug.get('objects');
    expect(bySlug.get('people')?.interfaceIds).toEqual([objectsIface?.id]);
    // Sidebar order: Companies, People, Deals, Users, Workspaces.
    const order = ['companies', 'people', 'deals', 'users', 'workspaces'].map((s) => bySlug.get(s)?.sortOrder ?? '');
    expect([...order].sort()).toEqual(order);
  });

  it('gives People and Companies their system attributes (attribute-types §4)', async () => {
    const ws = await createWorkspace();
    const companies = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'companies' });
    const people = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    expect(companies).toHaveLength(33);
    expect(people).toHaveLength(30);

    const c = new Map(companies.map((a) => [a.apiSlug, a]));
    const p = new Map(people.map((a) => [a.apiSlug, a]));
    expect(c.get('domains')).toMatchObject({
      type: 'domain',
      isMultiselect: true,
      isUnique: true,
      systemAttributeType: 'domains',
    });
    expect(c.get('funding_raised_usd')).toMatchObject({ type: 'currency', isHistoric: true });
    expect(c.get('list_entries')).toMatchObject({ isHidden: true, isReadOnly: true });
    expect(c.get('record_id')).toMatchObject({ type: 'text', systemAttributeType: 'id', isReadOnly: true });
    expect(p.get('name')).toMatchObject({ type: 'personal-name' });
    expect(p.get('email_addresses')).toMatchObject({ type: 'email-address', isMultiselect: true, isUnique: true });
    // Relationship pair: companies.team ↔ people.company.
    expect(c.get('team')?.relationship).toEqual({
      relatedEntityDefinitionId: p.get('company')?.entityDefinitionId,
      relatedAttributeDefinitionId: p.get('company')?.id,
    });
    expect(p.get('company')?.relationship?.relatedAttributeDefinitionId).toBe(c.get('team')?.id);
    expect(c.get('team')?.isMultiselect).toBe(true);
    expect(p.get('company')?.isMultiselect).toBe(false);
    // Interface bindings: record_id → entities.record_id, created_at → system.created_at.
    const entities = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'entities' });
    expect(c.get('record_id')?.interfaceAttributeId).toBe(entities.find((a) => a.apiSlug === 'record_id')?.id);
    const options = await domain.schema.listOptions(ws.ctx, {
      entityDefinitionId: 'companies',
      attributeDefinitionId: 'employee_range',
    });
    expect(options.map((o) => o.title)).toEqual([
      '1-10',
      '11-50',
      '51-250',
      '251-1K',
      '1K-5K',
      '5K-10K',
      '10K-50K',
      '50K-100K',
      '100K+',
    ]);
    expect(options.every((o) => o.color.startsWith('pastel_'))).toBe(true);
  });

  it('creates the default views (C1 README §1)', async () => {
    const ws = await createWorkspace();
    const companies = await domain.views.list(ws.ctx, { entityDefinitionId: 'companies' });
    expect(companies.map((v) => v.title)).toEqual(['All Companies', 'US Companies', 'UK, French and German Companies']);
    const all = companies[0];
    expect(all?.type).toBe('table');
    expect(all?.columns).toHaveLength(10);
    expect(all?.sorts.map((s) => s.direction)).toEqual(['desc', 'desc']);
    expect(companies[1]?.filter).toMatchObject({
      and: [{ mode: 'must', constraints: [{ field: 'country_code', value: 'US' }] }],
    });
    const people = await domain.views.list(ws.ctx, { entityDefinitionId: 'people' });
    expect(people.map((v) => v.title)).toEqual(['Recently Contacted People']);
    expect(await domain.views.list(ws.ctx, { entityDefinitionId: 'deals' })).toEqual([]);
  });

  it('makes the creator an admin with a member record', async () => {
    const ws = await createWorkspace();
    const members = await domain.members.list(ws.ctx);
    expect(members).toMatchObject([{ id: ws.memberId, accessLevel: 'admin', emailAddress: ws.user.emailAddress }]);
    const record = await domain.records.get(ws.ctx, {
      entityDefinitionId: 'workspace_members',
      entityInstanceId: ws.memberId,
    });
    const attrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'workspace_members' });
    const email = attrs.find((a) => a.apiSlug === 'email_address');
    expect(record.values[email?.id ?? '']?.[0]?.value).toMatchObject({ normalizedEmailAddress: ws.user.emailAddress });
    const picker = await domain.workspaces.listForUser(ws.user.userId);
    expect(picker.map((w) => w.id)).toEqual([ws.workspaceId]);
    expect(await domain.workspaces.resolveForUser(ws.user.userId, { slug: ws.slug })).toMatchObject({ status: 'ok' });
  });

  it('activating Deals seeds attributes, relationships and views', async () => {
    const ws = await createWorkspace();
    const deals = await domain.schema.updateObject(ws.ctx, { entityDefinitionId: 'deals', isArchived: false });
    expect(deals.isArchived).toBe(false);
    const attrs = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'deals' });
    expect(attrs.map((a) => a.apiSlug)).toEqual([
      'record_id',
      'name',
      'stage',
      'list_entries',
      'owner',
      'value',
      'associated_people',
      'associated_company',
      'next_due_task',
      'created_at',
      'created_by',
    ]);
    const stages = await domain.schema.listStages(ws.ctx, {
      entityDefinitionId: 'deals',
      attributeDefinitionId: 'stage',
    });
    expect(stages.map((s) => [s.title, s.lifecyclePhase])).toEqual([
      ['Lead', 'ACTIVE'],
      ['In progress', 'ACTIVE'],
      ['Won', 'WON'],
      ['Lost', 'LOST'],
    ]);
    const people = await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'people' });
    expect(people.find((a) => a.apiSlug === 'associated_deals')?.relationship?.relatedEntityDefinitionId).toBe(
      deals.id,
    );
    const views = await domain.views.list(ws.ctx, { entityDefinitionId: 'deals' });
    expect(views.map((v) => [v.title, v.type])).toEqual([
      ['Pipeline', 'kanban'],
      ['All Deals', 'table'],
    ]);
    // A deal gets its required owner (current user) and stage (Lead) from defaults.
    const created = await domain.records.create(ws.ctx, {
      entityDefinitionId: 'deals',
      entityInstanceId: crypto.randomUUID(),
      values: { name: [{ value: 'Big deal' }] },
    });
    const byslug = new Map(attrs.map((a) => [a.apiSlug, a.id]));
    expect(created.values[byslug.get('stage') ?? '']?.[0]?.value).toEqual({ pipelineStageId: stages[0]?.id });
    expect(created.values[byslug.get('owner') ?? '']?.[0]?.value).toEqual({
      referencedActorType: 'workspace-member',
      referencedActorId: ws.memberId,
    });
    // Re-activation does not seed twice.
    await domain.schema.updateObject(ws.ctx, { entityDefinitionId: 'deals', isArchived: true });
    await domain.schema.updateObject(ws.ctx, { entityDefinitionId: 'deals', isArchived: false });
    expect(await domain.schema.listAttributes(ws.ctx, { entityDefinitionId: 'deals' })).toHaveLength(11);
  });

  it('rejects reserved and taken handles', async () => {
    const ws = await createWorkspace();
    const user = await createUser();
    await expectCode(domain.workspaces.create(user, { name: 'X', slug: 'settings' }), 'RESERVED_SLUG', 400);
    const err = await expectCode(domain.workspaces.create(user, { name: 'X', slug: ws.slug }), 'SLUG_IN_USE', 409);
    expect(err.details).toEqual({ conflicting_field: 'slug' });
    expect(await domain.workspaces.isSlugAvailable(ws.slug)).toBe(false);
    expect(await domain.workspaces.isSlugAvailable('api')).toBe(false);
    expect(await domain.workspaces.isSlugAvailable(`free-${Date.now()}`)).toBe(true);
  });
});

describe('members and invites', () => {
  it('invites a member, accepts, changes role and protects the last admin', async () => {
    const ws = await createWorkspace();
    const invitee = await createUser('Grace', 'Hopper');
    const [invite] = await domain.invites.create(ws.ctx, {
      invites: [{ emailAddress: invitee.emailAddress.toUpperCase() }],
    });
    expect(invite).toMatchObject({
      emailAddress: invitee.emailAddress,
      accessLevel: 'member',
      createdByMemberId: ws.memberId,
    });
    await expectCode(
      domain.invites.create(ws.ctx, { invites: [{ emailAddress: invitee.emailAddress }] }),
      'INVITE_ALREADY_EXISTS',
      409,
    );
    await expectCode(
      domain.invites.create(ws.ctx, { invites: [{ emailAddress: ws.user.emailAddress }] }),
      'ALREADY_A_MEMBER',
      409,
    );
    expect((await domain.invites.listForEmail(invitee.emailAddress)).map((i) => i.workspace.id)).toEqual([
      ws.workspaceId,
    ]);

    const joined = await domain.invites.accept(invitee, { workspaceId: ws.workspaceId });
    expect(joined.membership).toMatchObject({ accessLevel: 'member', userId: invitee.userId });
    expect(await domain.invites.list(ws.ctx)).toEqual([]);
    // Accepting again is idempotent.
    expect((await domain.invites.accept(invitee, { workspaceId: ws.workspaceId })).membership.id).toBe(
      joined.membership.id,
    );

    // A member cannot invite or change roles.
    const memberCtx = memberContext(ws.workspaceId, joined.membership.id);
    await expectCode(
      domain.invites.create(memberCtx, { invites: [{ emailAddress: 'x@example.com' }] }),
      'FORBIDDEN',
      403,
    );
    await expectCode(
      domain.members.updateAccessLevel(ws.ctx, { memberId: ws.memberId, accessLevel: 'member' }),
      'LAST_ADMIN',
      409,
    );
    await domain.members.updateAccessLevel(ws.ctx, { memberId: joined.membership.id, accessLevel: 'admin' });
    const demoted = await domain.members.updateAccessLevel(ws.ctx, { memberId: ws.memberId, accessLevel: 'suspended' });
    expect(demoted.suspendedAt).not.toBeNull();
    expect(await domain.workspaces.listForUser(ws.user.userId)).toEqual([]);
    expect(await domain.workspaces.resolveForUser(ws.user.userId, { id: ws.workspaceId })).toEqual({
      status: 'not-member',
    });
  });

  it('refuses invites without a pending invite and revokes', async () => {
    const ws = await createWorkspace();
    const stranger = await createUser('Eve', 'Spy');
    await expectCode(domain.invites.accept(stranger, { workspaceId: ws.workspaceId }), 'INVITE_NOT_FOUND', 404);
    const [invite] = await domain.invites.create(ws.ctx, {
      invites: [{ emailAddress: stranger.emailAddress, accessLevel: 'admin' }],
    });
    const revoked = await domain.invites.revoke(ws.ctx, invite?.id ?? '');
    expect(revoked.revokedAt).not.toBeNull();
    await expectCode(domain.invites.accept(stranger, { workspaceId: ws.workspaceId }), 'INVITE_NOT_FOUND', 404);
  });

  it('resolves allow-all action policies and capabilities', async () => {
    const ws = await createWorkspace();
    const { policies } = await domain.policies.resolve(ws.ctx, { entityDefinitionIds: ['people', 'nope'] });
    const people = Object.values(policies).find((p) => p.state === 'complete');
    expect(people?.state === 'complete' && people.value.create_entity_instance).toBe(true);
    expect(people?.state === 'complete' && people.value.workspaceMembershipId).toBe(ws.memberId);
    expect(policies.nope).toEqual({ state: 'error', error: 'NOT_FOUND' });
    const caps = await domain.capabilities.get(ws.ctx);
    expect(caps.features.custom_objects).toBe(true);
    expect(caps.quotas.seats_per_workspace_hard).toBeNull();
    expect(await domain.capabilities.hasFeature(ws.ctx, 'particle_sql')).toBe(true);
  });

  it('records change_log rows for the bootstrap', async () => {
    const ws = await createWorkspace();
    const rows = await database.kysely
      .selectFrom('change_log')
      .select(['resource'])
      .where('workspace_id', '=', ws.workspaceId)
      .execute();
    const resources = new Set(rows.map((r) => r.resource));
    for (const r of [
      'workspace',
      'workspace-member',
      'entity-definition',
      'attribute-definition-list',
      'entity-view',
    ]) {
      expect(resources.has(r)).toBe(true);
    }
  });
});
