// Better Auth: email/password login and the `agentic-crm-session` cookie.
// Sessions are HttpOnly, SameSite=Lax, Secure on HTTPS, and expire after the configured lifetime.
// Tables: packages/db/migrations/0010_auth.sql (users, sessions, accounts, verifications; uuid ids, snake_case).
import { betterAuth } from 'better-auth';
import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { ApiConfig } from '../config';

export const SESSION_COOKIE_NAME = 'agentic-crm-session';
export const AUTH_BASE_PATH = '/api/auth';

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' } as const;

export function authTrustedOrigins(config: Pick<ApiConfig, 'webOrigin' | 'publicUrl'>): string[] {
  return [...new Set([config.webOrigin, config.publicUrl])];
}

export function createAuth(options: { db: Kysely<any>; config: ApiConfig; log?: FastifyBaseLogger }) {
  const { db, config, log } = options;
  return betterAuth({
    appName: 'agentic-crm',
    baseURL: config.publicUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
    database: { db, type: 'postgres', transaction: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !config.signUpEnabled,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', ...timestamps },
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        ...timestamps,
      },
      expiresIn: config.sessionTtlSeconds,
      updateAge: config.sessionUpdateAgeSeconds,
      // Every request reads the session row, so sign-out / revocation takes effect immediately.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: 'accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        ...timestamps,
      },
    },
    verification: {
      modelName: 'verifications',
      fields: { expiresAt: 'expires_at', ...timestamps },
    },
    trustedOrigins: authTrustedOrigins(config),
    advanced: {
      // Ids come from the column default uuidv7() (Postgres 18), not from Better Auth.
      database: { generateId: 'uuid' },
      cookiePrefix: 'agentic-crm',
      cookies: { session_token: { name: SESSION_COOKIE_NAME } },
      useSecureCookies: config.publicUrl.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      // Better Auth skips its Origin/CSRF check when NODE_ENV=test; keep it on everywhere so tests see prod.
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    telemetry: { enabled: false },
    logger: {
      level: config.isProduction ? 'warn' : 'info',
      log: (level, message, ...args) => {
        if (!log) return;
        const payload = args.length > 0 ? { args } : {};
        if (level === 'error') log.error(payload, `[auth] ${message}`);
        else if (level === 'warn') log.warn(payload, `[auth] ${message}`);
        else if (level === 'debug') log.debug(payload, `[auth] ${message}`);
        else log.info(payload, `[auth] ${message}`);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The user/session pair Better Auth returns for a valid session cookie. */
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];
export type AuthSessionRecord = AuthSession['session'];
