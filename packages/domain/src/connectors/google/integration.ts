// Google integration wiring (7.09): the gmail connector with a database-backed credential store, and the two halves
// of the OAuth connect flow the API's /api/integrations/google routes call:
//   begin    → Google consent URL + sealed PKCE cookie (signed state bound to member + workspace)
//   verify   → state signature / expiry / cookie nonce
//   complete → code exchange, granted scopes, account identity, send-as aliases, then one domain transaction that
//              creates or reconnects the mailbox (credentials sealed) and queues its first sync

import type { Mailbox } from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import { type ServiceContext, systemContext } from '../../context.ts';
import { accountOps, mailboxOps } from '../../email/mailboxes.ts';
import { runInWorkspace, type Tx } from '../../tx.ts';
import { GoogleConnector } from './connector.ts';
import { SecretBox } from './crypto.ts';
import { sendAsAliases } from './gmail.ts';
import { GoogleApiError } from './http.ts';
import {
  type BeginAuthorizationInput,
  beginAuthorization,
  exchangeCode,
  fetchUserInfo,
  grantedScopes,
  type OAuthState,
  type TokenResponse,
  verifyAuthorization,
} from './oauth.ts';
import { type GoogleSettings, REQUIRED_SCOPES, resolveGoogleSettings } from './settings.ts';
import { type CredentialStore, credentialsFromToken } from './tokens.ts';

/** Why a connect attempt failed (the API sends the browser back with `?google=error&reason=<reason>`). */
export type GoogleConnectFailure =
  | 'exchange-failed'
  | 'missing-scopes'
  | 'no-refresh-token'
  | 'unverified-email'
  | 'google-unavailable';

export class GoogleConnectError extends Error {
  readonly reason: GoogleConnectFailure;

  constructor(reason: GoogleConnectFailure, message: string) {
    super(message);
    this.name = 'GoogleConnectError';
    this.reason = reason;
  }
}

export interface GoogleIntegrationDeps {
  database: Database;
  settings: GoogleSettings;
  /** Queues the mailbox's sync in the connecting transaction (no-op without jobs). */
  queueSync: (tx: Tx, mailboxId: string) => Promise<void>;
}

export function createGoogleIntegration(deps: GoogleIntegrationDeps) {
  const settings = resolveGoogleSettings(deps.settings);
  const box = new SecretBox(settings.encryptionKey);
  const asSync = (workspaceId: string) => systemContext(workspaceId, 'mail-sync');
  const store: CredentialStore = {
    save: (mailbox, sealed) =>
      runInWorkspace(deps.database, asSync(mailbox.workspaceId), (tx) =>
        accountOps.saveCredentials(tx, mailbox.connectedAccountId, sealed),
      ),
    markNeedsReconnect: (mailbox, message) =>
      runInWorkspace(deps.database, asSync(mailbox.workspaceId), (tx) =>
        accountOps.markNeedsReconnect(tx, mailbox.connectedAccountId, message),
      ),
  };
  const connector = new GoogleConnector({ settings, box, store });

  return {
    connector,
    redirectUri: settings.redirectUri,

    /** Starts a connect (or reconnect): Google's consent URL and the cookie the browser must bring back. */
    begin: (input: BeginAuthorizationInput) => beginAuthorization(settings, box, input),

    /** Checks the callback's state and cookie. */
    verify: (input: { state: string | null | undefined; cookie: string | null | undefined }) =>
      verifyAuthorization(settings, box, input),

    /**
     * Finishes a verified callback as the member who started it: exchanges the code, checks the consent, reads the
     * account and creates or reconnects its mailbox (then queues the sync).
     */
    async complete(
      ctx: ServiceContext,
      input: { code: string; state: OAuthState; verifier: string },
    ): Promise<{ mailbox: Mailbox; reconnected: boolean }> {
      let token: TokenResponse;
      try {
        token = await exchangeCode(settings, input.code, input.verifier);
      } catch (err) {
        if (err instanceof GoogleApiError && err.status < 500) {
          throw new GoogleConnectError('exchange-failed', `Google refused the authorization code: ${err.message}`);
        }
        throw new GoogleConnectError('google-unavailable', 'Google could not be reached');
      }
      const scopes = grantedScopes(token);
      if (REQUIRED_SCOPES.some((s) => !scopes.has(s))) {
        throw new GoogleConnectError('missing-scopes', 'Not every requested permission was granted');
      }
      if (!token.refresh_token) {
        throw new GoogleConnectError('no-refresh-token', 'Google did not return a refresh token');
      }
      let identity: Awaited<ReturnType<typeof fetchUserInfo>>;
      try {
        identity = await fetchUserInfo(settings, token.access_token);
      } catch {
        throw new GoogleConnectError('google-unavailable', 'The Google account could not be read');
      }
      if (!identity.emailVerified) {
        throw new GoogleConnectError('unverified-email', 'The Google account address is not verified');
      }
      const credentials = credentialsFromToken(token, identity, settings.now());
      const aliases = await sendAsAliases(settings, token.access_token).catch(() => [] as string[]);
      return runInWorkspace(deps.database, ctx, async (tx) => {
        const result = await mailboxOps.connectOAuth(tx, {
          provider: 'gmail',
          emailAddress: identity.email,
          externalAccountId: identity.sub,
          credentials: box.seal(credentials),
          aliases,
          reconnectMailboxId: input.state.b,
        });
        await deps.queueSync(tx, result.mailbox.id);
        return result;
      });
    },
  };
}

export type GoogleIntegration = ReturnType<typeof createGoogleIntegration>;
