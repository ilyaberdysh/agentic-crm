// Slice 6 permissions engine (BACKLOG 6.04/6.05; J permissions §2–5; decisions X-06, OQ-067): level → flag presets
// for every kind, grant targets and most-permissive resolution (workspace / team / member / workflow), defaults per
// kind, the admin rule, and enforcement in representative domain procedures.
import {
  type AccessScope,
  accessScopes,
  actionFlags,
  flagsForScope,
  kindFlagsForScope,
  resourceKindFlags,
} from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { memberContext } from '../src/index.ts';
import { addMember } from './collab-fixtures.ts';
import { createWorkspace, domain, expectCode, newId, type TestWorkspace } from './support/harness.ts';

// J permissions §2 preset table, transcribed: flag → allowed levels (NA, RO, RW, FA).
// biome-ignore format: matrix
const MATRIX: Record<string, [boolean, boolean, boolean, boolean]> = {
  administrate_entity_definition_permissions: [false, false, false, true],
  read_entity_definition:                     [false, true, true, true],
  update_entity_definition:                   [false, false, false, true],
  delete_entity_definition:                   [false, false, false, true],
  read_attribute_definition:                  [false, true, true, true],
  create_attribute_definition:                [false, false, false, true],
  update_attribute_definition:                [false, false, false, true],
  archive_attribute_definition:               [false, false, false, true],
  read_attribute_value:                       [false, true, true, true],
  create_attribute_value:                     [false, false, true, true],
  update_attribute_value:                     [false, false, true, true],
  read_entity_instance:                       [false, true, true, true],
  create_entity_instance:                     [false, false, true, true],
  update_entity_instance:                     [false, false, true, true],
  delete_entity_instance:                     [false, false, true, true],
  batch_delete_entity_instances:              [false, false, true, true],
  create_entity_view:                         [false, true, true, true],
  update_entity_view:                         [false, true, true, true],
  delete_entity_view:                         [false, true, true, true],
  create_custom_layout:                       [false, false, false, true],
  update_custom_layout:                       [false, false, false, true],
  delete_custom_layout:                       [false, false, false, true],
};
const LEVELS: AccessScope[] = ['no-access', 'read-only', 'read-write', 'full-access'];

async function customObject(ws: TestWorkspace, workspaceAccess?: AccessScope) {
  const slug = `gadgets_${Math.random().toString(36).slice(2, 8)}`;
  const object = await domain.schema.createObject(ws.ctx, {
    id: newId(),
    apiSlug: slug,
    singularNoun: 'Gadget',
    pluralNoun: 'Gadgets',
    ...(workspaceAccess ? { workspaceAccess } : {}),
  });
  return object;
}

async function levelOf(ctx: TestWorkspace['ctx'], kind: 'object' | 'list', id: string) {
  const { resolved } = await domain.permissions.resolve(ctx, { resourceKind: kind, resourceIds: [id] });
  const entry = resolved[id];
  if (entry?.state !== 'complete') throw new Error(`unresolved ${id}`);
  return entry.value;
}

describe('levels × flags', () => {
  it('objects and lists map the four levels to exactly the 22 flags of the preset table', () => {
    expect(Object.keys(MATRIX).sort()).toEqual([...actionFlags].sort());
    for (const [i, level] of LEVELS.entries()) {
      const flags = flagsForScope(level);
      for (const flag of actionFlags) expect([level, flag, flags[flag]]).toEqual([level, flag, MATRIX[flag]?.[i]]);
      expect(kindFlagsForScope('object', level)).toEqual(flags);
      expect(kindFlagsForScope('list', level)).toEqual(flags);
    }
  });

  it('dashboards, workflows and sequences: Full = all four, Read and write = read + update, Read only = read', () => {
    for (const kind of ['dashboard', 'workflow', 'sequence'] as const) {
      const [administrate, read, update, del] = resourceKindFlags[kind];
      const allowed = (level: AccessScope) =>
        Object.entries(kindFlagsForScope(kind, level))
          .filter(([, v]) => v)
          .map(([k]) => k)
          .sort();
      expect(allowed('full-access')).toEqual([administrate, read, update, del].sort());
      expect(allowed('read-write')).toEqual([read, update].sort());
      expect(allowed('read-only')).toEqual([read]);
      expect(allowed('no-access')).toEqual([]);
    }
  });
});

describe('targets and resolution', () => {
  it('a team grant plus a workspace grant resolve to the more permissive level (acceptance 3)', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws, 'read-only');
    expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe('read-only');

    const team = await domain.teams.create(ws.ctx, { id: newId(), name: 'Sales', memberIds: [bob.memberId] });
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'team', id: team.id },
      level: 'full-access',
    });
    const resolved = await levelOf(bob.ctx, 'object', object.id);
    expect(resolved.level).toBe('full-access');
    expect(resolved.source).toEqual({ type: 'team', id: team.id, name: 'Sales' });
    expect(resolved.flags.create_attribute_definition).toBe(true);

    // Lower team grants never reduce access: the workspace level wins again.
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'team', id: team.id },
      level: 'no-access',
    });
    expect(await levelOf(bob.ctx, 'object', object.id)).toMatchObject({
      level: 'read-only',
      source: { type: 'workspace' },
    });

    // Leaving the team drops what it gave.
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'team', id: team.id },
      level: 'read-write',
    });
    expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe('read-write');
    await domain.teams.removeMembers(ws.ctx, { teamId: team.id, memberIds: [bob.memberId] });
    expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe('read-only');
  });

  it('member grants add access; the most permissive of workspace, teams and own grant wins for lists too', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const { list } = await domain.lists.create(ws.ctx, {
      name: 'Private',
      parentEntityDefinitionIds: ['companies'],
      workspaceAccess: 'no-access',
    });
    expect((await levelOf(bob.ctx, 'list', list.id)).level).toBe('no-access');
    expect((await levelOf(ws.ctx, 'list', list.id)).level).toBe('full-access'); // creator

    await domain.permissions.put(ws.ctx, {
      resourceKind: 'list',
      resourceId: list.id,
      target: { type: 'member', id: bob.memberId },
      level: 'read-only',
    });
    const team = await domain.teams.create(ws.ctx, { id: newId(), name: 'Ops', memberIds: [bob.memberId] });
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'list',
      resourceId: list.id,
      target: { type: 'team', id: team.id },
      level: 'read-write',
    });
    expect(await levelOf(bob.ctx, 'list', list.id)).toMatchObject({
      level: 'read-write',
      source: { type: 'team', id: team.id },
    });

    // The Permissions tab: workspace row first, then teams, then members — with the inheritance hint.
    const tab = await domain.permissions.list(ws.ctx, { resourceKind: 'list', resourceId: list.id });
    expect(tab.canManage).toBe(true);
    expect(tab.grants.map((g) => [g.target.type, g.level])).toEqual([
      ['workspace', 'no-access'],
      ['team', 'read-write'],
      ['member', 'full-access'],
      ['member', 'read-only'],
    ]);
    const bobRow = tab.grants.find((g) => g.target.id === bob.memberId);
    expect(bobRow?.effective).toEqual({ level: 'read-write', source: { type: 'team', id: team.id, name: 'Ops' } });
    expect(tab.grants.find((g) => g.target.type === 'team')).toMatchObject({ targetName: 'Ops', targetDetail: '1' });

    // Removing overrides: "Remove member-level override"; the workspace grant cannot be removed.
    await domain.permissions.remove(ws.ctx, {
      resourceKind: 'list',
      resourceId: list.id,
      target: { type: 'team', id: team.id },
    });
    expect((await levelOf(bob.ctx, 'list', list.id)).level).toBe('read-only');
    await expectCode(
      domain.permissions.remove(ws.ctx, { resourceKind: 'list', resourceId: list.id, target: { type: 'workspace' } }),
      'VALIDATION_ERROR',
      400,
    );
  });

  it('suspended and removed members get nothing; workspace-level tokens and the system keep full access', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws, 'read-write');
    await domain.members.suspend(ws.ctx, bob.memberId);
    const policies = await domain.policies.resolve(bob.ctx, { entityDefinitionIds: [object.id] });
    expect(policies.policies[object.id]).toMatchObject({ state: 'complete', value: { read_entity_instance: false } });
    const token = { workspaceId: ws.workspaceId, actor: { type: 'api-token' as const, id: newId() } };
    expect((await levelOf(token, 'object', object.id)).source.type).toBe('token');
    expect((await levelOf(ws.sys, 'object', object.id)).level).toBe('full-access');
  });

  it('workflow actors inherit the workspace grant plus their own grant', async () => {
    const ws = await createWorkspace();
    const object = await customObject(ws, 'read-only');
    const workflowId = newId();
    // Grantee workflows must exist (slice 8).
    await expectCode(
      domain.permissions.put(ws.ctx, {
        resourceKind: 'object',
        resourceId: object.id,
        target: { type: 'workflow', id: workflowId },
        level: 'read-write',
      }),
      'NOT_FOUND',
      404,
    );
    await domain.workflows.create(ws.ctx, { id: workflowId, title: 'Grantee' });
    const wf = { workspaceId: ws.workspaceId, actor: { type: 'workflow' as const, id: workflowId } };
    expect((await levelOf(wf, 'object', object.id)).level).toBe('read-only');
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'workflow', id: workflowId },
      level: 'read-write',
    });
    expect(await levelOf(wf, 'object', object.id)).toMatchObject({ level: 'read-write', source: { type: 'workflow' } });
    await expectCode(
      domain.records
        .create(wf, { entityDefinitionId: object.id, entityInstanceId: newId(), values: {} })
        .then(() =>
          domain.schema.createAttribute(wf, { id: newId(), entityDefinitionId: object.id, title: 'X', type: 'text' }),
        ),
      'FORBIDDEN',
      403,
    );
  });

  it('every level can be granted on objects and lists (No access included, BACKLOG §6 acceptance 2)', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws);
    for (const level of accessScopes) {
      await domain.permissions.put(ws.ctx, {
        resourceKind: 'object',
        resourceId: object.id,
        target: { type: 'workspace' },
        level,
      });
      expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe(level);
    }
  });
});

describe('defaults per resource kind (X-06)', () => {
  it('new objects: workspace Read and write (or the dialog level) and Full access for the creator', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws);
    const tab = await domain.permissions.list(ws.ctx, { resourceKind: 'object', resourceId: object.id });
    expect(tab.grants.map((g) => [g.target.type, g.target.id, g.level])).toEqual([
      ['workspace', ws.workspaceId, 'read-write'],
      ['member', ws.memberId, 'full-access'],
    ]);
    expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe('read-write');
    const readOnly = await customObject(ws, 'read-only');
    expect((await levelOf(bob.ctx, 'object', readOnly.id)).level).toBe('read-only');
  });

  it('objects without grants (standard objects, pre-slice-6 data) keep Full access; settings override the default', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const people = await domain.schema.getObject(ws.ctx, 'people');
    expect(await levelOf(bob.ctx, 'object', people.id)).toMatchObject({
      level: 'full-access',
      source: { type: 'default' },
    });
    const tab = await domain.permissions.list(bob.ctx, { resourceKind: 'object', resourceId: people.id });
    expect(tab.grants[0]).toMatchObject({ id: null, target: { type: 'workspace' }, level: 'full-access' });

    await domain.workspace.updateSettings(ws.ctx, { defaultWorkspaceAccess: { object: 'read-only' } });
    const object = await customObject(ws);
    expect((await levelOf(bob.ctx, 'object', object.id)).level).toBe('read-only');
  });

  it('the workspace default for new lists set in settings applies to lists.create', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    await domain.workspace.updateSettings(ws.ctx, { defaultWorkspaceAccess: { list: 'read-only' } });
    const { list } = await domain.lists.create(ws.ctx, { name: 'Defaults', parentEntityDefinitionIds: ['companies'] });
    expect((await levelOf(bob.ctx, 'list', list.id)).level).toBe('read-only');
    expect((await levelOf(ws.ctx, 'list', list.id)).level).toBe('full-access');
  });
});

describe('admin rule (OQ-067) and grant management', () => {
  it('admins follow grants for data but can always manage grants; members need Full access to manage', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws, 'read-only');
    // The creator (an admin) drops to Read only: no writes, but grants stay manageable.
    await domain.permissions.remove(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'member', id: ws.memberId },
    });
    expect((await levelOf(ws.ctx, 'object', object.id)).level).toBe('read-only');
    await expectCode(
      domain.records.create(ws.ctx, { entityDefinitionId: object.id, entityInstanceId: newId(), values: {} }),
      'FORBIDDEN',
      403,
    );
    expect((await levelOf(ws.ctx, 'object', object.id)).canManagePermissions).toBe(true);
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'member', id: ws.memberId },
      level: 'full-access',
    });
    await domain.records.create(ws.ctx, { entityDefinitionId: object.id, entityInstanceId: newId(), values: {} });

    // A plain member with Read only cannot change grants…
    await expectCode(
      domain.permissions.put(bob.ctx, {
        resourceKind: 'object',
        resourceId: object.id,
        target: { type: 'member', id: bob.memberId },
        level: 'full-access',
      }),
      'FORBIDDEN',
      403,
    );
    const view = await domain.permissions.list(bob.ctx, { resourceKind: 'object', resourceId: object.id });
    expect(view.canManage).toBe(false);
    // …but with Full access they can.
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'member', id: bob.memberId },
      level: 'full-access',
    });
    await domain.permissions.put(bob.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'workspace' },
      level: 'read-write',
    });
  });

  it('kinds of later slices are registered but not available until their resources exist', async () => {
    const ws = await createWorkspace();
    await expectCode(
      domain.permissions.list(ws.ctx, { resourceKind: 'sequence', resourceId: newId() }),
      'VALIDATION_ERROR',
      400,
    );
    // Slice 9 registered dashboards: an unknown dashboard is a 404.
    await expectCode(
      domain.permissions.list(ws.ctx, { resourceKind: 'dashboard', resourceId: newId() }),
      'NOT_FOUND',
      404,
    );
  });
});

describe('enforcement in domain procedures', () => {
  it('Read only: reads and views work; record, value and schema writes answer 403', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws, 'read-write');
    const attr = await domain.schema.createAttribute(ws.ctx, {
      id: newId(),
      entityDefinitionId: object.id,
      title: 'Score',
      type: 'number',
    });
    const recordId = newId();
    await domain.records.create(ws.ctx, {
      entityDefinitionId: object.id,
      entityInstanceId: recordId,
      values: { [attr.id]: [{ value: 1 }] },
    });
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'workspace' },
      level: 'read-only',
    });
    const ref = { entityDefinitionId: object.id, entityInstanceId: recordId };
    await domain.records.get(bob.ctx, ref);
    await domain.views.create(bob.ctx, { id: newId(), entityDefinitionId: object.id, title: 'Mine' } as never);
    await expectCode(domain.records.update(bob.ctx, { ...ref, values: { [attr.id]: [{ value: 2 }] } }), 'FORBIDDEN');
    await expectCode(
      domain.values.put(bob.ctx, { ...ref, attributeDefinitionId: attr.id, value: 3 } as never),
      'FORBIDDEN',
    );
    await expectCode(domain.records.delete(bob.ctx, ref), 'FORBIDDEN');
    await expectCode(
      domain.records.create(bob.ctx, { entityDefinitionId: object.id, entityInstanceId: newId(), values: {} }),
      'FORBIDDEN',
    );
    await expectCode(
      domain.schema.updateObject(bob.ctx, { entityDefinitionId: object.id, pluralNoun: 'Widgets' }),
      'FORBIDDEN',
    );
    // Read and write still cannot configure the object (Full access only).
    await domain.permissions.put(ws.ctx, {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'workspace' },
      level: 'read-write',
    });
    await domain.records.update(bob.ctx, { ...ref, values: { [attr.id]: [{ value: 2 }] } });
    await expectCode(
      domain.schema.createAttribute(bob.ctx, { id: newId(), entityDefinitionId: object.id, title: 'X', type: 'text' }),
      'FORBIDDEN',
    );
  });

  it('No access: the object is unreadable and search leaves it out; user-level tokens act as their member', async () => {
    const ws = await createWorkspace();
    const bob = await addMember(ws, 'Bob');
    const object = await customObject(ws, 'no-access');
    const recordId = newId();
    await domain.records.create(ws.ctx, { entityDefinitionId: object.id, entityInstanceId: recordId, values: {} });
    await expectCode(
      domain.records.get(bob.ctx, { entityDefinitionId: object.id, entityInstanceId: recordId }),
      'FORBIDDEN',
    );
    const policies = await domain.policies.resolve(bob.ctx, { entityDefinitionIds: [object.id] });
    expect(policies.policies[object.id]).toMatchObject({ value: { read_entity_definition: false } });

    const asBob = {
      workspaceId: ws.workspaceId,
      actor: { type: 'api-token' as const, id: newId() },
      onBehalfOfMemberId: bob.memberId,
    };
    await expectCode(
      domain.records.get(asBob, { entityDefinitionId: object.id, entityInstanceId: recordId }),
      'FORBIDDEN',
    );
    const asWorkspace = { workspaceId: ws.workspaceId, actor: { type: 'api-token' as const, id: newId() } };
    await domain.records.get(asWorkspace, { entityDefinitionId: object.id, entityInstanceId: recordId });
    expect(memberContext(ws.workspaceId, bob.memberId).actor.id).toBe(bob.memberId);
  });
});
