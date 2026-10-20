// Google connector settings (slice 7b, BACKLOG 7.09; ARCHITECTURE D-21): the OAuth client of the Internal Google
// Workspace app, the endpoints (real Google by default; tests inject a fake `fetch` that answers them), the scopes,
// the at-rest encryption key of the tokens and the sync windows. `googleSettingsFromEnv()` reads @agentic-crm/config;
// without GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET Google is "not configured" and no gmail connector is registered.
import { config } from '@agentic-crm/config';
import { resolveEncryptionKey } from './crypto.ts';

export interface GoogleEndpoints {
  /** OAuth 2.0 authorization endpoint (browser redirect). */
  authorize: string;
  token: string;
  /** OpenID Connect userinfo (account email + subject). */
  userinfo: string;
  /** Gmail REST base (…/gmail/v1). */
  gmail: string;
  /** Gmail media-upload base (sends larger than the JSON limit). */
  gmailUpload: string;
  /** Calendar REST base (…/calendar/v3). */
  calendar: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  gmail: 'https://gmail.googleapis.com/gmail/v1',
  gmailUpload: 'https://gmail.googleapis.com/upload/gmail/v1',
  calendar: 'https://www.googleapis.com/calendar/v3',
};

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Requested scopes (7.09): read + send mail, read the calendar, and the account identity. */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  CALENDAR_READONLY_SCOPE,
];
/** Scopes the consent must include for the mailbox to sync and send (unchecked boxes → "missing-scopes"). */
export const REQUIRED_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, CALENDAR_READONLY_SCOPE];

export interface GoogleRetryPolicy {
  /** Extra attempts after a rate-limited / 5xx / network failure (per request). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface CalendarWindow {
  /** The first (full) sync covers events from this many days ago … */
  pastDays: number;
  /** … to this many days ahead (recurring series are expanded into instances inside the window). */
  futureDays: number;
  /** After this many days of incremental sync a full sync runs again, moving the window forward. */
  refreshDays: number;
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** 32-byte AES-256-GCM key for tokens at rest and the OAuth cookie / state. */
  encryptionKey: Buffer;
  endpoints?: Partial<GoogleEndpoints>;
  /** Transport for every Google call (default global fetch); tests inject the fake. */
  fetch?: typeof fetch;
  /** Transport for downloading outgoing attachments from object storage (default global fetch). */
  download?: typeof fetch;
  /** Initial mail sync window in days; null = every message that was not deleted (Attio: "All emails … are synced"). */
  mailSyncDays?: number | null;
  calendarWindow?: Partial<CalendarWindow>;
  retry?: Partial<GoogleRetryPolicy>;
  /** Parallel `messages.get` calls while a page is fetched. */
  fetchConcurrency?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Clock (token expiry, sync windows); tests move it. */
  now?: () => Date;
}

export const DEFAULT_CALENDAR_WINDOW: CalendarWindow = { pastDays: 365, futureDays: 365, refreshDays: 30 };
export const DEFAULT_RETRY: GoogleRetryPolicy = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/** Settings with every default applied. */
export interface ResolvedGoogleSettings
  extends Required<Omit<GoogleSettings, 'endpoints' | 'calendarWindow' | 'retry' | 'mailSyncDays'>> {
  endpoints: GoogleEndpoints;
  calendarWindow: CalendarWindow;
  retry: GoogleRetryPolicy;
  mailSyncDays: number | null;
}

export function resolveGoogleSettings(settings: GoogleSettings): ResolvedGoogleSettings {
  return {
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    redirectUri: settings.redirectUri,
    encryptionKey: settings.encryptionKey,
    endpoints: { ...GOOGLE_ENDPOINTS, ...settings.endpoints },
    fetch: settings.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    download: settings.download ?? ((input, init) => globalThis.fetch(input, init)),
    mailSyncDays: settings.mailSyncDays ?? null,
    calendarWindow: { ...DEFAULT_CALENDAR_WINDOW, ...settings.calendarWindow },
    retry: { ...DEFAULT_RETRY, ...settings.retry },
    // Gmail allows ~250 quota units / user / s and messages.get costs 5: keep a page fetch well below it.
    fetchConcurrency: settings.fetchConcurrency ?? 4,
    timeoutMs: settings.timeoutMs ?? 30_000,
    now: settings.now ?? (() => new Date()),
  };
}

/** Google settings from the environment, or null when the OAuth client is not configured. */
export function googleSettingsFromEnv(): GoogleSettings | null {
  const { clientId, clientSecret, redirectUri, mailSyncDays } = config.google;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey: resolveEncryptionKey(config.encryptionKey, config.authSecret, { production: config.isProduction }),
    mailSyncDays: mailSyncDays !== undefined && Number.isFinite(mailSyncDays) && mailSyncDays > 0 ? mailSyncDays : null,
  };
}
