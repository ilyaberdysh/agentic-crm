// WebSocket authentication with the `agentic-crm-session` cookie set by apps/api (Better Auth, D-15). The cookie value is
// `encodeURIComponent(token + "." + base64(HMAC-SHA256(authSecret, token)))`; the token identifies a row of
// `sessions` (global auth table, migration 0010). We verify the signature with the shared secret and read the
// session directly (same rule as the API: `cookieCache` is off, so sign-out and revocation apply immediately).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

/** Plain name, and the `__Secure-` variant Better Auth uses on https origins. */
export const SESSION_COOKIE_NAMES = ['agentic-crm-session', '__Secure-agentic-crm-session'] as const;

export interface CollabSession {
  sessionId: string;
  userId: string;
  /** Opaque session token (used to re-validate open connections). */
  token: string;
  name: string;
  email: string;
  expiresAt: string;
}

export function parseCookies(header: string | null | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !cookies.has(name)) cookies.set(name, value);
  }
  return cookies;
}

/** The session token of a signed cookie value, or null when the signature does not match. */
export function verifySignedToken(raw: string, secret: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(token).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return token;
}

export function sessionTokenFromCookieHeader(header: string | null | undefined, secret: string): string | null {
  const cookies = parseCookies(header);
  for (const name of SESSION_COOKIE_NAMES) {
    const raw = cookies.get(name);
    if (raw) {
      const token = verifySignedToken(raw, secret);
      if (token) return token;
    }
  }
  return null;
}

interface CacheEntry {
  session: CollabSession | null;
  until: number;
}

export class SessionStore {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly pool: pg.Pool,
    private readonly secret: string,
    private readonly cacheMs: number,
  ) {}

  /** The live session behind a Cookie header, or null (missing, forged, expired or signed out). */
  async fromCookieHeader(header: string | null | undefined): Promise<CollabSession | null> {
    const token = sessionTokenFromCookieHeader(header, this.secret);
    if (!token) return null;
    const now = Date.now();
    const cached = this.cache.get(token);
    if (cached && cached.until > now) return cached.session;
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      expires_at: Date;
      name: string;
      email: string;
    }>(
      `SELECT s.id, s.user_id, s.expires_at, u.name, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = $1 AND s.expires_at > now()`,
      [token],
    );
    const row = rows[0];
    const session: CollabSession | null = row
      ? {
          sessionId: row.id,
          userId: row.user_id,
          token,
          name: row.name,
          email: row.email,
          expiresAt: new Date(row.expires_at).toISOString(),
        }
      : null;
    this.cache.set(token, { session, until: now + this.cacheMs });
    if (this.cache.size > 10_000) this.prune(now);
    return session;
  }

  /** Which of `tokens` still belong to live sessions (bypasses the cache). */
  async validTokens(tokens: string[]): Promise<Set<string>> {
    if (tokens.length === 0) return new Set();
    const { rows } = await this.pool.query<{ token: string }>(
      'SELECT token FROM sessions WHERE token = ANY($1::text[]) AND expires_at > now()',
      [tokens],
    );
    const valid = new Set(rows.map((r) => r.token));
    for (const token of tokens) if (!valid.has(token)) this.cache.delete(token);
    return valid;
  }

  private prune(now: number): void {
    for (const [token, entry] of this.cache) if (entry.until <= now) this.cache.delete(token);
  }
}
