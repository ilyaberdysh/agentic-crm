// Slice 7b OAuth routes over HTTP against FakeGoogle (never the network): mailboxes.authorize → /start (session,
// membership, signed state, PKCE cookie, consent URL) → Google consent (the fake) → /callback (state + cookie + session
// checks, PKCE code exchange, mailbox created / reconnected) → redirect back to the settings page; error redirects
// for denial, forged or replayed callbacks and another user's session; "not configured" without a client.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { FakeGoogle } from '@agentic-crm/domain';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  trpcError,
  WEB_ORIGIN,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;

const fake = new FakeGoogle();
let h: Harness;
let bare: Harness;
let ada: TestUser;
let max: TestUser;
const slug = `g7-${Date.now().toString(36)}`;
const GMAIL = `ada@ourco-${slug}.io`;

beforeAll(async () => {
  h = await startHarness({}, { google: { ...fake.settings, encryptionKey: randomBytes(32) } });
  bare = await startHarness({}, { google: null });
  ada = await signUp(h, 'Ada Admin');
  max = await signUp(h, 'Max Member');
  await createWorkspaceWithMembers(h, slug, [{ user: ada, admin: true }, { user: max }]);
  fake.addAccount(GMAIL, { name: 'Ada Admin' });
});

afterAll(async () => {
  await h?.close();
  await bare?.close();
});

const call = <T>(user: TestUser, path: string, input?: unknown, harness = h) =>
  trpcCall<T>(harness, path, input, { user, slug });

const get = (harness: Harness, path: string, cookie?: string) =>
  fetch(`${harness.baseUrl}${path}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });

/** `name=value` of a Set-Cookie for the OAuth cookie. */
function oauthCookie(response: Response): string {
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith('agentic_crm_google_oauth='));
  if (!cookie) throw new Error('no oauth cookie');
  return cookie.split(';')[0] as string;
}

/** authorize → /start: the Google consent URL and the cookie the browser keeps. */
async function start(user: TestUser, mailboxId?: string) {
  const { authorizationUrl } = await call<Out['mailboxes']['authorize']>(user, 'mailboxes.authorize', {
    provider: 'google',
    ...(mailboxId ? { mailboxId } : {}),
  });
  const response = await get(h, authorizationUrl, user.cookie);
  expect(response.status).toBe(302);
  return { authorizationUrl, location: response.headers.get('location') as string, cookie: oauthCookie(response) };
}

/** The callback request Google's redirect turns into, with the user's cookies. */
async function callback(redirect: string, cookies: string) {
  const url = new URL(redirect);
  const response = await get(h, `/api/integrations/google/callback${url.search}`, cookies);
  return { response, location: response.headers.get('location') ?? '' };
}

describe('Google OAuth routes', () => {
  it('connects a Gmail mailbox end to end with PKCE and a member-bound state', async () => {
    expect(await call<Out['mailboxes']['providers']>(ada, 'mailboxes.providers')).toEqual({
      google: { configured: true },
    });
    const { authorizationUrl, location, cookie } = await start(ada);
    expect(authorizationUrl).toBe(`/api/integrations/google/start?workspace=${slug}`);
    const consent = new URL(location);
    expect(`${consent.origin}${consent.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(consent.searchParams.get('redirect_uri')).toBe(fake.redirectUri);
    expect(consent.searchParams.get('access_type')).toBe('offline');
    expect(consent.searchParams.get('prompt')).toBe('consent');
    expect(consent.searchParams.get('code_challenge_method')).toBe('S256');

    const redirect = fake.consent(location, GMAIL);
    const { response, location: back } = await callback(redirect, `${ada.cookie}; ${cookie}`);
    expect(response.status).toBe(302);
    const backUrl = new URL(back);
    expect(`${backUrl.origin}${backUrl.pathname}`).toBe(`${WEB_ORIGIN}/${slug}/settings/email-and-calendar-accounts`);
    expect(backUrl.searchParams.get('google')).toBe('connected');
    // The PKCE cookie is cleared.
    expect(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith('agentic_crm_google_oauth=;') && c.includes('Max-Age=0')),
    ).toBe(true);
    // The code was exchanged with the verifier whose S256 is the challenge.
    const exchange = fake.requests.find((r) => r.path === '/token' && r.body.includes('authorization_code'));
    const verifier = new URLSearchParams(exchange?.body).get('code_verifier') as string;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(consent.searchParams.get('code_challenge'));

    const mailboxes = await call<Out['mailboxes']['list']>(ada, 'mailboxes.list');
    expect(mailboxes).toEqual([
      expect.objectContaining({
        id: backUrl.searchParams.get('mailbox'),
        providerType: 'gmail',
        emailAddress: GMAIL,
        status: 'syncing',
        isDefault: true,
      }),
    ]);
  });

  it('reconnects through the mailbox (login_hint) and comes back as reconnected', async () => {
    const [mailbox] = await call<Out['mailboxes']['list']>(ada, 'mailboxes.list');
    const { authorizationUrl, location, cookie } = await start(ada, mailbox?.id);
    expect(authorizationUrl).toContain(`mailboxId=${mailbox?.id}`);
    expect(new URL(location).searchParams.get('login_hint')).toBe(GMAIL);
    const { location: back } = await callback(fake.consent(location, GMAIL), `${ada.cookie}; ${cookie}`);
    expect(new URL(back).searchParams.get('google')).toBe('reconnected');
    expect(new URL(back).searchParams.get('mailbox')).toBe(mailbox?.id);
    // Max cannot reconnect Ada's mailbox.
    const denied = await trpcError(call(max, 'mailboxes.authorize', { provider: 'google', mailboxId: mailbox?.id }));
    expect(denied.status).toBe(404);
  });

  it('refuses forged, replayed, foreign and denied callbacks', async () => {
    const reason = (location: string) => new URL(location).searchParams.get('reason');
    const { location, cookie } = await start(ada);
    const redirect = fake.consent(location, `other@ourco-${slug}.io`);
    const url = new URL(redirect);

    // A state that was not signed by us: 400, nothing happens.
    const forged = new URL(redirect);
    forged.searchParams.set('state', `${url.searchParams.get('state')}x`);
    expect((await callback(forged.toString(), `${ada.cookie}; ${cookie}`)).response.status).toBe(400);
    // Without the browser's PKCE cookie (another browser / CSRF).
    expect(reason((await callback(redirect, ada.cookie)).location)).toBe('cookie-mismatch');
    // Another signed-in user finishing Ada's flow.
    expect(reason((await callback(redirect, `${max.cookie}; ${cookie}`)).location)).toBe('session-mismatch');
    // The legitimate callback works once; a replay of the same code fails at Google.
    expect(new URL((await callback(redirect, `${ada.cookie}; ${cookie}`)).location).searchParams.get('google')).toBe(
      'connected',
    );
    expect(reason((await callback(redirect, `${ada.cookie}; ${cookie}`)).location)).toBe('exchange-failed');

    // The user cancels on Google's consent screen.
    const second = await start(ada);
    const denied = fake.consent(second.location, GMAIL, { deny: true });
    expect(reason((await callback(denied, `${ada.cookie}; ${second.cookie}`)).location)).toBe('access-denied');

    // Unchecked permission boxes.
    const third = await start(max);
    const narrow = fake.consent(third.location, `max@ourco-${slug}.io`, {
      scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly'],
    });
    expect(reason((await callback(narrow, `${max.cookie}; ${third.cookie}`)).location)).toBe('missing-scopes');

    // Max connecting the address Ada already connected.
    const fourth = await start(max);
    const taken = fake.consent(fourth.location, GMAIL);
    expect(reason((await callback(taken, `${max.cookie}; ${fourth.cookie}`)).location)).toBe('already-connected');
  });

  it('requires a session and a membership to start', async () => {
    expect((await get(h, `/api/integrations/google/start?workspace=${slug}`)).status).toBe(401);
    const outsider = await signUp(h, 'Olga Outsider');
    expect((await get(h, `/api/integrations/google/start?workspace=${slug}`, outsider.cookie)).status).toBe(403);
    expect(
      (await get(h, `/api/integrations/google/start?workspace=${slug}&mailboxId=${randomUUID()}`, ada.cookie)).status,
    ).toBe(404);
  });

  it('without a Google client: providers says so, authorize refuses, /start sends the browser back', async () => {
    const user = await signUp(bare, 'Nora Noconfig');
    const bareSlug = `${slug}-bare`;
    await createWorkspaceWithMembers(bare, bareSlug, [{ user, admin: true }]);
    const opts = { user, slug: bareSlug };
    expect(await trpcCall(bare, 'mailboxes.providers', undefined, opts)).toEqual({ google: { configured: false } });
    const error = await trpcError(trpcCall(bare, 'mailboxes.authorize', { provider: 'google' }, opts));
    expect(error.status).toBe(400);
    expect(error.body.message).toBe('Google is not configured on this server');
    expect(error.body.additional_information?.code).toBe('PROVIDER_NOT_CONFIGURED');
    const response = await get(bare, `/api/integrations/google/start?workspace=${bareSlug}`, user.cookie);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get('location') as string).searchParams.get('reason')).toBe('not-configured');
    expect((await get(bare, '/api/integrations/google/callback?code=x&state=y')).status).toBe(503);
  });
});
