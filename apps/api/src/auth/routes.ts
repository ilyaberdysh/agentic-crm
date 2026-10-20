// /api/auth/*: Better Auth's endpoints (sign-up/email, sign-in/email, sign-out, get-session, …) plus Attio's
// `GET /api/auth/whoami` (K sessions.md §1.3) and a navigable `GET /api/auth/logout` (Attio's /auth/logout, §3).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { envelope, reasonPhrase, UNAUTHENTICATED_MESSAGE } from '../errors';
import { AUTH_BASE_PATH, type Auth, type AuthSession } from './auth';
import { getRequestSession, toFetchHeaders } from './session';

export interface AuthRouteHooks {
  /** Called after a session was ended by sign-out (e.g. to close its realtime connections). */
  onSessionEnded?: (sessionId: string) => void;
}

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'upgrade', 'expect'];

function toWebRequest(request: FastifyRequest): Request {
  const url = new URL(request.url, `${request.protocol}://${request.host}`);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody && typeof request.body === 'string' && request.body.length > 0 ? request.body : undefined;
  return new Request(url, { method: request.method, headers: toFetchHeaders(request.headers, HOP_BY_HOP), body });
}

/** Better Auth errors are `{code, message}`; we send the Attio envelope and keep `code` for Better Auth clients. */
async function sendWebResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    if (key === 'set-cookie' || key === 'content-length' || key === 'content-encoding') return;
    reply.header(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  const text = await response.text();
  if (response.status >= 400) {
    let parsed: { code?: unknown; message?: unknown } = {};
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    const code = typeof parsed.code === 'string' ? parsed.code : undefined;
    const message =
      typeof parsed.message === 'string' && parsed.message ? parsed.message : reasonPhrase(response.status);
    reply.header('content-type', 'application/json; charset=utf-8');
    return reply.send({
      ...envelope(response.status, message, code ? { code } : undefined),
      ...(code ? { code } : {}),
    });
  }
  return reply.send(text.length > 0 ? text : null);
}

function splitName(full: string): { first: string; last: string; full: string } {
  const trimmed = full.trim();
  const index = trimmed.indexOf(' ');
  return index === -1
    ? { first: trimmed, last: '', full: trimmed }
    : { first: trimmed.slice(0, index), last: trimmed.slice(index + 1).trim(), full: trimmed };
}

/** Attio's `active_user` subset we can serve today (K sessions.md §1.2). */
export function toActiveUser(session: AuthSession) {
  const { user } = session;
  return {
    id: user.id,
    email_address: user.email,
    name: splitName(user.name),
    avatar_url: user.image ?? null,
    user_auth_session_id: session.session.id,
    created_at: new Date(user.createdAt).toISOString(),
  };
}

export async function registerAuthRoutes(app: FastifyInstance, auth: Auth, hooks: AuthRouteHooks = {}) {
  await app.register(async (scope) => {
    // Forward bodies verbatim to Better Auth (it parses JSON itself; empty POST bodies are allowed).
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => {
      done(null, body);
    });

    scope.get(`${AUTH_BASE_PATH}/whoami`, async (request, reply) => {
      const session = await getRequestSession(auth, request.headers, reply);
      if (!session) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
      reply.header('cache-control', 'no-store');
      return { user: toActiveUser(session) };
    });

    scope.get(`${AUTH_BASE_PATH}/logout`, async (request, reply) => {
      const session = await getRequestSession(auth, request.headers);
      if (session) {
        const response = await auth.api.signOut({ headers: toFetchHeaders(request.headers), asResponse: true });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header('set-cookie', cookies);
        hooks.onSessionEnded?.(session.session.id);
      }
      reply.header('cache-control', 'no-store');
      return reply.redirect('/auth/sign-in', 302);
    });

    scope.route({
      method: ['GET', 'POST'],
      url: `${AUTH_BASE_PATH}/*`,
      handler: async (request, reply) => {
        const isSignOut = request.method === 'POST' && request.url.split('?')[0] === `${AUTH_BASE_PATH}/sign-out`;
        const ending = isSignOut ? await getRequestSession(auth, request.headers) : null;
        const response = await auth.handler(toWebRequest(request));
        if (ending && response.ok) hooks.onSessionEnded?.(ending.session.id);
        return sendWebResponse(reply, response);
      },
    });
  });
}
