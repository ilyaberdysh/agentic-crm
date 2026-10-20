// /v2 contract tests: authentication, scopes, rate limits, GET /v2/self and workspace members.
import { getSelfResponse, PUBLIC_API_ISSUER } from '@agentic-crm/contracts/v2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseScopes } from '../../src/cli/token-create';
import { type Harness, startHarness } from '../support/harness';
import { expectError, expectOk, operationResponse, type V2Fixture, v2Fixture } from './support';

let h: Harness;
let f: V2Fixture;

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 1000, writesPerSecond: 1000 } } });
  f = await v2Fixture(h, 'auth');
});
afterAll(async () => {
  await h?.close();
});

describe('authentication', () => {
  it('401 without a token, in the public API error shape', async () => {
    const response = await f.call('GET', '/objects', { token: null });
    expectError('listObjects', response, 401, 'unauthorized');
    expect(response.body.type).toBe('auth_error');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('401 for an unknown or malformed token', async () => {
    expectError('listObjects', await f.call('GET', '/objects', { token: 'not-a-token' }), 401, 'unauthorized');
    const basicGarbage = await f.call('GET', '/objects', { token: null, headers: { authorization: 'Digest abc' } });
    expectError('listObjects', basicGarbage, 401, 'unauthorized');
  });

  it('accepts HTTP Basic with the token as username and an empty password', async () => {
    const basic = Buffer.from(`${f.token}:`).toString('base64');
    const response = await f.call('GET', '/objects', { token: null, headers: { authorization: `Basic ${basic}` } });
    expectOk('listObjects', response);
  });

  it('403 when the token lacks a required scope; read-write includes read', async () => {
    const configOnly = await f.mint(['object_configuration:read']);
    const response = await f.call('POST', '/objects/people/records/query', { token: configOnly, body: {} });
    const error = expectError('queryRecords', response, 403, 'unauthorized');
    expect(response.body.type).toBe('auth_error');
    expect(error.message).toContain('record_permission:read');

    const readWrite = await f.mint(['object_configuration:read-write', 'record_permission:read-write']);
    expectOk('queryRecords', await f.call('POST', '/objects/people/records/query', { token: readWrite, body: {} }));
    // Writes need :read-write.
    const readOnly = await f.mint(['object_configuration:read', 'record_permission:read']);
    const write = await f.call('POST', '/objects/people/records', {
      token: readOnly,
      body: { data: { values: { name: 'Nope' } } },
    });
    expectError('createRecord', write, 403, 'unauthorized');
  });

  it('attribute endpoints need object_configuration for objects and list_configuration for lists', async () => {
    const records = await f.mint(['record_permission:read-write']);
    expectError(
      'listAttributes',
      await f.call('GET', '/objects/people/attributes', { token: records }),
      403,
      'unauthorized',
    );
    const lists = await f.mint(['list_configuration:read']);
    expectError('listAttributes', await f.call('GET', '/lists/sales/attributes', { token: lists }), 404, 'not_found');
    expectError(
      'listAttributes',
      await f.call('GET', '/lists/sales/attributes', { token: records }),
      403,
      'unauthorized',
    );
  });

  it('unknown /v2 routes answer 404 in the public API shape', async () => {
    const response = await f.call('GET', '/nope');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ status_code: 404, type: 'invalid_request_error', code: 'not_found' });
  });

  it('malformed JSON is a 400 validation_type', async () => {
    const response = await fetch(`${h.baseUrl}/v2/objects`, {
      method: 'POST',
      headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json' },
      body: '{"data":',
    });
    const body = await response.json();
    expectError('createObject', { status: response.status, headers: response.headers, body }, 400, 'validation_type');
  });
});

describe('rate limits', () => {
  it('429 rate_limit_exceeded with a Retry-After date once the per-second budget is spent', async () => {
    const limited = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 2, writesPerSecond: 1 } } });
    try {
      const g = await v2Fixture(limited, 'rate');
      // Align to the start of a second so the three calls share one window.
      await new Promise((r) => setTimeout(r, 1000 - (Date.now() % 1000)));
      const results = [];
      for (let i = 0; i < 3; i++) results.push(await g.call('GET', '/objects'));
      const last = results[2] as Awaited<ReturnType<typeof g.call>>;
      expect(last.status).toBe(429);
      expect(last.body).toEqual({
        status_code: 429,
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        message: expect.any(String),
      });
      const retryAfter = last.headers.get('retry-after');
      expect(retryAfter && Number.isFinite(Date.parse(retryAfter))).toBe(true);
    } finally {
      await limited.close();
    }
  });
});

describe('GET /v2/self', () => {
  it('describes an active workspace token (RFC 7662)', async () => {
    const body = expectOk('getSelf', await f.call('GET', '/self'));
    expect(body).toMatchObject({
      active: true,
      client_id: f.tokenId,
      aud: f.tokenId,
      token_type: 'Bearer',
      exp: null,
      sub: f.workspaceId,
      iss: PUBLIC_API_ISSUER,
      token_level: 'workspace',
      authorized_by_workspace_member_id: f.memberId,
      workspace_id: f.workspaceId,
      workspace_slug: f.slug,
      workspace_logo_url: null,
    });
    expect(body.scope.split(' ')).toContain('record_permission:read-write');
    expect(typeof body.iat).toBe('number');
  });

  it('returns {active: false} for unknown and revoked tokens', async () => {
    expect(expectOk('getSelf', await f.call('GET', '/self', { token: 'unknown' }))).toEqual({ active: false });
    const token = await f.mint(['note:read'], 'to revoke');
    const self = expectOk('getSelf', await f.call('GET', '/self', { token }));
    await h.domain.apiTokens.revoke(
      { workspaceId: f.workspaceId, actor: { type: 'system', id: null } },
      self.client_id,
    );
    expect(expectOk('getSelf', await f.call('GET', '/self', { token }))).toEqual({ active: false });
    expectError('listObjects', await f.call('GET', '/objects', { token }), 401, 'unauthorized');
  });

  it('the documented examples match the generated schema', () => {
    const examples = operationResponse('getSelf', 200)?.content?.['application/json']?.examples ?? {};
    expect(Object.keys(examples).length).toBeGreaterThanOrEqual(2);
    for (const example of Object.values(examples)) expect(getSelfResponse.safeParse(example.value).success).toBe(true);
  });
});

describe('workspace members', () => {
  it('lists and gets members', async () => {
    const list = expectOk('listWorkspaceMembers', await f.call('GET', '/workspace_members'));
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      id: { workspace_id: f.workspaceId, workspace_member_id: f.memberId },
      first_name: 'Ada',
      last_name: 'Lovelace',
      email_address: f.user.email,
      access_level: 'admin',
    });
    const one = expectOk('getWorkspaceMember', await f.call('GET', `/workspace_members/${f.memberId}`));
    expect(one.data.id.workspace_member_id).toBe(f.memberId);
  });

  it('404 for an unknown member with the documented message', async () => {
    const id = '50cf242c-7fa3-4cad-87d0-75b1af71c57b';
    const error = expectError('getWorkspaceMember', await f.call('GET', `/workspace_members/${id}`), 404, 'not_found');
    expect(error.message).toBe(`Workspace member with ID "${id}" not found.`);
  });

  it('needs user_management:read', async () => {
    const token = await f.mint(['record_permission:read']);
    expectError('listWorkspaceMembers', await f.call('GET', '/workspace_members', { token }), 403, 'unauthorized');
  });
});

describe('token:create CLI', () => {
  it('parses scope arguments', () => {
    expect(parseScopes(['record_permission:read-write,object_configuration:read', 'note:read'])).toEqual([
      'record_permission:read-write',
      'object_configuration:read',
      'note:read',
    ]);
    expect(parseScopes(['all'])).toHaveLength(18);
    expect(() => parseScopes(['records:read'])).toThrow(/Unknown scope/);
    expect(() => parseScopes([])).toThrow(/At least one scope/);
  });
});

describe('contract validators', () => {
  it('reject bodies that do not match the spec', () => {
    const headers = new Headers();
    expect(() => expectOk('getObject', { status: 200, headers, body: { data: { id: {} } } })).toThrow(/OpenAPI schema/);
    const record = {
      data: {
        id: { workspace_id: f.workspaceId, object_id: f.workspaceId, record_id: f.workspaceId },
        created_at: '2026-01-01T00:00:00.000000000Z',
        web_url: 'http://localhost/x',
        values: { name: [{ value: 'x', attribute_type: 'text' }] },
      },
    };
    // Value responses must include their active interval and actor envelope.
    expect(() => expectOk('getRecord', { status: 200, headers, body: record })).toThrow(/OpenAPI schema/);
    expect(() =>
      expectError(
        'getObject',
        { status: 404, headers, body: { status_code: 404, code: 'not_found' } },
        404,
        'not_found',
      ),
    ).toThrow(/error shape/);
    const emptyCode = { status_code: 404, type: 'invalid_request_error', code: '', message: 'x' };
    expect(() => expectError('getObject', { status: 404, headers, body: emptyCode }, 404, '')).toThrow(/error shape/);
    // Documented error codes share the same envelope across operations.
    const lookup = { status_code: 404, type: 'invalid_request_error', code: 'value_not_found', message: 'x' };
    expect(expectError('getObject', { status: 404, headers, body: lookup }, 404, 'value_not_found')).toEqual(lookup);
    const internal = {
      status_code: 500,
      type: 'api_error',
      code: 'internal_error',
      message: 'An unexpected error occurred.',
    };
    expect(expectError('getObject', { status: 500, headers, body: internal }, 500, 'internal_error')).toEqual(internal);
  });
});
