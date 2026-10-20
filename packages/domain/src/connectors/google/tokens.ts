// OAuth tokens of a Google mailbox (7.09). connected_accounts.credentials holds the sealed GoogleCredentials; the
// connector opens them per call, refreshes the access token when it expires (or when Google answers 401) and hands
// the refreshed value to the CredentialStore (a domain write, sealed again). A revoked or expired grant
// (`invalid_grant`), credentials sealed with another key, or missing scopes mark the account as needing reconnection:
// the mailbox shows "Sync Error", its sync and delivery stop until the member reconnects it.
import { createHash } from 'node:crypto';
import { ConnectorError, type ConnectorMailbox } from '../types.ts';
import { SealError, type SealedValue, type SecretBox } from './crypto.ts';
import { GoogleApiError, toConnectorError } from './http.ts';
import { isInvalidGrant, refreshAccessToken, type TokenResponse } from './oauth.ts';
import type { ResolvedGoogleSettings } from './settings.ts';

export interface GoogleCredentials {
  refreshToken: string;
  accessToken: string | null;
  /** Access token expiry (epoch ms). */
  expiresAt: number | null;
  /** Granted scopes (space separated). */
  scope: string;
  /** Google account id and address the tokens belong to. */
  sub: string;
  email: string;
  /** Account display name (From name of sent mail when the outbox gives none). */
  name?: string | null;
}

/** Where refreshed credentials go and how a dead grant is reported (domain writes, outside connector calls). */
export interface CredentialStore {
  save(mailbox: ConnectorMailbox, sealed: SealedValue): Promise<void>;
  markNeedsReconnect(mailbox: ConnectorMailbox, message: string): Promise<void>;
}

export const RECONNECT_MESSAGES = {
  revoked: 'Google access was revoked or has expired. Reconnect the account.',
  unreadable: 'The stored Google credentials cannot be read (the encryption key changed). Reconnect the account.',
  scopes: 'Google did not grant every permission the CRM needs. Reconnect the account and allow all permissions.',
} as const;

/** Credentials from a token response (connect / reconnect). */
export function credentialsFromToken(
  token: TokenResponse,
  identity: { sub: string; email: string; name?: string | null },
  now: Date,
  previousRefreshToken?: string | null,
): GoogleCredentials {
  const refreshToken = token.refresh_token ?? previousRefreshToken;
  if (!refreshToken) throw new GoogleApiError(400, 'no_refresh_token', 'Google did not return a refresh token');
  return {
    refreshToken,
    accessToken: token.access_token,
    expiresAt: now.getTime() + Math.max(0, token.expires_in - 30) * 1000,
    scope: token.scope ?? '',
    sub: identity.sub,
    email: identity.email,
    name: identity.name ?? null,
  };
}

const fingerprint = (refreshToken: string) => createHash('sha256').update(refreshToken).digest('hex').slice(0, 16);
/** Refresh this long before the access token expires. */
const EXPIRY_MARGIN_MS = 60_000;

const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

export class GoogleTokens {
  /** Access tokens refreshed by this process, per connected account (the store may lag behind a concurrent run). */
  private readonly cache = new Map<string, { accessToken: string; expiresAt: number; refresh: string }>();
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly settings: ResolvedGoogleSettings,
    private readonly box: SecretBox,
    private readonly store: CredentialStore,
  ) {}

  private async needsReconnect(mailbox: ConnectorMailbox, message: string): Promise<never> {
    this.cache.delete(mailbox.connectedAccountId);
    await this.store.markNeedsReconnect(mailbox, message);
    throw new ConnectorError('mailbox_disconnected', message);
  }

  /** Opens the mailbox's credentials (unreadable → needs reconnection). */
  async credentials(mailbox: ConnectorMailbox): Promise<GoogleCredentials> {
    if (!mailbox.credentials) return this.needsReconnect(mailbox, RECONNECT_MESSAGES.revoked);
    try {
      return this.box.open<GoogleCredentials>(mailbox.credentials);
    } catch (err) {
      if (err instanceof SealError) return this.needsReconnect(mailbox, RECONNECT_MESSAGES.unreadable);
      throw err;
    }
  }

  /** A valid access token (refreshed when expired or `force`). */
  async accessToken(mailbox: ConnectorMailbox, options: { force?: boolean } = {}): Promise<string> {
    const creds = await this.credentials(mailbox);
    const now = this.settings.now().getTime();
    const print = fingerprint(creds.refreshToken);
    if (!options.force) {
      const cached = this.cache.get(mailbox.connectedAccountId);
      if (cached && cached.refresh === print && cached.expiresAt - EXPIRY_MARGIN_MS > now) return cached.accessToken;
      if (creds.accessToken && creds.expiresAt && creds.expiresAt - EXPIRY_MARGIN_MS > now) return creds.accessToken;
    }
    const key = mailbox.connectedAccountId;
    const pending = this.refreshing.get(key);
    if (pending) return pending;
    const run = this.refresh(mailbox, creds, print).finally(() => this.refreshing.delete(key));
    this.refreshing.set(key, run);
    return run;
  }

  private async refresh(mailbox: ConnectorMailbox, creds: GoogleCredentials, print: string): Promise<string> {
    let token: TokenResponse;
    try {
      token = await refreshAccessToken(this.settings, creds.refreshToken);
    } catch (err) {
      if (isInvalidGrant(err)) return this.needsReconnect(mailbox, RECONNECT_MESSAGES.revoked);
      throw toConnectorError(err);
    }
    const next = credentialsFromToken(token, creds, this.settings.now(), creds.refreshToken);
    if (token.scope === undefined) next.scope = creds.scope;
    this.cache.set(mailbox.connectedAccountId, {
      accessToken: next.accessToken as string,
      expiresAt: next.expiresAt as number,
      refresh: next.refreshToken === creds.refreshToken ? print : fingerprint(next.refreshToken),
    });
    await this.store.save(mailbox, this.box.seal(next));
    return next.accessToken as string;
  }

  /**
   * Runs `fn` with an access token; a 401 refreshes the token once and retries. Missing scopes mark the account as
   * needing reconnection. Other Google failures are rethrown as they are (callers handle 404 / 410 themselves and map
   * the rest with toConnectorError).
   */
  async call<T>(mailbox: ConnectorMailbox, fn: (token: string) => Promise<T>): Promise<T> {
    try {
      try {
        return await fn(await this.accessToken(mailbox));
      } catch (err) {
        if (!(err instanceof GoogleApiError) || err.status !== 401) throw err;
        return await fn(await this.accessToken(mailbox, { force: true }));
      }
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 403 && err.reason && SCOPE_REASONS.has(err.reason)) {
        return this.needsReconnect(mailbox, RECONNECT_MESSAGES.scopes);
      }
      throw err;
    }
  }
}
