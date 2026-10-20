import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { RunnerApi, RunnerError } from './transport.ts';

export const executionSchema = z.strictObject({
  id: z.uuid(),
  receiptId: z.uuid(),
  actionId: z.uuid(),
  proposalDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersion: z.number().int().positive(),
});
export type ExecutionDescriptor = z.infer<typeof executionSchema>;
const remoteVersion = '2026-07-28';
const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().max(200), z.number().finite()]).optional(),
  method: z.string().max(100),
  params: z.record(z.string(), z.unknown()).optional(),
});

async function requestJson(request: IncomingMessage) {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65_536) throw new RunnerError('request_limit');
    chunks.push(chunk);
  }
  return rpcSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
}

/** A fresh owner-only socket per lease. No inbound headers, credentials, scope or replacement action crosses it. */
export async function createMcpRelay(options: {
  api: RunnerApi;
  execution: ExecutionDescriptor | null;
  grantToken: string | null;
  signal: AbortSignal;
  isActive(): boolean;
}) {
  if (Boolean(options.execution) !== Boolean(options.grantToken)) throw new RunnerError('invalid_task_grant');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'crm-mcp-')));
  const socketPath = join(directory, 'mcp.sock');
  const sockets = new Set<Socket>();
  let closed = false;
  let closing: Promise<void> | undefined;
  let calls = 0;
  let inFlight = 0;
  let attempted = false;
  let settled = false;
  const active = () => !closed && !options.signal.aborted && options.isActive();
  const remote = async (method: string, params: Record<string, unknown>, id: string | number) => {
    const response = await options.api.post(
      '/api/agentic/mcp',
      {
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': remoteVersion,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      options.signal,
      {
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': remoteVersion,
        'mcp-method': method,
        ...(method === 'tools/call'
          ? { 'mcp-name': 'crm.task.create', 'x-agentic-task-grant': options.grantToken! }
          : {}),
      },
    );
    const parsed = z
      .object({
        jsonrpc: z.literal('2.0'),
        id: z.union([z.string(), z.number()]),
        result: z.record(z.string(), z.unknown()).optional(),
        error: z.unknown().optional(),
      })
      .parse(response);
    if (parsed.id !== id || !parsed.result || parsed.error) throw new RunnerError('invalid_mcp_response');
    return parsed.result;
  };
  const dispatch = async (body: z.infer<typeof rpcSchema>) => {
    if (!active()) throw new RunnerError('lease_inactive');
    const id = body.id!;
    if (body.method === 'initialize')
      return {
        protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25', remoteVersion].includes(
          String(body.params?.protocolVersion),
        )
          ? body.params?.protocolVersion
          : '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentic-crm-runner', version: '0.0.0' },
      };
    if (body.method === 'ping') return {};
    if (body.method === 'server/discover') return remote(body.method, {}, id);
    if (body.method === 'tools/list') {
      if (!options.execution) return { tools: [] };
      const result = await remote(body.method, {}, id);
      const tools = z.array(z.object({ name: z.string() }).passthrough()).parse(result.tools);
      return { tools: tools.filter((tool) => tool.name === 'crm.task.create') };
    }
    if (body.method !== 'tools/call' || body.params?.name !== 'crm.task.create' || !options.execution)
      throw new RunnerError('tool_denied');
    const args = executionSchema.parse(body.params.arguments);
    if (
      Object.keys(options.execution).some(
        (key) => args[key as keyof typeof args] !== options.execution![key as keyof typeof args],
      )
    )
      throw new RunnerError('tool_denied');
    attempted = true;
    // A transport retry always reuses the server-minted descriptor and grant; immutable receipts prevent a second write.
    let result: Record<string, unknown>;
    try {
      result = await remote('tools/call', { name: 'crm.task.create', arguments: options.execution }, id);
    } catch (error) {
      if (!(error instanceof RunnerError) || error.code !== 'api_unavailable' || !active()) throw error;
      result = await remote('tools/call', { name: 'crm.task.create', arguments: options.execution }, id);
    }
    const receipt = z
      .object({
        receipt: z.object({
          id: z.string(),
          actionId: z.string(),
          attemptId: z.string(),
          proposalDigest: z.string(),
          outcome: z.object({ outcome: z.enum(['SUCCEEDED', 'FAILED_TERMINAL', 'OUTCOME_UNKNOWN']) }),
        }),
      })
      .safeParse(result.structuredContent);
    if (
      result.isError !== true &&
      receipt.success &&
      receipt.data.receipt.id === options.execution.receiptId &&
      receipt.data.receipt.actionId === options.execution.actionId &&
      receipt.data.receipt.attemptId === options.execution.id &&
      receipt.data.receipt.proposalDigest === options.execution.proposalDigest
    )
      settled = true;
    return result;
  };
  const server = createServer(
    { maxHeaderSize: 4_096, headersTimeout: 5_000, requestTimeout: 5_000 },
    (request, response) => {
      if (!active() || request.method !== 'POST' || request.url !== '/mcp' || inFlight >= 2 || ++calls > 64) {
        response.writeHead(403, { connection: 'close' }).end();
        return;
      }
      inFlight++;
      void (async () => {
        let id: string | number | null = null;
        try {
          const body = await requestJson(request);
          id = body.id ?? null;
          if (body.id === undefined) {
            response.writeHead(body.method === 'notifications/initialized' ? 202 : 400).end();
            return;
          }
          const result = await dispatch(body);
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ jsonrpc: '2.0', id, result }));
        } catch {
          response.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              error: { code: -32000, message: 'Capability denied or unavailable.' },
            }),
          );
        } finally {
          inFlight--;
        }
      })();
    },
  );
  server.on('connection', (socket) => {
    if (closed || sockets.size >= 4) return socket.destroy();
    sockets.add(socket);
    socket.setTimeout(15_000, () => socket.destroy());
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  const close = () => {
    if (closing) return closing;
    closed = true;
    options.signal.removeEventListener('abort', onAbort);
    for (const socket of sockets) socket.destroy();
    closing = (async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    })();
    return closing;
  };
  const onAbort = () => {
    void close().catch(() => {});
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(socketPath, 0o600);
    options.signal.addEventListener('abort', onAbort, { once: true });
    if (options.signal.aborted) await close();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    socketPath,
    get attempted() {
      return attempted;
    },
    get settled() {
      return settled;
    },
    close,
  };
}
