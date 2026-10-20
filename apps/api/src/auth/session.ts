import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyReply } from 'fastify';
import type { Auth, AuthSession } from './auth';

/** Node request headers → Fetch Headers (multi-valued headers are appended). */
export function toFetchHeaders(source: IncomingHttpHeaders, drop: readonly string[] = []): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || drop.includes(key)) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, String(value));
  }
  return headers;
}

/**
 * Reads the session from the request cookie. When a reply is given, Better Auth's sliding refresh
 * (`Set-Cookie` with a renewed expiry) is forwarded to it.
 */
export async function getRequestSession(
  auth: Auth,
  headers: IncomingHttpHeaders,
  reply?: FastifyReply,
): Promise<AuthSession | null> {
  if (!headers.cookie) return null;
  const { headers: responseHeaders, response } = await auth.api.getSession({
    headers: toFetchHeaders(headers),
    returnHeaders: true,
  });
  if (reply) {
    const cookies = responseHeaders.getSetCookie();
    if (cookies.length > 0) reply.header('set-cookie', cookies);
  }
  return response ?? null;
}
