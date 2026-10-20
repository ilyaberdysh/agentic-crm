//  e2e helpers: a second workspace member (the notification recipient / sender), signed-in contexts for either
// member, and small page helpers for the palette, the inbox and the help drawer.
import { spawnSync } from 'node:child_process';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';
import { TIME_ZONE, trpc } from './slice3-support.ts';
import { credentials } from './support.ts';

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

export interface Member {
  email: string;
  password: string;
  name: string;
}

export const GRACE = { email: 'grace@mymeet.ai', name: 'Grace Hopper' };

export function ada(): Member {
  return { ...credentials(), name: E2E_USER.name };
}

let grace: Member | null = null;

function run(args: string[], extraEnv: Record<string, string>): string {
  const out = spawnSync('pnpm', ['--filter', '@agentic-crm/api', ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl(E2E_DATABASE), ...extraEnv },
    encoding: 'utf8',
  });
  if (out.status !== 0) throw new Error(`${args.join(' ')} failed:\n${out.stdout}\n${out.stderr}`);
  return out.stdout;
}

/** Grace Hopper: a second member of the seeded workspace with a known password (created once per run). */
export function secondMember(): Member {
  if (grace) return grace;
  // The seed adds the extra user as a member of the existing workspace (the first user stays the owner).
  const seeded = run(['exec', 'tsx', 'src/cli/seed.ts'], {
    SEED_USERS: `${E2E_USER.email}:${E2E_USER.name},${GRACE.email}:${GRACE.name}`,
    SEED_WORKSPACE_SLUG: WORKSPACE_SLUG,
  });
  let password = new RegExp(`${GRACE.email.replace('.', '\\.')}\\s+password: (\\S+)`).exec(seeded)?.[1];
  if (!password) {
    // Already existed (a rerun on the same database): set a fresh password.
    const reset = run(['user:create', GRACE.email, '--reset-password'], {});
    password = /Password: (\S+)/.exec(reset)?.[1];
  }
  if (!password) throw new Error('no password for the second member');
  grace = { ...GRACE, password };
  return grace;
}

export interface MemberPage {
  context: BrowserContext;
  page: Page;
}

/** A signed-in page of `member` at `path`, at the reference viewport, zone and locale. */
export async function signedInAs(
  browser: Browser,
  member: Member,
  path: string,
  options: { theme?: 'light' | 'dark'; viewport?: { width: number; height: number } } = {},
): Promise<MemberPage> {
  const theme = options.theme ?? 'light';
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1512, height: 945 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: TIME_ZONE,
  });
  await context.addInitScript((t) => {
    if (sessionStorage.getItem('e2e:init')) return;
    sessionStorage.setItem('e2e:init', '1');
    localStorage.setItem('ar:preferred-theme', t);
  }, theme);
  const page = await context.newPage();
  await page.goto(`/auth/sign-in?origin=${encodeURIComponent(`/${WORKSPACE_SLUG}/home`)}`);
  await page.getByLabel('Email address').fill(member.email);
  await page.getByLabel('Password').fill(member.password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  await page.goto(path);
  return { context, page };
}

/** The member's workspace-membership id (what mentions and assignments reference). */
export async function memberId(page: Page, email: string): Promise<string> {
  const members = await trpc<{ id: string; emailAddress: string }[]>(page, 'members.list', undefined);
  const found = members.find((m) => m.emailAddress === email);
  if (!found) throw new Error(`no member ${email}`);
  return found.id;
}

/**
 * A click on an empty spot of the page header: focuses the page without activating anything (a click lower down can
 * land on a table or task row). Waits for the UI shell first, so the shortcut listeners are installed.
 */
export async function quietClick(page: Page): Promise<void> {
  await page.getByTestId('page-header').waitFor();
  await page.mouse.click(900, 24);
}

/** Opens Quick actions with ⌘K from a quiet spot of the page. */
export async function openPalette(page: Page): Promise<void> {
  await quietClick(page);
  await page.keyboard.press(`${mod}+k`);
  await page.getByTestId('palette-input').waitFor();
}

export const paletteRows = (page: Page) => page.getByTestId('palette').getByRole('option');
