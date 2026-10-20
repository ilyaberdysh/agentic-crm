// Public REST API (/v2), Attio-compatible (ARCHITECTURE D-05, I5): thin adapters over packages/domain with workspace
// API tokens, Attio's scopes, error bodies and rate limits. Registered by app.ts with the `/v2` prefix; everything here
// is encapsulated (own error and not-found handlers, own JSON parser) so the rest of the app is unaffected.
import { createDb, type Database } from '@agentic-crm/db';
import { createDomain, type Domain } from '@agentic-crm/domain';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { assertScopes, DEFAULT_RATE_LIMITS, presentedToken, RateLimiter, type RateLimits } from './auth';
import { V2Context } from './context';
import { publicErrors, toPublicError } from './errors';
import { parseMultipart } from './multipart';
import type { RouteSpec } from './route';
import { attributeRoutesAll } from './routes/attributes';
import { commentRoutes } from './routes/comments';
import { fileRoutes } from './routes/files';
import { listRoutes } from './routes/lists';
import { meetingRoutes } from './routes/meetings';
import { memberRoutes } from './routes/members';
import { noteRoutes } from './routes/notes';
import { objectRoutes } from './routes/objects';
import { recordRoutes } from './routes/records';
import { searchRoutes } from './routes/search';
import { taskRoutes } from './routes/tasks';
import { webhookRoutes } from './routes/webhooks';

export interface PublicApiOptions {
  /** Domain services; created from `databaseUrl` when omitted. */
  domain?: Domain;
  databaseUrl?: string;
  /** Origin of the web app, for records' `web_url`. */
  webUrl: string;
  rateLimits?: Partial<RateLimits>;
}

export const ROUTES: RouteSpec[] = [
  ...memberRoutes,
  ...objectRoutes,
  ...attributeRoutesAll,
  ...recordRoutes,
  ...searchRoutes,
  ...listRoutes,
  ...noteRoutes,
  ...taskRoutes,
  ...commentRoutes,
  ...fileRoutes,
  ...webhookRoutes,
  ...meetingRoutes,
];

/** Multipart bodies (POST /files/upload) may carry a 50 MB file plus the form fields. */
const MULTIPART_BODY_LIMIT = 51 * 1024 * 1024;

/** Reads in Attio's rate-limit sense: GETs and the POST query/search endpoints. */
const READ_POSTS = /\/records\/(query|search)$/;

export const publicApiPlugin: FastifyPluginAsync<PublicApiOptions> = async (app, options) => {
  let database: Database | null = null;
  let domain = options.domain;
  if (!domain) {
    database = createDb({ connectionString: options.databaseUrl, applicationName: 'agentic-crm-api-v2' });
    domain = createDomain({ database });
  }
  const services = domain;
  const limiter = new RateLimiter({ ...DEFAULT_RATE_LIMITS, ...options.rateLimits });
  if (database) {
    const owned = database;
    app.addHook('onClose', async () => {
      await owned.destroy();
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const e = toPublicError(error);
    if (e.statusCode >= 500) request.log.error({ err: e.cause ?? error }, 'v2 request failed');
    return reply.status(e.statusCode).headers(e.headers).send(e.toBody());
  });
  app.setNotFoundHandler((request, reply) => {
    const e = publicErrors.notFound(`Route ${request.method} ${request.url.split('?')[0]} not found.`);
    return reply.status(404).send(e.toBody());
  });

  // Empty bodies are allowed (e.g. POST …/records/query without a filter); malformed JSON is a validation error.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(publicErrors.validation('The request body is not valid JSON.'), undefined);
    }
  });

  app.addContentTypeParser(
    'multipart/form-data',
    { parseAs: 'buffer', bodyLimit: MULTIPART_BODY_LIMIT },
    (request, body, done) => {
      try {
        done(null, parseMultipart(body as Buffer, String(request.headers['content-type'] ?? '')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  async function authenticate(request: FastifyRequest) {
    const secret = presentedToken(request);
    if (!secret) {
      throw publicErrors.unauthenticated(
        'No access token was provided. Send it in the Authorization header as "Bearer <token>".',
      );
    }
    return { secret, identity: await services.apiTokens.authenticate(secret) };
  }

  // GET /v2/self — RFC 7662 introspection; unknown or revoked tokens are `{active: false}`, not an error.
  app.get('/self', async (request, reply) => {
    const { identity } = await authenticate(request);
    reply.header('cache-control', 'no-store');
    if (!identity) return { active: false };
    limiter.hit(identity.token.id, 'read');
    const { token, workspace } = identity;
    return {
      active: true,
      scope: token.scopes.join(' '),
      client_id: token.id,
      token_type: 'Bearer',
      exp: null,
      iat: Math.floor(Date.parse(token.createdAt.replace(/(\.\d{3})\d*Z$/, '$1Z')) / 1000),
      sub: workspace.id,
      aud: token.id,
      iss: 'attio.com',
      token_level: token.tokenLevel,
      ...(token.authorizedByMemberId ? { authorized_by_workspace_member_id: token.authorizedByMemberId } : {}),
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      workspace_slug: workspace.slug,
      workspace_logo_url: workspace.logoUrl,
    };
  });

  for (const route of ROUTES) {
    app.route({
      method: route.method,
      url: route.url,
      ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const { identity } = await authenticate(request);
        if (!identity) throw publicErrors.unauthenticated('The access token is invalid or has been revoked.');
        const required =
          typeof route.scopes === 'function' ? route.scopes(request.params as Record<string, string>) : route.scopes;
        assertScopes(identity.token.scopes, required);
        const kind =
          route.kind ?? (route.method === 'GET' || READ_POSTS.test(request.url.split('?')[0] ?? '') ? 'read' : 'write');
        limiter.hit(identity.token.id, kind);
        const v2 = new V2Context(services, identity, options.webUrl);
        return route.handler(v2, request, reply);
      },
    });
  }
};
