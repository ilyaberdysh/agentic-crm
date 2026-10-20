// API runtime configuration. Shared values come from @agentic-crm/config; API-only knobs are read here.
import { config as shared } from '@agentic-crm/config';

const env = (key: string): string | undefined => {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
};
const bool = (key: string, fallback: boolean): boolean => {
  const value = env(key);
  return value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};
const int = (key: string, fallback: number): number => {
  const value = env(key);
  const parsed = value === undefined ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DAY_S = 24 * 60 * 60;

export interface RealtimeConfig {
  /** change_log rows older than this may have been pruned: a resume cursor older than it gets `continuity-lost`. */
  changeLogRetentionMs: number;
  /** A resume that would replay more rows than this gets `continuity-lost` instead (a full refetch is cheaper). */
  maxReplayRows: number;
  /** Safety-net poll of change_log (LISTEN/NOTIFY drives normal latency). */
  pollIntervalMs: number;
  /** Ids an in-flight transaction may still commit below the boot frontier. */
  bootLookback: number;
  /** How long an id gap must persist before it can be declared an aborted insert. */
  gapGraceMs: number;
  /** Server → client WebSocket ping and session revalidation period. */
  heartbeatIntervalMs: number;
  /** Close a connection whose unsent buffer exceeds this (client resumes with its cursor). */
  maxBufferedBytes: number;
  maxSubscriptionsPerConnection: number;
  maxRoomsPerConnection: number;
  /** Token bucket: messages per second (sustained) and burst, per connection. */
  messagesPerSecond: number;
  messageBurst: number;
}

export interface ApiConfig {
  databaseUrl: string;
  host: string;
  port: number;
  /** Origin of the web app (CORS, trusted origin for auth). */
  webOrigin: string;
  /** Browser-visible origin of the API (the web origin in dev, because Vite proxies /api, /trpc, /realtime). */
  publicUrl: string;
  authSecret: string;
  isProduction: boolean;
  logLevel: string;
  signUpEnabled: boolean;
  /** Session lifetime; Attio's session cookies live ~180 days (K sessions.md §1.1). */
  sessionTtlSeconds: number;
  /** Sliding refresh: a session used after this age gets a new expiry. */
  sessionUpdateAgeSeconds: number;
  shutdownTimeoutMs: number;
  realtime: RealtimeConfig;
}

export type ApiConfigOverrides = Partial<Omit<ApiConfig, 'realtime'>> & { realtime?: Partial<RealtimeConfig> };

export function loadConfig(overrides: ApiConfigOverrides = {}): ApiConfig {
  const isProduction = env('NODE_ENV') === 'production';
  const webOrigin = overrides.webOrigin ?? shared.webOrigin;
  const base: ApiConfig = {
    databaseUrl: shared.databaseUrl,
    host: env('API_HOST') ?? '127.0.0.1',
    port: shared.apiPort,
    webOrigin,
    publicUrl: env('API_PUBLIC_URL') ?? webOrigin,
    authSecret: shared.authSecret,
    isProduction,
    logLevel: env('LOG_LEVEL') ?? (env('NODE_ENV') === 'test' ? 'silent' : 'info'),
    signUpEnabled: bool('AUTH_SIGNUP_ENABLED', true),
    sessionTtlSeconds: int('AUTH_SESSION_TTL_S', 180 * DAY_S),
    sessionUpdateAgeSeconds: int('AUTH_SESSION_UPDATE_AGE_S', DAY_S),
    shutdownTimeoutMs: int('API_SHUTDOWN_TIMEOUT_MS', 10_000),
    realtime: {
      changeLogRetentionMs: int('REALTIME_CHANGE_LOG_RETENTION_MS', 7 * DAY_S * 1000),
      maxReplayRows: int('REALTIME_MAX_REPLAY_ROWS', 5_000),
      pollIntervalMs: int('REALTIME_POLL_INTERVAL_MS', 2_000),
      bootLookback: int('REALTIME_BOOT_LOOKBACK', 1_000),
      gapGraceMs: int('REALTIME_GAP_GRACE_MS', 200),
      heartbeatIntervalMs: int('REALTIME_HEARTBEAT_MS', 30_000),
      maxBufferedBytes: int('REALTIME_MAX_BUFFERED_BYTES', 4 * 1024 * 1024),
      maxSubscriptionsPerConnection: 20,
      maxRoomsPerConnection: 50,
      messagesPerSecond: 50,
      messageBurst: 200,
    },
  };
  const { realtime, ...rest } = overrides;
  const merged: ApiConfig = { ...base, ...rest, realtime: { ...base.realtime, ...realtime } };
  if (merged.isProduction && merged.authSecret === 'dev-only-secret-change-me-0123456789abcdef') {
    throw new Error('AUTH_SECRET must be set in production');
  }
  return merged;
}
