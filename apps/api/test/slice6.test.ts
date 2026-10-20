// Slice 6 procedures over HTTP (BACKLOG §6 acceptance 2–5): Read only answers the public API's 403 envelope on writes, No
// access hides the object from schema.objects.list and policies, a team grant beats a lower workspace grant, a rule
// violation answers 422 PARTICLE_GATE_VIOLATION and the ninth rule the limit message, admin-only settings procedures,
// and a webhook subscribed to record creation receives a signed delivery after a UI (tRPC) and a /v2 create.
import { createHmac, randomUUID } from 'node:crypto';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorkspaceToken } from '../src/cli/token-create';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  type TrpcOptions,
  trpcCall,
  trpcError,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let admin: TestUser;
let member: TestUser;
let workspaceId: string;
let adminMemberId: string;
let memberMemberId: string;
const slug = `s6-${Date.now().toString(36)}`;
const sent: { url: string; headers: Record<string, string>; body: string }[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

async function customObject(workspaceAccess?: string) {
  const created = await call<Out['schema']['objects']['create']>(admin, 'schema.objects.create', {
    id: randomUUID(),
    apiSlug: `gadgets_${randomUUID().slice(0, 6)}`,
    singularNoun: 'Gadget',
    pluralNoun: 'Gadgets',
    ...(workspaceAccess ? { workspaceAccess } : {}),
  });
  return created.object;
}

beforeAll(async () => {
  h = await startHarness(
    {},
    {
      webhookSender: async (request) => {
        sent.push(request);
        return { status: 200 };
      },
    },
  );
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: admin, admin: true }, { user: member }]);
  workspaceId = created.workspaceId;
  adminMemberId = created.memberIds.get(admin.id) as string;
  memberMemberId = created.memberIds.get(member.id) as string;
});

afterAll(async () => {
  await h?.close();
});

describe('permissions over tRPC (acceptance 2, 3)', () => {
  it('Read only: reads work, writes answer the 403 envelope; No access hides the object', async () => {
    const object = await customObject('read-only');
    const recordId = randomUUID();
    await call(admin, 'records.put', { entityDefinitionId: object.id, entityInstanceId: recordId, values: {} });
    await call(member, 'records.get', { entityDefinitionId: object.id, entityInstanceId: recordId });
    const policies = await call<Out['policies']['resolve']>(member, 'policies.resolve', {
      entityDefinitionIds: [object.id],
    });
    expect(policies.policies[object.id]).toMatchObject({
      state: 'complete',
      value: { read_entity_instance: true, update_attribute_value: false, create_entity_instance: false },
    });
    const denied = await trpcError(
      call(member, 'records.patch', { entityDefinitionId: object.id, entityInstanceId: recordId, values: {} }),
    );
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      status_code: 403,
      additional_information: { code: 'FORBIDDEN', action: 'update_entity_instance' },
    });

    await call(admin, 'permissions.put', {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    const objects = await call<Out['schema']['objects']['list']>(member, 'schema.objects.list', {});
    expect(objects.some((o) => o.id === object.id)).toBe(false);
    expect((await trpcError(call(member, 'schema.objects.get', { entityDefinitionId: object.id }))).status).toBe(403);
    // The creator (Full access member grant) still sees it.
    const mine = await call<Out['schema']['objects']['list']>(admin, 'schema.objects.list', {});
    expect(mine.some((o) => o.id === object.id)).toBe(true);
  });

  it('a team grant plus a workspace grant resolve to the more permissive level', async () => {
    const object = await customObject('read-only');
    const team = await call<Out['teams']['create']>(admin, 'teams.create', {
      id: randomUUID(),
      name: 'Engineering',
      memberIds: [memberMemberId],
    });
    expect((await trpcError(call(member, 'teams.create', { id: randomUUID(), name: 'Nope' }))).status).toBe(403);
    const put = await call<Out['permissions']['put']>(admin, 'permissions.put', {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'team', id: team.team.id },
      level: 'read-write',
    });
    expect(put.grant).toMatchObject({ target: { type: 'team', id: team.team.id }, level: 'read-write' });
    const resolved = await call<Out['permissions']['resolve']>(member, 'permissions.resolve', {
      resourceKind: 'object',
      resourceIds: [object.id],
    });
    expect(resolved.resolved[object.id]).toMatchObject({
      state: 'complete',
      value: {
        level: 'read-write',
        source: { type: 'team', id: team.team.id, name: 'Engineering' },
        canManagePermissions: false,
      },
    });
    await call(member, 'records.put', { entityDefinitionId: object.id, entityInstanceId: randomUUID(), values: {} });
    const tab = await call<Out['permissions']['list']>(admin, 'permissions.list', {
      resourceKind: 'object',
      resourceId: object.id,
    });
    expect(tab.grants.map((g) => g.target.type)).toEqual(['workspace', 'team', 'member']);
    const memberPut = await trpcError(
      call(member, 'permissions.put', {
        resourceKind: 'object',
        resourceId: object.id,
        target: { type: 'member', id: memberMemberId },
        level: 'full-access',
      }),
    );
    expect(memberPut.status).toBe(403);
  });
});

describe('admin rule (OQ-067)', () => {
  it('admins without access still reach the definition and its Permissions tab, but not its records', async () => {
    const object = await customObject('no-access');
    await call(admin, 'permissions.remove', {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'member', id: adminMemberId },
    });
    const recordId = randomUUID();
    expect(
      (
        await trpcError(
          call(admin, 'records.put', { entityDefinitionId: object.id, entityInstanceId: recordId, values: {} }),
        )
      ).status,
    ).toBe(403);
    const readable = await call<Out['schema']['objects']['list']>(admin, 'schema.objects.list', {});
    expect(readable.some((o) => o.id === object.id)).toBe(false);
    const all = await call<Out['schema']['objects']['list']>(admin, 'schema.objects.list', { scope: 'all' });
    expect(all.some((o) => o.id === object.id)).toBe(true);
    expect((await trpcError(call(member, 'schema.objects.list', { scope: 'all' }))).status).toBe(403);
    expect(
      (await call<Out['schema']['objects']['get']>(admin, 'schema.objects.get', { entityDefinitionId: object.id })).id,
    ).toBe(object.id);
    const tab = await call<Out['permissions']['list']>(admin, 'permissions.list', {
      resourceKind: 'object',
      resourceId: object.id,
    });
    expect(tab).toMatchObject({ canManage: true, resourceName: 'Gadgets' });
    await call(admin, 'permissions.put', {
      resourceKind: 'object',
      resourceId: object.id,
      target: { type: 'member', id: adminMemberId },
      level: 'full-access',
    });
    await call(admin, 'records.put', { entityDefinitionId: object.id, entityInstanceId: recordId, values: {} });
  });
});

describe('rules over tRPC (acceptance 4)', () => {
  it('a violation answers 422 with the rule message; the ninth rule answers the limit message', async () => {
    const object = await customObject();
    const { attribute: amount } = await call<Out['schema']['attributes']['create']>(admin, 'schema.attributes.create', {
      id: randomUUID(),
      entityDefinitionId: object.id,
      title: 'Amount',
      type: 'number',
    });
    const rule = await call<Out['rules']['create']>(admin, 'rules.create', {
      id: randomUUID(),
      entityDefinitionId: object.id,
      name: 'Amount is required',
      condition: null,
      requirements: [{ attributeDefinitionId: amount.id, operator: 'required' }],
    });
    const violation = await trpcError(
      call(admin, 'records.put', { entityDefinitionId: object.id, entityInstanceId: randomUUID(), values: {} }),
    );
    expect(violation.status).toBe(422);
    expect(violation.body.additional_information).toMatchObject({
      code: 'PARTICLE_GATE_VIOLATION',
      violated_validation_rules: [
        {
          particle_gate_id: rule.rule.id,
          attribute_definition_id: amount.id,
          message: 'Must have a value',
          rule_name: 'Amount is required',
        },
      ],
    });
    for (let i = 0; i < 7; i++) {
      await call(admin, 'rules.create', {
        id: randomUUID(),
        entityDefinitionId: object.id,
        name: `Rule ${i}`,
        condition: null,
        requirements: [{ attributeDefinitionId: amount.id, operator: 'required' }],
      });
    }
    const ninth = await trpcError(
      call(admin, 'rules.create', {
        id: randomUUID(),
        entityDefinitionId: object.id,
        name: 'Ninth',
        condition: null,
        requirements: [{ attributeDefinitionId: amount.id, operator: 'required' }],
      }),
    );
    expect(ninth.status).toBe(409);
    expect(ninth.body.message).toBe('You’ve reached the limit of 8 requirement rules for this object.');
    expect(ninth.body.additional_information).toMatchObject({ code: 'OVER_USAGE_LIMIT', limit: 8 });
    const listed = await call<Out['rules']['list']>(member, 'rules.list', { entityDefinitionId: object.id });
    expect(listed).toHaveLength(8);
  });
});

describe('settings procedures', () => {
  it('profile, workspace, members and tokens; admin-only writes', async () => {
    const profile = await call<Out['profile']['update']>(member, 'profile.update', {
      name: { firstName: 'Max', lastName: 'Payne' },
      weekStart: 'sunday',
    });
    expect(profile.profile).toMatchObject({ firstName: 'Max', lastName: 'Payne', weekStart: 'sunday' });
    expect(await call<Out['profile']['get']>(member, 'profile.get')).toMatchObject({ lastName: 'Payne' });

    expect((await trpcError(call(member, 'workspace.update', { name: 'Nope' }))).status).toBe(403);
    const ws = await call<Out['workspace']['settings']['update']>(admin, 'workspace.settings.update', {
      exportFormulaInjectionPrefix: true,
    });
    expect(ws.workspace.exportFormulaInjectionPrefix).toBe(true);
    expect(await call<Out['workspace']['checkSlug']>(admin, 'workspace.checkSlug', { slug })).toMatchObject({
      available: true,
      reason: 'current',
    });

    const token = await call<Out['developers']['tokens']['create']>(admin, 'developers.tokens.create', {
      name: 'Zapier',
      scopes: ['record_permission:read-write'],
    });
    expect(token.token.token).toMatch(/^[0-9a-f]{64}$/);
    const listed = await call<Out['developers']['tokens']['list']>(admin, 'developers.tokens.list');
    expect(listed.some((t) => t.id === token.token.id && !('token' in t))).toBe(true);
    await call(admin, 'developers.tokens.update', { tokenId: token.token.id, name: 'Zapier 2' });
    await call(admin, 'developers.tokens.delete', { tokenId: token.token.id });
    expect((await trpcError(call(member, 'developers.tokens.list'))).status).toBe(403);

    const members = await call<Out['members']['list']>(member, 'members.list', { includeRemoved: false });
    expect(members.map((m) => m.id).sort()).toEqual([adminMemberId, memberMemberId].sort());
    const detail = await call<Out['members']['get']>(admin, 'members.get', { memberId: memberMemberId });
    expect(detail.teams.length).toBeGreaterThanOrEqual(0);
  });
});

describe('webhooks (acceptance 5)', () => {
  it('a record created in the UI and through /v2 is delivered signed; "Test subscription" delivers a sample', async () => {
    const created = await call<Out['webhooks']['create']>(admin, 'webhooks.create', {
      targetUrl: 'https://hooks.example.com/s6',
      subscriptions: [{ eventType: 'record.created', filter: null }],
    });
    const hook = created.webhook;
    expect((await trpcError(call(member, 'webhooks.list'))).status).toBe(403);

    const uiRecord = randomUUID();
    await call(admin, 'records.put', {
      entityDefinitionId: 'people',
      entityInstanceId: uiRecord,
      values: { name: [{ value: { firstName: 'Grace', lastName: 'Hopper' } }] },
    });
    const { token, id: tokenId } = await createWorkspaceToken(h.database, h.domain, slug, 'v2', [
      'record_permission:read-write',
      'object_configuration:read',
    ]);
    const response = await fetch(`${h.baseUrl}/v2/objects/people/records`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        data: { values: { name: [{ first_name: 'Alan', last_name: 'Turing', full_name: 'Alan Turing' }] } },
      }),
    });
    expect(response.status).toBe(200);
    const apiRecord = ((await response.json()) as { data: { id: { record_id: string } } }).data.id.record_id;

    // Transactions of parallel test files hold the fan-out bound back for a moment: poll until all arrive.
    for (const deadline = Date.now() + 15_000; Date.now() < deadline; ) {
      await h.domain.webhooks.fanOut();
      await h.domain.webhooks.deliverDue({ limit: 100 });
      if (sent.filter((s) => JSON.parse(s.body).webhook_id === hook.id).length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const mine = sent.filter((s) => JSON.parse(s.body).webhook_id === hook.id);
    const events = mine.map((s) => JSON.parse(s.body).events[0]);
    expect(events.map((e) => [e.id.record_id, e.actor])).toEqual([
      [uiRecord, { type: 'workspace-member', id: adminMemberId }],
      [apiRecord, { type: 'api-token', id: tokenId }],
    ]);
    for (const s of mine) {
      expect(s.headers['attio-signature']).toBe(createHmac('sha256', hook.secret).update(s.body).digest('hex'));
    }

    sent.length = 0;
    const test = await call<Out['webhooks']['test']>(admin, 'webhooks.test', { webhookId: hook.id });
    expect(test.delivery).toMatchObject({ isTest: true, status: 'succeeded', eventType: 'record.created' });
    expect(JSON.parse(sent[0]?.body as string)).toMatchObject({
      webhook_id: hook.id,
      events: [{ event_type: 'record.created', id: { workspace_id: workspaceId } }],
    });
    const log = await call<Out['webhooks']['deliveries']>(admin, 'webhooks.deliveries', { webhookId: hook.id });
    expect(log.map((d) => d.isTest)).toEqual([true, false, false]);
  });
});
