import {
  executeTaskCreateSchema,
  memberContext,
  runnerTokenWorkspace,
  type ServiceContext,
  systemContext,
} from '@agentic-crm/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import { envelope, UNAUTHENTICATED_MESSAGE } from '../errors';
import { WORKSPACE_SLUG_HEADER } from '../trpc/trpc';
import type { WorkspaceResolver } from '../workspaces/resolver';
import { taskCreateTool } from './task-tool';

type RunnerFacade = {
  createEnrollment(ctx: ServiceContext): Promise<unknown>;
  enroll(ctx: ServiceContext, input: unknown): Promise<unknown>;
  list(ctx: ServiceContext): Promise<unknown>;
  revoke(ctx: ServiceContext, id: string): Promise<unknown>;
  authenticate(ctx: ServiceContext, bearer: string): Promise<unknown>;
  claim(ctx: ServiceContext, bearer: string, input: unknown): Promise<unknown>;
  heartbeat(ctx: ServiceContext, bearer: string, input: unknown): Promise<unknown>;
  finish(
    ctx: ServiceContext,
    bearer: string,
    kind: 'complete' | 'failTerminal' | 'release',
    input: unknown,
  ): Promise<unknown>;
  recoverExpired(ctx: ServiceContext, bearer: string, input: unknown): Promise<unknown>;
  resumeBlocked(ctx: ServiceContext, bearer: string, input: unknown): Promise<unknown>;
  executeTool(ctx: ServiceContext, bearer: string, grant: string, input: unknown): Promise<unknown>;
};

type Deps = { auth: Auth; workspaces: WorkspaceResolver; runners: RunnerFacade };
const MCP_VERSION = '2026-07-28';
const mcpMeta = { 'io.modelcontextprotocol/serverInfo': { name: 'agentic-crm', version: '0.0.0' } };

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  const match = typeof value === 'string' ? /^Bearer (acrm_run\.[A-Za-z0-9._-]+)$/.exec(value) : null;
  return match?.[1] ?? null;
}

function runnerContext(request: FastifyRequest, reply: FastifyReply): { ctx: ServiceContext; bearer: string } | null {
  const token = bearer(request);
  const workspaceId = token ? runnerTokenWorkspace(token, 'run') : null;
  if (!workspaceId) {
    reply.header('www-authenticate', 'Bearer');
    reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    return null;
  }
  return { ctx: systemContext(workspaceId, 'agentic-runner-transport'), bearer: token! };
}

async function adminContext(request: FastifyRequest, reply: FastifyReply, deps: Deps) {
  const session = await getRequestSession(deps.auth, request.headers, reply);
  if (!session) {
    reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    return null;
  }
  const slug = request.headers[WORKSPACE_SLUG_HEADER];
  if (typeof slug !== 'string' || !slug) {
    reply.status(400).send(envelope(400, `A workspace is required: send the ${WORKSPACE_SLUG_HEADER} header`));
    return null;
  }
  const resolution = await deps.workspaces.resolve(session.user.id, { slug });
  if (resolution.status === 'not-found') {
    reply.status(404).send(envelope(404, 'Workspace not found'));
    return null;
  }
  if (resolution.status === 'not-member') {
    reply.status(403).send(envelope(403, 'You are not a member of this workspace'));
    return null;
  }
  return memberContext(resolution.workspace.id, resolution.membership.id);
}

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
function rpcError(reply: FastifyReply, id: unknown, status: number, code: number, message: string, data?: unknown) {
  return reply.status(status).send({
    jsonrpc: '2.0',
    id: typeof id === 'string' || typeof id === 'number' ? id : null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

/** One authenticated, stateless Streamable HTTP MCP endpoint; only crm.task.create is exposed. */
export async function registerRunnerRoutes(app: FastifyInstance, deps: Deps) {
  app.post('/api/agentic/runners/enrollments', async (request, reply) => {
    const ctx = await adminContext(request, reply, deps);
    if (!ctx) return;
    return deps.runners.createEnrollment(ctx);
  });
  app.get('/api/agentic/runners', async (request, reply) => {
    const ctx = await adminContext(request, reply, deps);
    if (!ctx) return;
    return deps.runners.list(ctx);
  });
  app.post<{ Params: { id: string } }>('/api/agentic/runners/:id/revoke', async (request, reply) => {
    const ctx = await adminContext(request, reply, deps);
    if (!ctx) return;
    return deps.runners.revoke(ctx, request.params.id);
  });
  app.post('/api/agentic/runners/enroll', async (request, reply) => {
    const token = (request.body as { token?: unknown } | null)?.token;
    const workspaceId = typeof token === 'string' ? runnerTokenWorkspace(token, 'enr') : null;
    if (!workspaceId) return reply.status(401).send(envelope(401, 'Invalid enrollment token'));
    return deps.runners.enroll(systemContext(workspaceId, 'agentic-runner-enrollment'), request.body);
  });
  app.post('/api/agentic/runners/claim', async (request, reply) => {
    const auth = runnerContext(request, reply);
    if (!auth) return;
    return deps.runners.claim(auth.ctx, auth.bearer, request.body);
  });
  app.post('/api/agentic/runners/heartbeat', async (request, reply) => {
    const auth = runnerContext(request, reply);
    if (!auth) return;
    return deps.runners.heartbeat(auth.ctx, auth.bearer, request.body);
  });
  for (const [path, kind] of [
    ['complete', 'complete'],
    ['fail', 'failTerminal'],
    ['release', 'release'],
  ] as const) {
    app.post(`/api/agentic/runners/${path}`, async (request, reply) => {
      const auth = runnerContext(request, reply);
      if (!auth) return;
      return deps.runners.finish(auth.ctx, auth.bearer, kind, request.body);
    });
  }
  app.post('/api/agentic/runners/recover', async (request, reply) => {
    const auth = runnerContext(request, reply);
    if (!auth) return;
    return deps.runners.recoverExpired(auth.ctx, auth.bearer, request.body);
  });
  app.post('/api/agentic/runners/resume', async (request, reply) => {
    const auth = runnerContext(request, reply);
    if (!auth) return;
    return deps.runners.resumeBlocked(auth.ctx, auth.bearer, request.body);
  });

  app.post('/api/agentic/mcp', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const auth = runnerContext(request, reply);
    if (!auth) return;
    const body = request.body as Rpc | null;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      body.jsonrpc !== '2.0' ||
      (typeof body.id !== 'string' && typeof body.id !== 'number') ||
      typeof body.method !== 'string'
    )
      return rpcError(reply, body?.id, 400, -32600, 'Invalid Request');
    const params = body.params;
    if (!params || typeof params !== 'object' || Array.isArray(params))
      return rpcError(reply, body.id, 400, -32602, 'Invalid params');
    const fields = params as Record<string, unknown>;
    const meta = fields._meta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta))
      return rpcError(reply, body.id, 400, -32602, 'Missing MCP request metadata');
    const metadata = meta as Record<string, unknown>;
    const version = metadata['io.modelcontextprotocol/protocolVersion'];
    if (version !== MCP_VERSION)
      return rpcError(reply, body.id, 400, -32022, 'Unsupported protocol version', { supported: [MCP_VERSION] });
    if (
      !metadata['io.modelcontextprotocol/clientCapabilities'] ||
      typeof metadata['io.modelcontextprotocol/clientCapabilities'] !== 'object'
    )
      return rpcError(reply, body.id, 400, -32602, 'Missing client capabilities');
    if (
      request.headers['mcp-protocol-version'] !== version ||
      request.headers['mcp-method'] !== body.method ||
      (body.method === 'tools/call' && request.headers['mcp-name'] !== fields.name)
    )
      return rpcError(reply, body.id, 400, -32020, 'MCP header mismatch');
    if (!request.headers.accept?.includes('application/json') || !request.headers.accept?.includes('text/event-stream'))
      return rpcError(reply, body.id, 400, -32600, 'Accept must include application/json and text/event-stream');

    // Bearer validation also applies to discovery/listing, so anonymous clients never learn workspace tooling.
    await deps.runners.authenticate(auth.ctx, auth.bearer);
    const respond = (result: Record<string, unknown>) =>
      reply.send({ jsonrpc: '2.0', id: body.id, result: { ...result, _meta: mcpMeta } });
    if (body.method === 'server/discover')
      return respond({
        resultType: 'complete',
        supportedVersions: [MCP_VERSION],
        capabilities: { tools: { listChanged: false } },
      });
    if (body.method === 'tools/list')
      return respond({ resultType: 'complete', tools: [taskCreateTool], cacheScope: 'private', ttlMs: 60_000 });
    if (body.method !== 'tools/call') return rpcError(reply, body.id, 404, -32601, 'Method not found');
    if (fields.name !== taskCreateTool.name) return rpcError(reply, body.id, 404, -32601, 'Tool not found');
    const grant = request.headers['x-agentic-task-grant'];
    if (typeof grant !== 'string') return rpcError(reply, body.id, 401, -32001, 'Task grant required');
    const parsed = executeTaskCreateSchema.safeParse(fields.arguments);
    if (!parsed.success) return rpcError(reply, body.id, 400, -32602, 'Invalid tool arguments');
    try {
      const result = await deps.runners.executeTool(auth.ctx, auth.bearer, grant, parsed.data);
      const structuredContent =
        result && typeof result === 'object' && !Array.isArray(result)
          ? { ...result, seq: 'seq' in result ? result.seq : null }
          : result;
      return respond({
        resultType: 'complete',
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError: false,
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode < 500
      )
        return respond({
          resultType: 'complete',
          content: [{ type: 'text', text: 'Task capability denied or stale.' }],
          isError: true,
        });
      throw error;
    }
  });
}
