import { newId } from '@agentic-crm/domain';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerRunnerRoutes } from '../src/agentic/runner-routes';

const workspaceId = newId();
const runnerId = newId();
const memberId = newId();
const enrollmentId = newId();
const bearer = `acrm_run.${workspaceId}.${runnerId}.${'A'.repeat(43)}`;
const enrollmentToken = `acrm_enr.${workspaceId}.${enrollmentId}.${'E'.repeat(43)}`;
const grant = `acrm_grant.${workspaceId}.${newId()}.${'B'.repeat(43)}`;
const actionId = newId();
const input = { id: newId(), receiptId: newId(), actionId, proposalDigest: 'a'.repeat(64), expectedVersion: 2 };
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};

const authenticate = vi.fn(async () => ({ id: runnerId }));
const executeTool = vi.fn(async () => ({
  capability: 'crm.task.create',
  action: { id: actionId, status: 'SUCCEEDED' },
}));
const runners = {
  createEnrollment: vi.fn(async () => ({ id: enrollmentId, token: enrollmentToken })),
  enroll: vi.fn(async () => ({ id: runnerId, bearerToken: bearer })),
  list: vi.fn(async () => []),
  revoke: vi.fn(async () => ({})),
  authenticate,
  claim: vi.fn(async () => []),
  heartbeat: vi.fn(async () => ({})),
  finish: vi.fn(async () => ({})),
  recoverExpired: vi.fn(async () => []),
  resumeBlocked: vi.fn(async () => ({})),
  executeTool,
};
const app = Fastify();
const auth = {
  api: {
    getSession: vi.fn(async () => ({
      headers: new Headers(),
      response: { user: { id: 'user-1' } },
    })),
  },
};
const workspaces = {
  listForUser: vi.fn(async () => []),
  resolve: vi.fn(async () => ({
    status: 'ok' as const,
    workspace: { id: workspaceId, slug: 'acme', name: 'Acme', logoUrl: null },
    membership: { id: memberId, workspaceId, userId: 'user-1', accessLevel: 'admin' as const },
  })),
};

function call(method: string, params: Record<string, unknown>, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/agentic/mcp',
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...headers,
    },
    payload: { jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta } },
  });
}

beforeAll(async () => {
  await registerRunnerRoutes(app, { auth: auth as never, workspaces, runners });
  await app.ready();
});
afterAll(async () => app.close());

describe('paired runner lifecycle transport', () => {
  it('forwards enrollment, claim, heartbeat, and finish under the resolved workspace and bearer', async () => {
    const adminHeaders = { cookie: 'session=valid', 'x-workspace-slug': 'acme' };
    const created = await app.inject({
      method: 'POST',
      url: '/api/agentic/runners/enrollments',
      headers: adminHeaders,
    });
    expect(created.statusCode).toBe(200);
    expect(runners.createEnrollment).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, actor: { type: 'workspace-member', id: memberId } }),
    );
    expect(workspaces.resolve).toHaveBeenCalledWith('user-1', { slug: 'acme' });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/agentic/runners/enroll',
      payload: { token: enrollmentToken, id: runnerId, name: 'Local runner' },
    });
    expect(enrolled.statusCode).toBe(200);
    expect(runners.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, actor: { type: 'system', id: 'agentic-runner-enrollment' } }),
      expect.objectContaining({ token: enrollmentToken, id: runnerId, name: 'Local runner' }),
    );

    const lease = { taskId: newId(), generation: '1' };
    const claim = await app.inject({
      method: 'POST',
      url: '/api/agentic/runners/claim',
      headers: { authorization: `Bearer ${bearer}` },
      payload: { limit: 1, leaseDurationMs: 60_000 },
    });
    expect(claim.statusCode).toBe(200);
    expect(runners.claim).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId, actor: { type: 'system', id: 'agentic-runner-transport' } }),
      bearer,
      { limit: 1, leaseDurationMs: 60_000 },
    );

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/agentic/runners/heartbeat',
      headers: { authorization: `Bearer ${bearer}` },
      payload: lease,
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(runners.heartbeat).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), bearer, lease);

    const finish = { ...lease, reason: 'Done.', nextEvent: 'Nothing remains.' };
    const completed = await app.inject({
      method: 'POST',
      url: '/api/agentic/runners/complete',
      headers: { authorization: `Bearer ${bearer}` },
      payload: finish,
    });
    expect(completed.statusCode).toBe(200);
    expect(runners.finish).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), bearer, 'complete', finish);
  });
});

describe('authenticated MCP transport', () => {
  it('discovers exactly the curated tool after bearer authentication', async () => {
    const response = await call('server/discover', {});
    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: { listChanged: false } },
    });
    const listed = await call('tools/list', {});
    expect(listed.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual(['crm.task.create']);
    expect(authenticate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), bearer);
  });

  it('derives workspace from bearer and grant from header, rejecting authority fields in model arguments', async () => {
    const headers = { 'mcp-name': 'crm.task.create', 'x-agentic-task-grant': grant };
    const valid = await call('tools/call', { name: 'crm.task.create', arguments: input }, headers);
    expect(valid.statusCode).toBe(200);
    expect(valid.json().result.structuredContent.action.status).toBe('SUCCEEDED');
    expect(executeTool).toHaveBeenCalledWith(expect.objectContaining({ workspaceId }), bearer, grant, input);
    executeTool.mockClear();
    const injected = await call(
      'tools/call',
      {
        name: 'crm.task.create',
        arguments: {
          ...input,
          actor: { type: 'workspace-member', id: newId() },
        },
      },
      headers,
    );
    expect(injected.statusCode).toBe(400);
    expect(injected.json().error.code).toBe(-32602);
    expect(executeTool).not.toHaveBeenCalled();
    const noGrant = await call(
      'tools/call',
      { name: 'crm.task.create', arguments: input },
      { 'mcp-name': 'crm.task.create' },
    );
    expect(noGrant.statusCode).toBe(401);
  });

  it('rejects untrusted routing headers and unauthenticated callers before tool dispatch', async () => {
    const mismatch = await call('tools/call', { name: 'crm.task.create', arguments: input }, { 'mcp-name': 'other' });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe(-32020);
    const anonymous = await app.inject({
      method: 'POST',
      url: '/api/agentic/mcp',
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: meta },
      },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
