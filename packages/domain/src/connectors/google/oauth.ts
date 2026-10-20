// Google OAuth 2.0 web-server flow with PKCE (7.09) for the Internal Workspace app:
//   start    → signed `state` {nonce, workspace, member, slug, reconnect mailbox, expiry} in the authorization URL and
//              a sealed cookie {nonce, PKCE verifier} on the browser (the verifier never leaves our side unsealed)
//   callback → state signature + expiry + cookie nonce checked, code exchanged with the verifier, account identity
//              read from the OpenID userinfo endpoint
// `access_type=offline` + `prompt=consent` make Google return a refresh token on every connect (also on reconnect).
import { createHash, randomBytes } from 'node:crypto';
import type { SecretBox } from './crypto.ts';
import { GoogleApiError, googleRequest } from './http.ts';
import { GOOGLE_SCOPES, type ResolvedGoogleSettings } from './settings.ts';

/** How long a started authorization stays valid (state expiry and cookie Max-Age). */
export const OAUTH_TTL_SECONDS = 10 * 60;

/** Signed into `state` (integrity-protected, readable). */
export interface OAuthState {
  /** Nonce shared with the cookie (binds the callback to the browser that started it). */
  n: string;
  /** Workspace id. */
  w: string;
  /** Member id who started it. */
  m: string;
  /** Workspace slug (where to send the browser back). */
  s: string;
  /** Mailbox being reconnected, if any. */
  b: string | null;
  /** Expiry (epoch ms). */
  e: number;
}

/** Sealed into the cookie (secret). */
export interface OAuthCookie {
  n: string;
  /** PKCE code verifier. */
  v: string;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export interface GoogleIdentity {
  /** Stable Google account id. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export interface BeginAuthorizationInput {
  workspaceId: string;
  memberId: string;
  slug: string;
  /** Reconnect this mailbox (its address is passed to Google as login_hint). */
  mailboxId?: string | null;
  loginHint?: string | null;
}

export interface BegunAuthorization {
  /** Google's consent page. */
  url: string;
  /** Value of the sealed cookie the browser must carry back to the callback. */
  cookie: string;
  state: string;
  maxAgeSeconds: number;
}

export function beginAuthorization(
  settings: ResolvedGoogleSettings,
  box: SecretBox,
  input: BeginAuthorizationInput,
): BegunAuthorization {
  const nonce = randomBytes(16).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const state = box.sign({
    n: nonce,
    w: input.workspaceId,
    m: input.memberId,
    s: input.slug,
    b: input.mailboxId ?? null,
    e: settings.now().getTime() + OAUTH_TTL_SECONDS * 1000,
  } satisfies OAuthState);
  const url = new URL(settings.endpoints.authorize);
  const params: Record<string, string> = {
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  };
  if (input.loginHint) params.login_hint = input.loginHint;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    url: url.toString(),
    cookie: box.sealCompact({ n: nonce, v: verifier } satisfies OAuthCookie),
    state,
    maxAgeSeconds: OAUTH_TTL_SECONDS,
  };
}

export type VerifiedAuthorization =
  | { ok: true; state: OAuthState; verifier: string }
  | { ok: false; reason: 'invalid-state' | 'expired' | 'cookie-mismatch'; state: OAuthState | null };

/** Checks the callback's `state` against its signature, expiry and the browser's cookie. */
export function verifyAuthorization(
  settings: ResolvedGoogleSettings,
  box: SecretBox,
  input: { state: string | null | undefined; cookie: string | null | undefined },
): VerifiedAuthorization {
  const state = input.state ? box.verify<OAuthState>(input.state) : null;
  if (!state || typeof state.n !== 'string' || typeof state.w !== 'string' || typeof state.m !== 'string') {
    return { ok: false, reason: 'invalid-state', state: null };
  }
  if (typeof state.e !== 'number' || state.e < settings.now().getTime()) return { ok: false, reason: 'expired', state };
  const cookie = input.cookie ? box.openCompact<OAuthCookie>(input.cookie) : null;
  if (!cookie || cookie.n !== state.n || typeof cookie.v !== 'string') {
    return { ok: false, reason: 'cookie-mismatch', state };
  }
  return { ok: true, state, verifier: cookie.v };
}

export function exchangeCode(settings: ResolvedGoogleSettings, code: string, verifier: string): Promise<TokenResponse> {
  return googleRequest<TokenResponse>(settings, {
    method: 'POST',
    url: settings.endpoints.token,
    form: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirectUri,
    },
  });
}

export function refreshAccessToken(settings: ResolvedGoogleSettings, refreshToken: string): Promise<TokenResponse> {
  return googleRequest<TokenResponse>(settings, {
    method: 'POST',
    url: settings.endpoints.token,
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
    },
  });
}

/** The refresh token was revoked, expired or the client changed: only a new consent helps. */
export const isInvalidGrant = (err: unknown) =>
  err instanceof GoogleApiError && (err.reason === 'invalid_grant' || err.reason === 'unauthorized_client');

export async function fetchUserInfo(settings: ResolvedGoogleSettings, accessToken: string): Promise<GoogleIdentity> {
  const info = await googleRequest<{ sub?: string; email?: string; email_verified?: boolean; name?: string }>(
    settings,
    { url: settings.endpoints.userinfo, token: accessToken },
  );
  if (!info?.sub || !info.email)
    throw new GoogleApiError(502, 'no_identity', 'Google did not return the account email');
  return {
    sub: info.sub,
    email: info.email,
    emailVerified: info.email_verified !== false,
    name: info.name ?? null,
  };
}

/** Scopes of a token response (space separated). */
export const grantedScopes = (token: Pick<TokenResponse, 'scope'>) => new Set((token.scope ?? '').split(/\s+/));
