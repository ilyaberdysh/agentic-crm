import { chmod, lstat, mkdtemp, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configSchema, enroll, type RunnerIdentity, readIdentity } from '../src/config.ts';
import { RunnerDaemon } from '../src/daemon.ts';
import { createMcpRelay } from '../src/mcp-relay.ts';
import { apiOrigin, boundedJson, localEndpoint, RunnerApi, RunnerError } from '../src/transport.ts';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const workspaceId = uid(1);
const identity: RunnerIdentity = {
  id: uid(2),
  workspaceId,
  bearerToken: `acrm_run.${workspaceId}.${uid(2)}.${'s'.repeat(43)}`,
  apiOrigin: 'http://127.0.0.1',
};
const descriptor = {
  id: uid(4),
  receiptId: uid(5),
  actionId: uid(6),
  proposalDigest: 'a'.repeat(64),
  expectedVersion: 2,
};
const grant = `acrm_grant.${workspaceId}.${uid(7)}.${'g'.repeat(43)}`;
const fencingToken = '9007199254740993';
const task = () => ({
  id: uid(3),
  workspaceId,
  taskType: 'record.follow_up',
  moduleId: 'record-follow-up',
  actionId: descriptor.actionId,
  status: 'LEASED',
  leaseHolder: `runner:${identity.id}`,
  leaseGeneration: fencingToken,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  reason: 'Task context',
  nextEvent: 'Execute approved action',
});
const receipt = {
  id: descriptor.receiptId,
  actionId: descriptor.actionId,
  attemptId: descriptor.id,
  proposalDigest: descriptor.proposalDigest,
  outcome: { outcome: 'SUCCEEDED', result: { taskId: uid(8) } },
};
const modelClaim = () => ({
  invocationId: uid(10),
  leaseGeneration: fencingToken,
  model: 'local-model',
  endpoint: 'http://127.0.0.1:1234/v1',
  provider: 'openai-compatible',
  features: { text: true, clientTools: false, structuredOutput: 'none', streaming: false },
  request: { purpose: 'test', messages: [{ role: 'user', content: 'private prompt' }] },
});
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function server(
  handler: (request: IncomingMessage, response: ServerResponse, body: any) => void | Promise<void>,
) {
  const app = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      await handler(request, response, chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        app.closeAllConnections();
        app.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${address.port}`;
}
function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
async function rpc(socketPath: string, method: string, params: Record<string, unknown> = {}, id = 1): Promise<any> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath,
        path: '/mcp',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer attacker',
          'x-agentic-task-grant': 'attacker',
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.end(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}
async function rootDirectory() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'crm-runner-test-')));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function config(api: string) {
  return configSchema.parse({ apiOrigin: api, stateDirectory: '/tmp/private-runner-state', name: 'test' });
}

describe('standalone paired runner', () => {
  it('pairs once, persists a bound private bearer, and refuses overwrite or unsafe identity permissions', async () => {
    const stateDirectory = await rootDirectory();
    const api = await server((request, response, body) => {
      expect(request.headers.authorization).toBeUndefined();
      expect(body.token).toBe('one-time-enrollment');
      expect(body.authProfiles).toEqual([]);
      json(response, { id: body.id, workspaceId, bearerToken: `acrm_run.${workspaceId}.${body.id}.${'s'.repeat(43)}` });
    });
    const settings = { ...config(api), stateDirectory };
    const paired = await enroll(settings, 'one-time-enrollment');
    expect(await readIdentity(settings)).toEqual(paired);
    expect((await lstat(join(stateDirectory, 'identity.json'))).mode & 0o777).toBe(0o600);
    await expect(enroll(settings, 'another-token')).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(readIdentity({ ...settings, apiOrigin: 'https://other.example' })).rejects.toMatchObject({
      code: 'identity_binding_mismatch',
    });
    await chmod(join(stateDirectory, 'identity.json'), 0o644);
    await expect(readIdentity(settings)).rejects.toMatchObject({ code: 'unsafe_identity_file' });
    await expect(readFile(join(stateDirectory, 'identity.json'), 'utf8')).resolves.toContain(paired.bearerToken);
  });

  it('rejects a symlinked state directory before enrollment', async () => {
    const root = await rootDirectory();
    const alias = join(root, 'alias');
    const target = join(root, 'target');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(target, { mode: 0o700 }));
    await symlink(target, alias);
    await expect(enroll({ ...config('https://crm.example'), stateDirectory: alias }, 'token')).rejects.toMatchObject({
      code: 'unsafe_state_directory',
    });
  });

  it('runs a claimed task through a real Unix MCP relay and retries a lost response with the identical receipt', async () => {
    const seen: { path: string; body: any }[] = [];
    let attempts = 0;
    const api = await server((request, response, body) => {
      seen.push({ path: request.url!, body });
      expect(request.headers.authorization).toBe(`Bearer ${identity.bearerToken}`);
      if (request.url?.endsWith('/recover')) return json(response, []);
      if (request.url?.endsWith('/claim'))
        return json(response, [{ task: task(), execution: descriptor, grantToken: grant }]);
      if (request.url?.endsWith('/heartbeat')) return json(response, task());
      expect(request.url).toBe('/api/agentic/mcp');
      expect(request.headers['mcp-protocol-version']).toBe('2026-07-28');
      expect(body.params._meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
      if (body.method === 'tools/list')
        return json(response, {
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: [{ name: 'crm.task.create', inputSchema: {} }] },
        });
      expect(request.headers['x-agentic-task-grant']).toBe(grant);
      expect(body.params.arguments).toEqual(descriptor);
      attempts++;
      if (attempts === 1) {
        request.socket.destroy();
        return;
      }
      json(response, { jsonrpc: '2.0', id: body.id, result: { isError: false, structuredContent: { receipt } } });
    });
    let socketPath = '';
    const daemon = new RunnerDaemon(config(api), identity, {
      sandbox: {
        async execute(request) {
          expect(request.dataClass).toBe('crm');
          if (request.dataClass !== 'crm') throw new Error('Missing scope');
          socketPath = request.relay.socketPath;
          expect(request.scope.leaseGeneration).toBe(fencingToken);
          expect(request.prompt).not.toContain(identity.bearerToken);
          expect(request.prompt).not.toContain(grant);
          expect((await lstat(socketPath)).mode & 0o777).toBe(0o600);
          expect((await rpc(socketPath, 'initialize', { protocolVersion: '2025-11-25' })).result.protocolVersion).toBe(
            '2025-11-25',
          );
          expect((await rpc(socketPath, 'tools/list')).result.tools).toHaveLength(1);
          expect(
            (
              await rpc(socketPath, 'tools/call', {
                name: 'crm.task.create',
                arguments: { ...descriptor, actor: 'attacker' },
              })
            ).error,
          ).toBeDefined();
          expect(
            (
              await rpc(socketPath, 'tools/call', {
                name: 'crm.task.create',
                arguments: { ...descriptor, receiptId: uid(99) },
              })
            ).error,
          ).toBeDefined();
          expect(
            (await rpc(socketPath, 'tools/call', { name: 'crm.task.create', arguments: descriptor })).result
              .structuredContent.receipt,
          ).toEqual(receipt);
          return { text: 'done' };
        },
      },
    });
    await daemon.runOnce(new AbortController().signal);
    expect(attempts).toBe(2);
    expect(
      seen.filter(
        (call) => call.path.endsWith('/complete') || call.path.endsWith('/release') || call.path.endsWith('/fail'),
      ),
    ).toEqual([]);
    expect(seen.find((call) => call.path.endsWith('/heartbeat'))?.body).toEqual({
      taskId: uid(3),
      generation: fencingToken,
    });
    await expect(lstat(socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('aborts the sandbox on lease loss and never publishes completion or failure for the stale generation', async () => {
    const paths: string[] = [];
    let beats = 0;
    let aborted = false;
    const api = await server((request, response) => {
      paths.push(request.url!);
      if (request.url?.endsWith('/recover')) return json(response, []);
      if (request.url?.endsWith('/claim'))
        return json(response, [{ task: { ...task(), actionId: null }, execution: null, grantToken: null }]);
      beats++;
      json(response, beats === 1 ? { ...task(), actionId: null } : { error: 'stale' }, beats === 1 ? 200 : 409);
    });
    const daemon = new RunnerDaemon(config(api), identity, {
      heartbeatMs: 10,
      sandbox: {
        async execute(request) {
          await new Promise<void>((resolve) =>
            request.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            ),
          );
          throw new Error('canceled');
        },
      },
    });
    await daemon.runOnce(new AbortController().signal);
    expect(aborted).toBe(true);
    expect(paths.some((path) => /\/(complete|fail|release)$/.test(path))).toBe(false);
  });

  it('latches a container cleanup failure and accepts no further work', async () => {
    let claims = 0;
    const api = await server((request, response) => {
      if (request.url?.endsWith('/recover')) return json(response, []);
      if (request.url?.endsWith('/claim')) {
        claims++;
        return json(response, [{ task: task(), execution: descriptor, grantToken: grant }]);
      }
      json(response, task());
    });
    const daemon = new RunnerDaemon(config(api), identity, {
      sandbox: {
        async execute() {
          throw new RunnerError('sandbox_cleanup_failed');
        },
      },
    });
    await expect(daemon.runOnce(new AbortController().signal)).rejects.toMatchObject({
      code: 'sandbox_cleanup_failed',
    });
    await expect(daemon.runOnce(new AbortController().signal)).rejects.toMatchObject({ code: 'runner_stopped' });
    expect(claims).toBe(1);
  });

  it('completes an effect-free task and releases a linked action when the CLI made no capability call', async () => {
    for (const linked of [false, true]) {
      const paths: string[] = [];
      const api = await server((request, response) => {
        paths.push(request.url!);
        if (request.url?.endsWith('/recover')) return json(response, []);
        if (request.url?.endsWith('/claim'))
          return json(response, [
            {
              task: { ...task(), actionId: linked ? descriptor.actionId : null },
              execution: linked ? descriptor : null,
              grantToken: linked ? grant : null,
            },
          ]);
        json(response, { ...task(), actionId: linked ? descriptor.actionId : null });
      });
      await new RunnerDaemon(config(api), identity, {
        sandbox: {
          async execute() {
            return { text: 'No tool calls' };
          },
        },
      }).runOnce(new AbortController().signal);
      expect(paths.at(-1)).toBe(`/api/agentic/runners/${linked ? 'release' : 'complete'}`);
    }
  });

  it('dispatches only to an operator-enabled numeric loopback endpoint and preserves unknown usage', async () => {
    let completion: any;
    let called = false;
    const local = await server((request, response, body) => {
      called = true;
      expect(request.url).toBe('/v1/chat/completions');
      expect(request.headers.authorization).toBeUndefined();
      expect(body.messages).toEqual(modelClaim().request.messages);
      json(response, {
        id: 'local-result',
        choices: [{ message: { content: 'local answer' }, finish_reason: 'stop' }],
      });
    });
    const api = await server((request, response, body) => {
      if (request.url?.endsWith('/claim')) return json(response, [{ ...modelClaim(), endpoint: `${local}/v1` }]);
      if (request.url?.endsWith('/heartbeat'))
        return json(response, {
          invocationId: uid(10),
          leaseGeneration: fencingToken,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      completion = body;
      json(response, { completed: true });
    });
    await new RunnerDaemon({ ...config(api), localEndpoints: [`${local}/v1`] }, identity).runOnce(
      new AbortController().signal,
    );
    expect(called).toBe(true);
    expect(completion).toMatchObject({
      invocationId: uid(10),
      leaseGeneration: fencingToken,
      outcome: 'completed',
      text: 'local answer',
      usage: { inputTokens: null, outputTokens: null, cost: { status: 'unknown' } },
    });
    called = false;
    await new RunnerDaemon({ ...config(api), localEndpoints: ['http://127.0.0.1:1/v1'] }, identity).runOnce(
      new AbortController().signal,
    );
    expect(called).toBe(false);
    expect(completion).toMatchObject({ outcome: 'failed', failureCode: 'unsupported' });
  });

  it('aborts an in-flight local model when the runner is revoked and reports no response', async () => {
    let aborted = false;
    let beats = 0;
    const calls: string[] = [];
    const requestFetch: typeof fetch = async (url, init) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path.endsWith('/claim')) return Response.json([modelClaim()]);
      if (path.endsWith('/heartbeat')) {
        beats++;
        return beats === 1
          ? Response.json({
              invocationId: uid(10),
              leaseGeneration: fencingToken,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            })
          : Response.json({}, { status: 403 });
      }
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('canceled'));
          },
          { once: true },
        ),
      );
    };
    const daemon = new RunnerDaemon(
      { ...config('https://crm.example'), localEndpoints: [modelClaim().endpoint] },
      identity,
      { fetch: requestFetch, heartbeatMs: 10 },
    );
    await expect(daemon.runOnce(new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(aborted).toBe(true);
    expect(calls.some((path) => path.endsWith('/complete'))).toBe(false);
  });

  it('bounds transport output, rejects external endpoints, and refuses redirecting bearer requests', async () => {
    expect(() => apiOrigin('http://crm.example')).toThrow();
    expect(() => apiOrigin('https://crm.example/api')).toThrow();
    expect(() => localEndpoint('http://192.168.1.1/v1')).toThrow();
    expect(() => localEndpoint('http://127.0.0.1/v1?redirect=1')).toThrow();
    expect(localEndpoint('http://localhost:1234/v1')).toBe('http://127.0.0.1:1234/v1');
    await expect(boundedJson(new Response('"too much"'), 2)).rejects.toMatchObject({ code: 'response_limit' });
    const api = await server((_request, response) => {
      response.writeHead(302, { location: 'https://elsewhere.example' }).end();
    });
    await expect(new RunnerApi(api, identity.bearerToken).post('/api/agentic/runners/claim', {})).rejects.toMatchObject(
      { code: 'api_unavailable' },
    );
  });

  it('revokes the Unix capability socket immediately when the owning task is canceled', async () => {
    const controller = new AbortController();
    const relay = await createMcpRelay({
      api: new RunnerApi('https://crm.example'),
      execution: descriptor,
      grantToken: grant,
      signal: controller.signal,
      isActive: () => true,
    });
    controller.abort();
    await relay.close();
    await expect(rpc(relay.socketPath, 'tools/list')).rejects.toBeDefined();
    await expect(lstat(relay.socketPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
