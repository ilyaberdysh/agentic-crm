// Fastify app factory: logging, request ids, CORS, error envelope, health, auth, tRPC, public /v2, realtime.
import { randomUUID } from 'node:crypto';
import { aiThreadRoom } from '@agentic-crm/contracts';
import { createDb, type Database } from '@agentic-crm/db';
import {
  createDomain,
  createJobProducer,
  type Domain,
  type GoogleSettings,
  type JobQueue,
  type LlmClient,
  type PolicyResolver,
  type WebhookSender,
} from '@agentic-crm/domain';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAgenticRoutes } from './agentic/routes';
import { registerAiStreamRoutes } from './ai/stream';
import { type Auth, authTrustedOrigins, createAuth } from './auth/auth';
import { registerAuthRoutes } from './auth/routes';
import { type ApiConfig, type ApiConfigOverrides, loadConfig } from './config';
import { createKysely, createPool, type Pool } from './db';
import { ApiError, envelope, toApiError, toEnvelope } from './errors';
import { registerGoogleIntegrationRoutes } from './integrations/google';
import { RealtimeGateway } from './realtime/gateway';
import { domainRoomAuthorizer } from './realtime/room-access';
import { createContextFactory } from './trpc/context';
import { type AppRouter, appRouter } from './trpc/router';
import { registerWorkflowWebhookRoute } from './trpc/routers/workflows-webhook';
import type { RateLimits } from './v2/auth';
import { publicApiPlugin } from './v2/plugin';
import { DomainWorkspaceResolver, type WorkspaceResolver } from './workspaces/resolver';

export interface BuildAppOptions {
  config?: ApiConfigOverrides;
  /** Defaults to the domain-backed resolver. */
  workspaces?: (deps: { pool: Pool; domain: Domain }) => WorkspaceResolver;
  /** Object permission resolver of the domain (defaults to slice 1's allow-all). */
  policyResolver?: PolicyResolver;
  /** Public REST API (/v2) knobs, e.g. lower rate limits in tests. */
  publicApi?: { rateLimits?: Partial<RateLimits> };
  /** Background job queue (defaults to a lazily started pg-boss producer on the API database; D-10). */
  jobs?: JobQueue;
  /** How webhook requests are sent ("Test subscription" runs in the API; default fetch). Tests inject a recorder. */
  webhookSender?: WebhookSender;
  /** LLM client of the AI layer (default: Anthropic with ANTHROPIC_API_KEY, else unconfigured). Tests pass a fake. */
  llm?: LlmClient;
  /** Google OAuth client for Gmail / Calendar (default: from the environment; null = not configured). */
  google?: GoogleSettings | null;
}

export interface ApiApp {
  app: FastifyInstance;
  config: ApiConfig;
  pool: Pool;
  /** The domain's own pool (UTC sessions, ISO timestamps): every data read and write goes through `domain`. */
  database: Database;
  domain: Domain;
  auth: Auth;
  workspaces: WorkspaceResolver;
  gateway: RealtimeGateway;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options: BuildAppOptions = {}): Promise<ApiApp> {
  const config = loadConfig(options.config);
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: 'loopback',
    bodyLimit: 1024 * 1024,
    routerOptions: { maxParamLength: 5000 },
  });

  const pool = createPool(config.databaseUrl);
  const auth = createAuth({ db: createKysely(pool), config, log: app.log });
  const database = createDb({ connectionString: config.databaseUrl, applicationName: 'agentic-crm-api-domain' });
  // Imports and exports enqueue worker jobs inside their transactions; the API only produces (apps/worker consumes).
  const producer = options.jobs
    ? null
    : createJobProducer({ connectionString: config.databaseUrl, applicationName: 'agentic-crm-api-jobs' });
  const domain = createDomain({
    database,
    jobs: options.jobs ?? (producer as NonNullable<typeof producer>).queue,
    ...(options.policyResolver ? { policyResolver: options.policyResolver } : {}),
    ...(options.webhookSender ? { webhookSender: options.webhookSender } : {}),
    ...(options.llm ? { llm: options.llm } : {}),
    ...(options.google !== undefined ? { google: options.google } : {}),
  });
  const workspaces = options.workspaces?.({ pool, domain }) ?? new DomainWorkspaceResolver(domain);
  const allowedOrigins = authTrustedOrigins(config);
  const gateway = new RealtimeGateway({
    auth,
    workspaces,
    pool,
    databaseUrl: config.databaseUrl,
    config: config.realtime,
    allowedOrigins,
    log: app.log,
    authorizeRoom: domainRoomAuthorizer(domain),
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('x-frame-options', 'DENY');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    // Cookie-authenticated writes from a foreign page are refused (Attio relies on SameSite=Lax + JSON + custom
    // headers, K sessions.md §1.1; we also check Origin). Better Auth checks its own routes.
    if (
      !SAFE_METHODS.has(request.method) &&
      (request.url.startsWith('/trpc') || request.url.startsWith('/api/agentic/'))
    ) {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.includes(origin) && origin !== `${request.protocol}://${request.host}`) {
        return reply.status(403).send(envelope(403, 'Origin not allowed'));
      }
    }
  });

  // tRPC clients POST input-less queries (method override) with a JSON content type and no body, which the tRPC
  // handler cannot parse: treat an empty body as "no input".
  app.addHook('preHandler', async (request) => {
    if (
      request.method === 'POST' &&
      request.url.startsWith('/trpc/') &&
      (request.body === undefined || request.body === '')
    ) {
      request.body = '{}';
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const apiError = toApiError(error);
    if (apiError.statusCode >= 500) request.log.error({ err: error }, 'request failed');
    return reply.status(apiError.statusCode).send(toEnvelope(apiError));
  });
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(envelope(404, `Route ${request.method}:${request.url.split('?')[0]} not found`)),
  );

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ['x-request-id'],
    maxAge: 600,
  });

  // Close realtime connections with "service restart" before @fastify/websocket's own preClose runs.
  app.addHook('preClose', async () => {
    gateway.closeAll(1012, 'server restarting');
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/api/health', async () => ({ status: 'ok', server_timestamp: new Date().toISOString() }));
  app.get('/api/health/ready', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
    } catch {
      return reply.status(503).send(envelope(503, 'Database unavailable'));
    }
    return { status: 'ok', database: 'ok', realtime: gateway.stats() };
  });

  await registerAuthRoutes(app, auth, { onSessionEnded: (sessionId) => gateway.closeSession(sessionId) });
  await registerAgenticRoutes(app, { auth, workspaces, domain });

  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: createContextFactory({ auth, workspaces, domain }),
      // Queries may be sent as POST: batched reads (1000 record ids) do not fit in a URL. Mutations stay POST-only.
      allowMethodOverride: true,
      onError: ({ error, path, ctx }) => {
        if (getHTTPStatusCodeFromError(error) < 500) return;
        // Unwrap TRPCError → ApiError → the original error, so the log shows the real cause.
        const cause = error.cause instanceof ApiError && error.cause.cause ? error.cause.cause : (error.cause ?? error);
        (ctx?.log ?? app.log).error({ err: cause, path }, 'trpc procedure failed');
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });

  await app.register(publicApiPlugin, {
    prefix: '/v2',
    domain,
    webUrl: config.webOrigin,
    ...(options.publicApi?.rateLimits ? { rateLimits: options.publicApi.rateLimits } : {}),
  });

  // Slice 8: the "Webhook received" workflow trigger URL.
  await registerWorkflowWebhookRoute(app, domain);

  // Slice 7b: Google OAuth connect / reconnect of Gmail + Calendar mailboxes.
  await registerGoogleIntegrationRoutes(app, { auth, workspaces, domain, config });

  // Slice 10: Ask Agentic answers stream to the sending tab over SSE and to the thread room for everyone else.
  await registerAiStreamRoutes(app, { auth, workspaces, domain });
  const stopAiRooms = domain.ai.hub.subscribe((e) => {
    gateway.rooms.broadcast(aiThreadRoom(e.workspaceId, e.threadId), { kind: 'ai-stream', event: e.event });
  });

  gateway.register(app);

  app.addHook('onReady', async () => {
    await gateway.start();
  });
  app.addHook('onClose', async () => {
    stopAiRooms();
    await gateway.close();
    await producer?.stop();
    await pool.end();
    await database.destroy();
  });

  return { app, config, pool, database, domain, auth, workspaces, gateway };
}
