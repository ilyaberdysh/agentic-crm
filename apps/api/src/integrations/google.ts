// Google OAuth web-server flow for Gmail + Google Calendar mailboxes (slice 7b, BACKLOG 7.09):
//   GET /api/integrations/google/start?workspace=<slug>[&mailboxId=<id>]
//       session + membership checked; a signed state (member + workspace + optional mailbox to reconnect, 10 min) and
//       a sealed PKCE cookie (Path=/api/integrations/google, HttpOnly, SameSite=Lax) are minted; 302 to Google consent
//   GET /api/integrations/google/callback?code&state | ?error&state
//       state signature / expiry and the cookie's nonce checked (400 on a forged state), the signed-in member must be
//       the one who started it; the code is exchanged (PKCE), the mailbox created or reconnected through the domain
//       (which queues its first sync), then 302 back to Settings → Email and calendar accounts with
//       `?google=connected&mailbox=<id>` or `?google=error&reason=<reason>`
// The web reaches /start through its own origin (the Vite proxy in dev); Google redirects to GOOGLE_REDIRECT_URI
// (default http://localhost:4100/api/integrations/google/callback). Cookies are per host, not per port, so the
// session and the PKCE cookie reach the callback as long as the app is opened on the same host name (localhost).
import { type Domain, DomainError, GoogleConnectError, memberContext } from '@agentic-crm/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth';
import { getRequestSession } from '../auth/session';
import type { ApiConfig } from '../config';
import { envelope, UNAUTHENTICATED_MESSAGE } from '../errors';
import type { WorkspaceResolver } from '../workspaces/resolver';

export const GOOGLE_START_PATH = '/api/integrations/google/start';
export const GOOGLE_CALLBACK_PATH = '/api/integrations/google/callback';
export const GOOGLE_OAUTH_COOKIE = 'agentic_crm_google_oauth';
const COOKIE_PATH = '/api/integrations/google';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/i;

export interface GoogleRouteDeps {
  auth: Auth;
  workspaces: WorkspaceResolver;
  domain: Domain;
  config: Pick<ApiConfig, 'webOrigin'>;
}

/** Why the browser came back without a mailbox (`?google=error&reason=…`); the web turns these into messages. */
export type GoogleReturnReason =
  | 'not-configured'
  | 'access-denied'
  | 'google-error'
  | 'invalid-state'
  | 'expired'
  | 'cookie-mismatch'
  | 'session-mismatch'
  | 'already-connected'
  | 'account-mismatch'
  | 'exchange-failed'
  | 'missing-scopes'
  | 'no-refresh-token'
  | 'unverified-email'
  | 'google-unavailable'
  | 'unexpected';

/** The mailbox settings page of the workspace, with the outcome in the query. */
export function settingsUrl(webOrigin: string, slug: string, params: Record<string, string>): string {
  const url = new URL(
    `${webOrigin.replace(/\/+$/, '')}/${encodeURIComponent(slug)}/settings/email-and-calendar-accounts`,
  );
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function oauthCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${GOOGLE_OAUTH_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

type StartRequest = FastifyRequest<{ Querystring: { workspace?: string; mailboxId?: string } }>;
type CallbackRequest = FastifyRequest<{
  Querystring: { code?: string; state?: string; error?: string; scope?: string };
}>;

function reasonOf(err: unknown): GoogleReturnReason | null {
  if (err instanceof GoogleConnectError) return err.reason;
  if (err instanceof DomainError) {
    if (err.code === 'MAILBOX_ALREADY_CONNECTED') return 'already-connected';
    if (err.code === 'MAILBOX_ACCOUNT_MISMATCH') return 'account-mismatch';
  }
  return null;
}

export async function registerGoogleIntegrationRoutes(app: FastifyInstance, deps: GoogleRouteDeps): Promise<void> {
  // Secure whenever the callback is https (a Secure cookie would never come back to an http callback).
  const secure = deps.domain.integrations.google?.redirectUri.startsWith('https://') ?? false;

  app.get(GOOGLE_START_PATH, async (request: StartRequest, reply: FastifyReply) => {
    const session = await getRequestSession(deps.auth, request.headers, reply);
    if (!session) return reply.status(401).send(envelope(401, UNAUTHENTICATED_MESSAGE));
    const slug = request.query.workspace ?? '';
    if (!SLUG.test(slug)) return reply.status(400).send(envelope(400, 'A workspace is required'));
    const resolution = await deps.workspaces.resolve(session.user.id, { slug });
    if (resolution.status === 'not-found') return reply.status(404).send(envelope(404, 'Workspace not found'));
    if (resolution.status === 'not-member') {
      return reply.status(403).send(envelope(403, 'You are not a member of this workspace'));
    }
    const google = deps.domain.integrations.google;
    if (!google)
      return reply.redirect(
        settingsUrl(deps.config.webOrigin, slug, { google: 'error', reason: 'not-configured' }),
        302,
      );
    const workspaceId = resolution.workspace.id;
    const memberId = resolution.membership.id;
    let loginHint: string | null = null;
    const mailboxId = request.query.mailboxId;
    if (mailboxId !== undefined) {
      if (!UUID.test(mailboxId)) return reply.status(404).send(envelope(404, 'Mailbox not found'));
      // Owner check (others' mailboxes do not exist for the caller); only Google mailboxes reconnect here.
      const mailbox = await deps.domain.mailboxes.get(memberContext(workspaceId, memberId), mailboxId);
      if (mailbox.providerType !== 'gmail') {
        return reply.status(400).send(envelope(400, 'Only Google mailboxes reconnect through Google'));
      }
      loginHint = mailbox.emailAddress;
    }
    const begun = google.begin({ workspaceId, memberId, slug, mailboxId: mailboxId ?? null, loginHint });
    reply.header('set-cookie', oauthCookie(begun.cookie, begun.maxAgeSeconds, secure));
    reply.header('cache-control', 'no-store');
    return reply.redirect(begun.url, 302);
  });

  app.get(GOOGLE_CALLBACK_PATH, async (request: CallbackRequest, reply: FastifyReply) => {
    const google = deps.domain.integrations.google;
    if (!google) return reply.status(503).send(envelope(503, 'Google is not configured on this server'));
    reply.header('set-cookie', oauthCookie('', 0, secure));
    reply.header('cache-control', 'no-store');
    const verified = google.verify({
      state: request.query.state,
      cookie: readCookie(request.headers.cookie, GOOGLE_OAUTH_COOKIE),
    });
    if (!verified.state) return reply.status(400).send(envelope(400, 'Invalid OAuth state'));
    const { state } = verified;
    const back = (params: Record<string, string>) =>
      reply.redirect(settingsUrl(deps.config.webOrigin, state.s, params), 302);
    const fail = (reason: GoogleReturnReason) => back({ google: 'error', reason });
    if (!verified.ok) return fail(verified.reason);
    if (request.query.error) return fail(request.query.error === 'access_denied' ? 'access-denied' : 'google-error');
    const code = request.query.code;
    if (!code) return fail('google-error');

    // The member who started the flow must be the one signed in now.
    const session = await getRequestSession(deps.auth, request.headers, reply);
    if (!session) return fail('session-mismatch');
    const resolution = await deps.workspaces.resolve(session.user.id, { slug: state.s });
    if (resolution.status !== 'ok' || resolution.workspace.id !== state.w || resolution.membership.id !== state.m) {
      return fail('session-mismatch');
    }
    try {
      const { mailbox, reconnected } = await google.complete(memberContext(state.w, state.m), {
        code,
        state,
        verifier: verified.verifier,
      });
      return back({ google: reconnected ? 'reconnected' : 'connected', mailbox: mailbox.id });
    } catch (err) {
      const reason = reasonOf(err);
      if (!reason) request.log.error({ err }, 'google connect failed');
      return fail(reason ?? 'unexpected');
    }
  });
}
