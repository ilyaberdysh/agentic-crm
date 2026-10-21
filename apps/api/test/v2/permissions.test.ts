// /v2 permission enforcement (BACKLOG 6.04, §6 acceptance 2): user-level tokens act with their member's grants — writes
// on a Read only object answer the public API's 403 (`auth_error` / `unauthorized` with the endpoint's message), objects and
// lists with No access disappear (404 like unknown ones, left out of GET /objects and /lists) — while workspace-level
// tokens are governed by their scopes only.
import { randomUUID } from 'node:crypto';
import { memberContext, systemContext } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Harness, signUp, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
let bobToken: string;
let bobMemberId: string;
let objectSlug: string;
let objectId: string;
let recordId: string;

const asAdmin = () => memberContext(f.workspaceId, f.memberId);

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'perms');
  const bob = await signUp(h, 'Bob Member');
  bobMemberId = await addMember(h, f.workspaceId, { memberId: f.memberId }, bob);
  const all = [
    'record_permission:read-write',
    'object_configuration:read-write',
    'list_entry:read-write',
    'list_configuration:read-write',
    'user_management:read',
  ] as const;
  bobToken = (
    await h.domain.apiTokens.create(systemContext(f.workspaceId, 'test'), {
      name: 'Bob (OAuth app)',
      scopes: [...all],
      tokenLevel: 'user',
      authorizedByMemberId: bobMemberId,
    })
  ).token;
  objectSlug = `gizmos_${randomUUID().slice(0, 6)}`;
  objectId = (
    await h.domain.schema.createObject(asAdmin(), {
      id: randomUUID(),
      apiSlug: objectSlug,
      singularNoun: 'Gizmo',
      pluralNoun: 'Gizmos',
      workspaceAccess: 'read-only',
    })
  ).id;
  recordId = expectOk(
    'createRecord',
    await f.call('POST', `/objects/${objectSlug}/records`, { body: { data: { values: {} } } }),
  ).data.id.record_id;
});
afterAll(async () => {
  await h?.close();
});

const as = (token: string) => ({ token });

describe('Read only', () => {
  it('reads work; record writes answer 403 with the public API’s messages; the workspace token is unaffected', async () => {
    expectOk('getRecord', await f.call('GET', `/objects/${objectSlug}/records/${recordId}`, as(bobToken)));
    expectOk(
      'queryRecords',
      await f.call('POST', `/objects/${objectSlug}/records/query`, { ...as(bobToken), body: {} }),
    );

    const create = expectError(
      'createRecord',
      await f.call('POST', `/objects/${objectSlug}/records`, { ...as(bobToken), body: { data: { values: {} } } }),
      403,
      'unauthorized',
    );
    expect(create.message).toBe('You do not have the necessary permissions to create this record.');
    const update = expectError(
      'updateRecord',
      await f.call('PATCH', `/objects/${objectSlug}/records/${recordId}`, {
        ...as(bobToken),
        body: { data: { values: {} } },
      }),
      403,
      'unauthorized',
    );
    expect(update.message).toBe('You do not have the necessary permissions to update this record.');
    const del = expectError(
      'deleteRecord',
      await f.call('DELETE', `/objects/${objectSlug}/records/${recordId}`, as(bobToken)),
      403,
      'unauthorized',
    );
    expect(del.message).toBe('You do not have the necessary permissions to delete this record.');
    const attr = expectError(
      'createAttribute',
      await f.call('POST', `/objects/${objectSlug}/attributes`, {
        ...as(bobToken),
        body: {
          data: {
            title: 'Size',
            api_slug: 'size',
            type: 'number',
            description: null,
            is_required: false,
            is_unique: false,
            is_multiselect: false,
            config: {},
          },
        },
      }),
      403,
      'unauthorized',
    );
    expect(attr.message).toBe('You do not have the necessary permissions to create this attribute.');
    const object = expectError(
      'updateObject',
      await f.call('PATCH', `/objects/${objectSlug}`, { ...as(bobToken), body: { data: { plural_noun: 'Things' } } }),
      403,
      'unauthorized',
    );
    expect(object.message).toBe('You do not have the necessary permissions to update this object.');

    const newObject = expectError(
      'createObject',
      await f.call('POST', '/objects', {
        ...as(bobToken),
        body: { data: { api_slug: 'widgets', singular_noun: 'Widget', plural_noun: 'Widgets' } },
      }),
      403,
      'unauthorized',
    );
    expect(newObject.message).toBe('You do not have the necessary permissions to create objects in this workspace.');

    // Workspace-level tokens act as the workspace (scopes only).
    expectOk(
      'updateRecord',
      await f.call('PATCH', `/objects/${objectSlug}/records/${recordId}`, { body: { data: { values: {} } } }),
    );
  });
});

describe('No access', () => {
  it('hides the object from GET /objects and answers 404 like an unknown object', async () => {
    await h.domain.permissions.put(asAdmin(), {
      resourceKind: 'object',
      resourceId: objectId,
      target: { type: 'workspace' },
      level: 'no-access',
    });
    const listed = expectOk('listObjects', await f.call('GET', '/objects', as(bobToken)));
    expect(listed.data.some((o: { api_slug: string }) => o.api_slug === objectSlug)).toBe(false);
    expectError('getObject', await f.call('GET', `/objects/${objectSlug}`, as(bobToken)), 404, 'not_found');
    expectError(
      'getRecord',
      await f.call('GET', `/objects/${objectSlug}/records/${recordId}`, as(bobToken)),
      404,
      'not_found',
    );
    // A member grant brings it back for Bob only.
    await h.domain.permissions.put(asAdmin(), {
      resourceKind: 'object',
      resourceId: objectId,
      target: { type: 'member', id: bobMemberId },
      level: 'read-write',
    });
    expectOk('getObject', await f.call('GET', `/objects/${objectSlug}`, as(bobToken)));
    expectOk(
      'createRecord',
      await f.call('POST', `/objects/${objectSlug}/records`, { ...as(bobToken), body: { data: { values: {} } } }),
    );
    const everyone = expectOk('listObjects', await f.call('GET', '/objects'));
    expect(everyone.data.some((o: { api_slug: string }) => o.api_slug === objectSlug)).toBe(true);
  });

  it('lists: No access hides the list; Read only refuses entry writes with the list message', async () => {
    const created = expectOk(
      'createList',
      await f.call('POST', '/lists', {
        body: {
          data: {
            name: 'Secret',
            api_slug: `secret_${randomUUID().slice(0, 6)}`,
            parent_object: 'companies',
            workspace_access: null,
            workspace_member_access: [],
          },
        },
      }),
    );
    const listId = created.data.id.list_id as string;
    const lists = expectOk('listLists', await f.call('GET', '/lists', as(bobToken)));
    expect(lists.data.some((l: { id: { list_id: string } }) => l.id.list_id === listId)).toBe(false);
    expectError('getList', await f.call('GET', `/lists/${listId}`, as(bobToken)), 404, 'not_found');

    await h.domain.permissions.put(asAdmin(), {
      resourceKind: 'list',
      resourceId: listId,
      target: { type: 'workspace' },
      level: 'read-only',
    });
    const company = expectOk(
      'createRecord',
      await f.call('POST', '/objects/companies/records', { body: { data: { values: { name: 'Acme' } } } }),
    ).data.id.record_id;
    const entry = expectError(
      'createEntry',
      await f.call('POST', `/lists/${listId}/entries`, {
        ...as(bobToken),
        body: { data: { parent_record_id: company, parent_object: 'companies', entry_values: {} } },
      }),
      403,
      'unauthorized',
    );
    expect(entry.message).toBe('You do not have the necessary permissions to create entries in this list.');
  });
});
