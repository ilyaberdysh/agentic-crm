// /v2 authentication (Attio docs rest-api/guides/authentication): `Authorization: Bearer <token>`, or HTTP Basic with
// the token as the username and an empty password. Scopes are checked per operation; `read-write` includes `read`.
// Rate limits (rest-api/guides/rate-limiting): 100 reads/s and 25 writes/s per token, 429 with a Retry-After date.
import { missingScopes } from '@agentic-crm/contracts';
import type { FastifyRequest } from 'fastify';
import { publicErrors } from './errors';

/** The secret presented with the request, or null when there is none. */
export function presentedToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  const value = rest.join(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() === 'bearer') return value;
  if (scheme.toLowerCase() === 'basic') {
    let decoded: string;
    try {
      decoded = Buffer.from(value, 'base64').toString('utf8');
    } catch {
      return null;
    }
    const colon = decoded.indexOf(':');
    const username = colon === -1 ? decoded : decoded.slice(0, colon);
    return username.length > 0 ? username : null;
  }
  return null;
}

export function assertScopes(granted: readonly string[], required: readonly string[]): void {
  const missing = missingScopes(granted, required);
  if (missing.length > 0) {
    throw publicErrors.forbidden(
      `Your access token is missing the following scopes required by this endpoint: ${missing.join(', ')}.`,
    );
  }
}

export interface RateLimits {
  readsPerSecond: number;
  writesPerSecond: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { readsPerSecond: 100, writesPerSecond: 25 };

/** Fixed one-second windows per token and request class (enough for one API process). */
export class RateLimiter {
  private readonly windows = new Map<string, { second: number; count: number }>();

  constructor(private readonly limits: RateLimits) {}

  hit(tokenId: string, kind: 'read' | 'write', now = Date.now()): void {
    const second = Math.floor(now / 1000);
    const key = `${tokenId}:${kind}`;
    const window = this.windows.get(key);
    const limit = kind === 'read' ? this.limits.readsPerSecond : this.limits.writesPerSecond;
    if (!window || window.second !== second) {
      this.windows.set(key, { second, count: 1 });
      if (this.windows.size > 10_000) this.prune(second);
      return;
    }
    if (window.count >= limit) throw publicErrors.rateLimited(new Date((second + 1) * 1000));
    window.count++;
  }

  private prune(second: number): void {
    for (const [key, window] of this.windows) if (window.second < second) this.windows.delete(key);
  }
}
