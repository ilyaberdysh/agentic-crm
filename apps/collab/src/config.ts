// Collab server configuration. Shared values come from @agentic-crm/config (port 4101, database, auth secret, web
// origin); collab-only knobs are read here.
import { config as shared } from '@agentic-crm/config';

const env = (key: string): string | undefined => {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
};
const int = (key: string, fallback: number): number => {
  const parsed = Number.parseInt(env(key) ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const bool = (key: string, fallback: boolean): boolean => {
  const value = env(key);
  return value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface CollabConfig {
  host: string;
  port: number;
  databaseUrl: string;
  /** Better Auth secret: the `agentic-crm-session` cookie is HMAC-signed with it. */
  authSecret: string;
  /** Browser origins allowed to open the socket (requests without Origin are non-browser clients). */
  allowedOrigins: string[];
  /** Debounce of persisting a changed document (Hocuspocus onStoreDocument). */
  debounceMs: number;
  /** A document under continuous editing is persisted at least this often. */
  maxDebounceMs: number;
  /** Open connections whose session was signed out / revoked are closed within this period. */
  sessionRevalidateMs: number;
  /** Session lookups by cookie are cached this long (a tab opening several documents authenticates once). */
  sessionCacheMs: number;
  /** Hocuspocus idle timeout: a socket that sends nothing for this long is closed (providers ping more often). */
  timeoutMs: number;
  /** Largest WebSocket message accepted. */
  maxMessageBytes: number;
  shutdownTimeoutMs: number;
  /** /dev/* helpers for the editor dev page (never in production). */
  devEndpoints: boolean;
  logLevel: LogLevel;
}

export type CollabConfigOverrides = Partial<CollabConfig>;

export function loadCollabConfig(overrides: CollabConfigOverrides = {}): CollabConfig {
  const isProduction = env('NODE_ENV') === 'production';
  const base: CollabConfig = {
    host: env('COLLAB_HOST') ?? '127.0.0.1',
    port: shared.collabPort,
    databaseUrl: shared.databaseUrl,
    authSecret: shared.authSecret,
    allowedOrigins: (env('COLLAB_ALLOWED_ORIGINS') ?? `${shared.webOrigin},http://localhost:5175`)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    debounceMs: int('COLLAB_DEBOUNCE_MS', 2_000),
    maxDebounceMs: int('COLLAB_MAX_DEBOUNCE_MS', 10_000),
    sessionRevalidateMs: int('COLLAB_SESSION_REVALIDATE_MS', 60_000),
    sessionCacheMs: int('COLLAB_SESSION_CACHE_MS', 5_000),
    timeoutMs: int('COLLAB_TIMEOUT_MS', 30_000),
    maxMessageBytes: int('COLLAB_MAX_MESSAGE_BYTES', 16 * 1024 * 1024),
    shutdownTimeoutMs: int('COLLAB_SHUTDOWN_TIMEOUT_MS', 10_000),
    devEndpoints: bool('COLLAB_DEV_ENDPOINTS', !isProduction),
    logLevel: (env('LOG_LEVEL') as LogLevel | undefined) ?? (env('NODE_ENV') === 'test' ? 'silent' : 'info'),
  };
  const merged = { ...base, ...overrides };
  if (isProduction && merged.authSecret === 'dev-only-secret-change-me-0123456789abcdef') {
    throw new Error('AUTH_SECRET must be set in production');
  }
  if (isProduction) merged.devEndpoints = false;
  return merged;
}

export interface Logger {
  error(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

const LEVELS: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/** JSON-lines logger (pino-compatible fields, picked up by the Loki stack like the API's logs). */
export function createLogger(level: LogLevel, name = 'collab'): Logger {
  const at = LEVELS[level] ?? LEVELS.info;
  const write = (lvl: Exclude<LogLevel, 'silent'>, msg: string, data?: Record<string, unknown>) => {
    if (LEVELS[lvl] > at) return;
    const line = JSON.stringify({ level: lvl, time: Date.now(), name, msg, ...data });
    if (lvl === 'error' || lvl === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    error: (msg, data) => write('error', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    info: (msg, data) => write('info', msg, data),
    debug: (msg, data) => write('debug', msg, data),
  };
}
