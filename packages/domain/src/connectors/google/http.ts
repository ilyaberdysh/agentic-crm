// A tiny fetch-based Google HTTP client (7.09: no `googleapis` dependency). JSON in / out, form posts for the OAuth
// token endpoint, a per-request timeout, and a bounded retry of transient failures (429, 5xx, rate-limit 403s,
// network errors) honouring Retry-After. Failures surface as GoogleApiError (HTTP status + Google's reason) or
// GoogleNetworkError; `toConnectorError` maps them onto the outbox failure codes (F composer §5).
import { ConnectorError } from '../types.ts';
import type { ResolvedGoogleSettings } from './settings.ts';

export class GoogleApiError extends Error {
  readonly status: number;
  /** Google's machine reason (`rateLimitExceeded`, `insufficientPermissions`, `invalid_grant`, `notFound`, …). */
  readonly reason: string | null;
  readonly retryAfterMs: number | null;

  constructor(status: number, reason: string | null, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GoogleNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleNetworkError';
  }
}

type QueryValue = string | number | boolean | null | undefined | readonly string[];

export interface GoogleRequest {
  method?: 'GET' | 'POST' | 'DELETE';
  url: string;
  query?: Record<string, QueryValue>;
  /** Bearer access token. */
  token?: string;
  /** JSON body. */
  json?: unknown;
  /** application/x-www-form-urlencoded body. */
  form?: Record<string, string>;
  /** Raw body with its content type (media uploads). */
  body?: { contentType: string; data: string | Uint8Array };
  /** Retry transient failures (default true). */
  retry?: boolean;
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
  'quotaExceeded',
  'RATE_LIMIT_EXCEEDED',
  'RESOURCE_EXHAUSTED',
]);

export const isRateLimited = (e: GoogleApiError) =>
  e.status === 429 || (!!e.reason && RATE_LIMIT_REASONS.has(e.reason));
const isTransient = (e: unknown) =>
  e instanceof GoogleNetworkError || (e instanceof GoogleApiError && (e.status >= 500 || isRateLimited(e)));

function buildUrl(url: string, query: GoogleRequest['query']): string {
  if (!query) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const v of value) u.searchParams.append(key, v);
    else u.searchParams.set(key, String(value));
  }
  return u.toString();
}

/** Reason and message of a Google error body (REST `{error:{code, message, errors, status, details}}` or OAuth). */
function parseError(status: number, text: string): { reason: string | null; message: string } {
  try {
    const body = JSON.parse(text) as {
      error?:
        | string
        | {
            message?: string;
            status?: string;
            errors?: { reason?: string }[];
            details?: { '@type'?: string; reason?: string }[];
          };
      error_description?: string;
    };
    if (typeof body.error === 'string') return { reason: body.error, message: body.error_description ?? body.error };
    if (body.error && typeof body.error === 'object') {
      const info = body.error.details?.find((d) => d['@type']?.endsWith('google.rpc.ErrorInfo'));
      return {
        reason: body.error.errors?.[0]?.reason ?? info?.reason ?? body.error.status ?? null,
        message: body.error.message ?? `Google answered ${status}`,
      };
    }
  } catch {
    // Not JSON (proxy / HTML error page).
  }
  return { reason: null, message: `Google answered ${status}` };
}

function retryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function once(settings: ResolvedGoogleSettings, req: GoogleRequest): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let body: string | Uint8Array | undefined;
  if (req.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(req.json);
  } else if (req.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(req.form).toString();
  } else if (req.body) {
    headers['content-type'] = req.body.contentType;
    body = req.body.data;
  }
  let response: Response;
  try {
    response = await settings.fetch(buildUrl(req.url, req.query), {
      method: req.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body !== undefined ? { body: body as NonNullable<RequestInit['body']> } : {}),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
  } catch (err) {
    throw new GoogleNetworkError(err instanceof Error ? err.message : String(err));
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    const { reason, message } = parseError(response.status, text);
    throw new GoogleApiError(response.status, reason, message, retryAfter(response.headers.get('retry-after')));
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** One Google request with bounded retries of transient failures. */
export async function googleRequest<T>(settings: ResolvedGoogleSettings, req: GoogleRequest): Promise<T> {
  const { retries, baseDelayMs, maxDelayMs } = settings.retry;
  for (let attempt = 0; ; attempt++) {
    try {
      return (await once(settings, req)) as T;
    } catch (err) {
      if (req.retry === false || attempt >= retries || !isTransient(err)) throw err;
      const hinted = err instanceof GoogleApiError ? err.retryAfterMs : null;
      // A long Retry-After is left to the job's own back-off rather than holding the worker.
      if (hinted !== null && hinted > maxDelayMs) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(hinted ?? backoff * (0.5 + Math.random() / 2));
    }
  }
}

/** Maps a Google failure onto a ConnectorError (outbox reason code + whether a retry may help). */
export function toConnectorError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;
  if (err instanceof GoogleNetworkError) {
    return new ConnectorError('provider_unreachable', `Google could not be reached: ${err.message}`, true);
  }
  if (err instanceof GoogleApiError) {
    if (isRateLimited(err)) return new ConnectorError('provider_rate_limited', err.message, true);
    if (err.status >= 500) return new ConnectorError('provider_unreachable', err.message, true);
    if (err.status === 401 || err.status === 403) return new ConnectorError('account_access_error', err.message);
    return new ConnectorError('provider_rejected_request', err.message);
  }
  return new ConnectorError('unknown', err instanceof Error ? err.message : String(err), true);
}
