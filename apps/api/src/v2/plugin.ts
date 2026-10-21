// Product-owned REST API (/v2): thin adapters over domain services with scoped workspace API tokens.
// Registered by app.ts with the `/v2` prefix; everything here
// is encapsulated (own error and not-found handlers, own JSON parser) so the rest of the app is unaffected.
import { createDb, type Database } from '@agentic-crm/db';
import { createDomain, type Domain } from '@agentic-crm/domain';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { assertScopes, DEFAULT_RATE_LIMITS, presentedToken, RateLimiter, type RateLimits } from './auth';
import { V2Context } from './context';
import { publicErrors, toPublicError } from './errors';
import { parseMultipart } from './multipart';
import { bindRoutes } from './route';
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
import { selfRoute } from './routes/self';
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

export const ROUTES = bindRoutes([
  selfRoute,
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
]);

/** Multipart bodies (POST /files/upload) may carry a 50 MB file plus the form fields. */
const MULTIPART_BODY_LIMIT = 51 * 1024 * 1024;

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

  for (const route of ROUTES) {
    app.route({
      method: route.method,
      url: route.url,
      config: {
        operationId: route.operationId,
        logicalOperationId: route.logicalOperationId,
        requiredScopes: route.scopes,
        rateClass: route.kind,
      },
      ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
      handler: async (request: FastifyRequest, reply: FastifyReply) => {
        const introspection = route.logicalOperationId === 'getSelf';
        if (introspection) reply.header('cache-control', 'no-store');
        const { identity } = await authenticate(request);
        // Unknown/revoked tokens are inactive introspection results; every other operation requires an identity.
        if (!identity && introspection) return { active: false };
        if (!identity) throw publicErrors.unauthenticated('The access token is invalid or has been revoked.');
        assertScopes(identity.token.scopes, route.scopes);
        limiter.hit(identity.token.id, route.kind);
        const v2 = new V2Context(services, identity, options.webUrl);
        return route.handler(v2, request, reply);
      },
    });
  }
};
