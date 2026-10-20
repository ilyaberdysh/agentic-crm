// Ask Agentic answer streaming (slice10-contracts "Streaming"): the tab that sent a turn opens
//   GET /ai/threads/:threadId/stream?turnId=<assistant turn id>      (alias /api/ai/threads/…, proxied by Vite)
// with its session cookie and the workspace in `x-workspace-slug` (or `?workspace=<slug>` for EventSource). The
// response is Server-Sent Events, one JSON `AiStreamEvent` per `data:` line (`event:` = its type, `id:` = seq):
//   turn  the whole assistant turn — first event (live state when this process runs it, else the stored turn), then
//         on every step / tool status change
//   part  one part's cumulative snapshot (text so far, tool input so far, tool status); replace by seq
//   done  completed | failed | canceled | awaiting-approval — the stream then ends (approve / deny resume the turn:
//         open a new stream)
// Comments (`: ping`) every 15 s keep proxies from closing the connection. Other tabs and viewers receive the same
// events as ephemeral room messages `{kind:'ai-stream', event}` in `thread:<workspaceId>:<threadId>` (I4b); the
// persisted turn arrives as an `ai-turn` invalidation.
import type { AiStreamEvent } from '@agentic-crm/contracts';
import { type AiStreamEnvelope, type Domain, memberContext } from '@agentic-crm/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import { envelope, toApiError, toEnvelope, UNAUTHENTICATED_MESSAGE } from '../errors';
import { WORKSPACE_SLUG_HEADER } from '../trpc/trpc';
import type { WorkspaceResolver } from '../workspaces/resolver';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEARTBEAT_MS = 15_000;

export interface AiStreamDeps {
  auth: Auth;
  workspaces: WorkspaceResolver;
  domain: Domain;
}

function sseFrame(event: AiStreamEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

type StreamRequest = FastifyRequest<{
  Params: { threadId: string };
  Querystring: { turnId?: string; workspace?: string };
}>;

async function handle(deps: AiStreamDeps, request: StreamRequest, reply: FastifyReply) {
  const session = await getRequestSession(deps.auth, request.headers, reply);
  if (!session) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
  const header = request.headers[WORKSPACE_SLUG_HEADER];
  const slug = (Array.isArray(header) ? header[0] : header) || request.query.workspace;
  if (!slug)
    return reply.status(400).send(envelope(400, `A workspace is required: send the ${WORKSPACE_SLUG_HEADER} header`));
  const { threadId } = request.params;
  const turnId = request.query.turnId ?? '';
  if (!UUID.test(threadId) || !UUID.test(turnId)) return reply.status(404).send(envelope(404, 'Turn not found'));
  const resolution = await deps.workspaces.resolve(session.user.id, { slug });
  if (resolution.status === 'not-found') return reply.status(404).send(envelope(404, 'Workspace not found'));
  if (resolution.status === 'not-member') {
    return reply.status(403).send(envelope(403, 'You are not a member of this workspace'));
  }
  const workspaceId = resolution.workspace.id;
  const ctx = memberContext(workspaceId, resolution.membership.id);

  // Subscribe first, then read the snapshot: nothing published in between is lost.
  const buffered: AiStreamEvent[] = [];
  let forward: ((event: AiStreamEvent) => void) | null = null;
  const unsubscribe = deps.domain.ai.hub.subscribeTurn(turnId, (e: AiStreamEnvelope) => {
    if (e.workspaceId !== workspaceId) return;
    if (forward) forward(e.event);
    else buffered.push(e.event);
  });
  let snapshot: { turn: Awaited<ReturnType<Domain['ai']['turns']['get']>>; seq: number };
  try {
    const stored = await deps.domain.ai.turns.get(ctx, turnId);
    if (stored.threadId !== threadId) throw Object.assign(new Error('Turn not found'), { statusCode: 404 });
    snapshot = deps.domain.ai.hub.liveTurn(turnId, workspaceId) ?? { turn: stored, seq: 0 };
  } catch (err) {
    unsubscribe();
    const apiError = toApiError(err);
    return reply.status(apiError.statusCode).send(toEnvelope(apiError));
  }

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-request-id': request.id,
  });
  let closed = false;
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  request.raw.on('close', close);
  const write = (event: AiStreamEvent) => {
    if (closed) return;
    res.write(sseFrame(event));
    if (event.type === 'done') close();
  };

  write({ type: 'turn', seq: snapshot.seq, turn: snapshot.turn });
  const running = deps.domain.ai.turns.isRunning(turnId);
  for (const event of buffered.splice(0)) if (event.seq > snapshot.seq) write(event);
  if (closed) return;
  const { turn } = snapshot;
  if (turn.status !== 'executing') {
    write({ type: 'done', seq: deps.domain.ai.hub.nextSeq(), turnId, status: turn.status });
    return;
  }
  if (!running) {
    // Nothing runs it here: waiting for approval (or interrupted; threads.get marks those failed).
    write({
      type: 'done',
      seq: deps.domain.ai.hub.nextSeq(),
      turnId,
      status: turn.pendingApprovals.length > 0 ? 'awaiting-approval' : 'failed',
    });
    return;
  }
  forward = write;
}

export async function registerAiStreamRoutes(app: FastifyInstance, deps: AiStreamDeps): Promise<void> {
  for (const path of ['/ai/threads/:threadId/stream', '/api/ai/threads/:threadId/stream']) {
    app.get(path, (request, reply) => handle(deps, request as StreamRequest, reply));
  }
}
