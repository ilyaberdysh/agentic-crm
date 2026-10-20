// /v2 contract tests (BACKLOG 5.01): POST /v2/objects/records/search over the shared search index — people,
// companies and custom-object hits in Attio's three response shapes, ranking across objects, the empty-query default
// set, limits, request_as (workspace / member by id or email, the member's permissions), scopes and errors. Every
// 200 is validated against Attio's OpenAPI response schema and the generated Zod schema.
import { memberContext, newId } from '@agentic-crm/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, type Harness, signUp, startHarness } from '../support/harness';
import { expectError, expectOk, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;
const ids: Record<string, string> = {};

const search = (body: Record<string, unknown>, token?: string) =>
  f.call('POST', '/objects/records/search', {
    body: { request_as: { type: 'workspace' }, ...body },
    ...(token ? { token } : {}),
  });

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } } });
  f = await v2Fixture(h, 'search');
  const ctx = memberContext(f.workspaceId, f.memberId);
  const create = async (key: string, object: string, values: Record<string, { value: unknown }[]>) => {
    ids[key] = newId();
    await h.domain.records.create(ctx, {
      entityDefinitionId: object,
      entityInstanceId: ids[key] as string,
      values,
    });
  };
  await create('acme', 'companies', {
    name: [{ value: 'Acme' }],
    domains: [{ value: 'acme.co.uk' }, { value: 'app.acme.test' }],
    logo_url: [{ value: 'https://img.example/acme.png' }],
  });
  await create('acmeLabs', 'companies', { name: [{ value: 'Acme Labs' }] });
  await create('ada', 'people', {
    name: [{ value: { firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' } }],
    email_addresses: [{ value: 'ada@acme.co.uk' }],
    phone_numbers: [{ value: '+44 20 7946 0958' }],
  });
  const projects = await h.domain.schema.createObject(ctx, {
    id: newId(),
    apiSlug: 'projects',
    singularNoun: 'Project',
    pluralNoun: 'Projects',
  });
  await h.domain.schema.createAttribute(ctx, {
    id: newId(),
    entityDefinitionId: projects.id,
    title: 'Name',
    type: 'text',
  });
  await create('rocket', projects.id, { name: [{ value: 'Acme Rocket' }] });
});
afterAll(async () => {
  await h?.close();
});

describe('POST /v2/objects/records/search', () => {
  it('returns people, companies and other records in their response shapes, best match first', async () => {
    const body = expectOk(
      'searchRecords',
      await search({ query: 'acme', objects: ['companies', 'people', 'projects'] }),
    );
    expect(body.data[0]).toEqual({
      id: { workspace_id: f.workspaceId, object_id: expect.any(String), record_id: ids.acme },
      record_text: 'Acme',
      record_image: 'https://img.example/acme.png',
      object_slug: 'companies',
      domains: ['acme.co.uk', 'app.acme.test'],
    });
    const bySlug = Object.fromEntries(
      body.data.map((d: { id: { record_id: string }; object_slug: string }) => [d.id.record_id, d]),
    );
    expect(bySlug[ids.acmeLabs as string]).toMatchObject({ object_slug: 'companies', record_text: 'Acme Labs' });
    expect(bySlug[ids.rocket as string]).toEqual({
      id: { workspace_id: f.workspaceId, object_id: expect.any(String), record_id: ids.rocket },
      record_text: 'Acme Rocket',
      record_image: null,
      object_slug: 'projects',
    });
    expect(bySlug[ids.ada as string]).toEqual({
      id: { workspace_id: f.workspaceId, object_id: expect.any(String), record_id: ids.ada },
      record_text: 'Ada Lovelace',
      record_image: null,
      object_slug: 'people',
      email_addresses: ['ada@acme.co.uk'],
      phone_numbers: ['+442079460958'],
    });
    // Exact name first, then the name prefixes, then the email domain word.
    expect(body.data.map((d: { id: { record_id: string } }) => d.id.record_id)).toEqual([
      ids.acme,
      expect.any(String),
      expect.any(String),
      ids.ada,
    ]);
  });

  it('matches emails, phone digits and domains; empty query returns the default set', async () => {
    const email = expectOk('searchRecords', await search({ query: 'ada@acme', objects: ['people'] }));
    expect(email.data.map((d: { id: { record_id: string } }) => d.id.record_id)).toEqual([ids.ada]);
    const phone = expectOk('searchRecords', await search({ query: '020 7946 0958', objects: ['people'] }));
    expect(phone.data.map((d: { id: { record_id: string } }) => d.id.record_id)).toEqual([ids.ada]);
    const domain = expectOk('searchRecords', await search({ query: 'app.acme.test', objects: ['companies'] }));
    expect(domain.data[0].id.record_id).toBe(ids.acme);
    const empty = expectOk('searchRecords', await search({ query: '', objects: ['companies', 'people'], limit: 2 }));
    expect(empty.data).toHaveLength(2);
    const none = expectOk('searchRecords', await search({ query: 'zzqxv', objects: ['companies'] }));
    expect(none.data).toEqual([]);
  });

  it('honours limit and object ids', async () => {
    const companies = await h.domain.schema.getObject(memberContext(f.workspaceId, f.memberId), 'companies');
    const one = expectOk('searchRecords', await search({ query: 'acme', objects: [companies.id], limit: 1 }));
    expect(one.data).toHaveLength(1);
    expect(one.data[0].object_slug).toBe('companies');
    // Body validation answers Attio's generic validation_type (the operation only declares value_not_found).
    const invalid = { deviation: 'searchRecords declares only value_not_found for 400' };
    for (const body of [
      { query: 'acme', objects: ['companies'], limit: 26 },
      { query: 'x'.repeat(257), objects: ['companies'] },
      { query: 'acme', objects: [] },
      { query: 'acme' },
    ]) {
      expectError('searchRecords', await search(body), 400, 'validation_type', invalid);
    }
    const unknown = expectError(
      'searchRecords',
      await search({ query: 'x', objects: ['foobar'] }),
      400,
      'value_not_found',
    );
    expect(unknown.message).toBe('Object with slug/ID "foobar" not found.');
  });

  it('searches as a workspace member (by id or email) with that member’s permissions', async () => {
    const byId = expectOk(
      'searchRecords',
      await search({
        query: 'ada',
        objects: ['people'],
        request_as: { type: 'workspace-member', workspace_member_id: f.memberId },
      }),
    );
    expect(byId.data.map((d: { id: { record_id: string } }) => d.id.record_id)).toEqual([ids.ada]);
    const byEmail = expectOk(
      'searchRecords',
      await search({
        query: 'ada',
        objects: ['people'],
        request_as: { type: 'workspace-member', email_address: f.user.email.toUpperCase() },
      }),
    );
    expect(byEmail.data).toHaveLength(1);
    const missing = expectError(
      'searchRecords',
      await search({
        query: 'ada',
        objects: ['people'],
        request_as: { type: 'workspace-member', email_address: 'nobody@example.com' },
      }),
      400,
      'value_not_found',
    );
    expect(missing.message).toBe('The workspace member given in request_as was not found.');

    // A suspended member can read nothing.
    const other = await signUp(h, 'Max Member');
    const otherId = await addMember(h, f.workspaceId, { memberId: f.memberId }, other);
    await h.domain.members.updateAccessLevel(memberContext(f.workspaceId, f.memberId), {
      memberId: otherId,
      accessLevel: 'suspended',
    });
    const suspended = expectOk(
      'searchRecords',
      await search({
        query: 'ada',
        objects: ['people'],
        request_as: { type: 'workspace-member', workspace_member_id: otherId },
      }),
    );
    expect(suspended.data).toEqual([]);
  });

  it('requires record and object read scopes', async () => {
    const token = await f.mint(['record_permission:read']);
    const denied = expectError(
      'searchRecords',
      await search({ query: 'acme', objects: ['companies'] }, token),
      403,
      'unauthorized',
      {
        deviation: '403 is not declared for this operation',
      },
    );
    expect(denied.message).toContain('object_configuration:read');
    const ok = await f.mint(['record_permission:read', 'object_configuration:read']);
    expectOk('searchRecords', await search({ query: 'acme', objects: ['companies'] }, ok));
  });
});
