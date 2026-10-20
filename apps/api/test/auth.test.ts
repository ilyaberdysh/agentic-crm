import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generatePassword } from '../src/cli/password';
import { databaseUrl } from './support/database';
import {
  authPost,
  cookieHeader,
  type Harness,
  PASSWORD,
  signUp,
  startHarness,
  uniqueEmail,
  WEB_ORIGIN,
} from './support/harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});

const whoami = (cookie?: string) => fetch(`${h.baseUrl}/api/auth/whoami`, { headers: cookie ? { cookie } : {} });

describe('sign up', () => {
  it('creates the user, signs them in and sets an standard session cookie', async () => {
    const email = uniqueEmail('signup');
    const response = await authPost(h, '/sign-up/email', { email, password: PASSWORD, name: 'Ada Lovelace' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string; email: string; name: string } };
    expect(body.user).toMatchObject({ email, name: 'Ada Lovelace' });
    expect(body.user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/); // uuidv7 from the column default

    const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('agentic-crm-session='));
    expect(setCookie).toBeDefined();
    const attributes = setCookie?.toLowerCase() ?? '';
    expect(attributes).toContain('httponly');
    expect(attributes).toContain('samesite=lax');
    expect(attributes).toContain('path=/');
    const maxAge = Number(/max-age=(\d+)/.exec(attributes)?.[1]);
    expect(maxAge).toBe(180 * 24 * 60 * 60);
    expect(attributes).not.toContain('secure'); // http://localhost; Secure is set when publicUrl is https

    const me = await whoami(cookieHeader(response));
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: Record<string, unknown> };
    expect(meBody.user).toMatchObject({
      id: body.user.id,
      email_address: email,
      name: { first: 'Ada', last: 'Lovelace', full: 'Ada Lovelace' },
    });
    expect(typeof meBody.user.user_auth_session_id).toBe('string');
  });

  it('normalises the email and rejects a duplicate', async () => {
    const email = uniqueEmail('dup');
    await signUp(h, 'First', email);
    const again = await authPost(h, '/sign-up/email', { email: email.toUpperCase(), password: PASSWORD, name: 'X' });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const body = (await again.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ statusCode: again.status, status_code: again.status });
    expect(typeof body.message).toBe('string');
  });

  it('rejects a short password with the error envelope', async () => {
    const response = await authPost(h, '/sign-up/email', { email: uniqueEmail(), password: 'short', name: 'X' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      status_code: 400,
      additional_information: { code: 'PASSWORD_TOO_SHORT' },
    });
  });
});

describe('sign in', () => {
  it('signs in with the right password', async () => {
    const user = await signUp(h, 'Grace Hopper');
    const response = await authPost(h, '/sign-in/email', { email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    const cookie = cookieHeader(response);
    expect(cookie).toContain('agentic-crm-session=');
    expect((await whoami(cookie)).status).toBe(200);
    // Each sign-in is its own session (the public API auth sessions).
    const sessions = await h.db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [user.id]);
    expect(sessions.rows[0]?.n).toBe(2);
  });

  it('answers a wrong password with 401 in the public API envelope and no cookie', async () => {
    const user = await signUp(h);
    const response = await authPost(h, '/sign-in/email', { email: user.email, password: 'wrong-password' });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie().some((c) => c.startsWith('agentic-crm-session='))).toBe(false);
    expect(await response.json()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid email or password',
      status_code: 401,
      additional_information: { code: 'INVALID_EMAIL_OR_PASSWORD' },
      code: 'INVALID_EMAIL_OR_PASSWORD',
    });
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    const response = await authPost(h, '/sign-in/email', { email: uniqueEmail('nobody'), password: PASSWORD });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { message: string }).message).toBe('Invalid email or password');
  });
});

describe('session', () => {
  it('whoami without a session is the public API’s 401', async () => {
    const response = await whoami();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'The requesting user did not present an authentication token',
      status_code: 401,
    });
  });

  it('rejects a tampered cookie', async () => {
    const user = await signUp(h);
    const tampered = user.cookie.replace(/agentic-crm-session=([^.;]+)/, 'agentic-crm-session=AAAA$1');
    expect((await whoami(tampered)).status).toBe(401);
  });

  it('get-session returns the user and session', async () => {
    const user = await signUp(h, 'Session Reader');
    const response = await fetch(`${h.baseUrl}/api/auth/get-session`, { headers: { cookie: user.cookie } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string }; session: { userId: string; expiresAt: string } };
    expect(body.user.id).toBe(user.id);
    expect(body.session.userId).toBe(user.id);
    const days = (new Date(body.session.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179);
  });

  it('an expired session is signed out', async () => {
    const user = await signUp(h);
    await h.db.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [user.id]);
    expect((await whoami(user.cookie)).status).toBe(401);
  });
});

describe('sign out', () => {
  it('POST /api/auth/sign-out ends the session and clears the cookie', async () => {
    const user = await signUp(h);
    const response = await authPost(h, '/sign-out', {}, user.cookie);
    expect(response.status).toBe(200);
    const cleared = response.headers.getSetCookie().find((c) => c.startsWith('agentic-crm-session='));
    expect(cleared?.toLowerCase()).toContain('max-age=0');
    expect((await whoami(user.cookie)).status).toBe(401);
    const sessions = await h.db.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [user.id]);
    expect(sessions.rows[0]?.n).toBe(0);
  });

  it('GET /api/auth/logout ends the session and redirects to the sign-in page', async () => {
    const user = await signUp(h);
    const response = await fetch(`${h.baseUrl}/api/auth/logout`, {
      headers: { cookie: user.cookie },
      redirect: 'manual',
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/auth/sign-in');
    expect(response.headers.getSetCookie().some((c) => /^agentic-crm-session=;/.test(c) || /max-age=0/i.test(c))).toBe(
      true,
    );
    expect((await whoami(user.cookie)).status).toBe(401);
  });

  it('rejects a cross-site sign-out (Better Auth origin check)', async () => {
    const user = await signUp(h);
    const response = await fetch(`${h.baseUrl}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: user.cookie },
      body: '{}',
    });
    expect(response.status).toBe(403);
    expect((await whoami(user.cookie)).status).toBe(200);
  });
});

describe('admin CLI', () => {
  it('generates readable passwords', () => {
    const password = generatePassword();
    expect(password).toHaveLength(20);
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
  });

  it('user:create creates an account that can sign in with the printed password', async () => {
    const email = uniqueEmail('cli');
    const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    const run = promisify(execFile);
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', 'src/cli/user-create.ts', email.toUpperCase(), 'Team', 'Member'],
      { cwd: apiDir, env: { ...process.env, DATABASE_URL: databaseUrl() } },
    );
    const password = /Password: (\S+)/.exec(stdout)?.[1];
    expect(password).toBeDefined();
    const response = await authPost(h, '/sign-in/email', { email, password });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { name: string; emailVerified: boolean } };
    expect(body.user).toMatchObject({ name: 'Team Member', emailVerified: true });

    // A second run without --reset-password refuses; with it, the old password stops working.
    await expect(
      run(process.execPath, ['--import', 'tsx', 'src/cli/user-create.ts', email, 'Again'], {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: databaseUrl() },
      }),
    ).rejects.toThrow(/already exists/);
    const reset = await run(
      process.execPath,
      ['--import', 'tsx', 'src/cli/user-create.ts', email, '--reset-password'],
      {
        cwd: apiDir,
        env: { ...process.env, DATABASE_URL: databaseUrl() },
      },
    );
    const newPassword = /Password: (\S+)/.exec(reset.stdout)?.[1];
    expect((await authPost(h, '/sign-in/email', { email, password })).status).toBe(401);
    expect((await authPost(h, '/sign-in/email', { email, password: newPassword })).status).toBe(200);
  }, 60_000);
});

describe('http basics', () => {
  it('answers unknown routes with the 404 envelope and a request id', async () => {
    const response = await fetch(`${h.baseUrl}/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(await response.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Route GET:/nope not found',
      status_code: 404,
    });
  });

  it('echoes a client request id', async () => {
    const response = await fetch(`${h.baseUrl}/api/health`, { headers: { 'x-request-id': 'req-1234567890' } });
    expect(response.headers.get('x-request-id')).toBe('req-1234567890');
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('reports readiness with the database and realtime state', async () => {
    const response = await fetch(`${h.baseUrl}/api/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', database: 'ok', realtime: { feed: { ready: true } } });
  });

  it('allows CORS with credentials for the web origin only', async () => {
    const ok = await fetch(`${h.baseUrl}/trpc/me`, {
      method: 'OPTIONS',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe(WEB_ORIGIN);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    const evil = await fetch(`${h.baseUrl}/trpc/me`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });
});
