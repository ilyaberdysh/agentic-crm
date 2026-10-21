//  e2e helpers for the dashboards index, Settings → Dashboards and the Share popover: dashboards, reports,
// grants and teams created through the tRPC procedures (dashboards.*, reports.*, permissions.*, teams.*), a sign-in
// that reads this database's credentials file, and a few direct database writes for what the API cannot do
// (backdating dashboards).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultReportSettings } from '@agentic-crm/contracts';
import { createDb, sql } from '@agentic-crm/db';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { credentialsFile, databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';
import { trpc as rawTrpc, TIME_ZONE, uuid } from './slice3-support.ts';
import { credentials, submitSignIn } from './support.ts';

const here = dirname(fileURLToPath(import.meta.url));

export { uuid };

/** tRPC with retries: the shared Postgres cluster of parallel agents sometimes answers "too many clients" (500). */
export async function trpc<T = unknown>(page: Page, name: string, input: unknown): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await rawTrpc<T>(page, name, input);
    } catch (error) {
      last = error;
      if (!/: 500 /.test(String(error))) throw error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

let password: string | null = null;

/**
 * The e2e account's password in THIS run's database: the credentials file `prepare` wrote for it (one file per
 * database, so parallel stacks do not overwrite each other). Only when that file is missing is the password reset
 * through the API's user CLI — and then written back, so every other spec of the run keeps signing in.
 */
export function e2ePassword(): string {
  if (password) return password;
  try {
    password = credentials().password;
    return password;
  } catch {
    // No credentials file for this database: reset below.
  }
  const out = spawnSync('pnpm', ['--filter', '@agentic-crm/api', 'user:create', E2E_USER.email, '--reset-password'], {
    env: { ...process.env, DATABASE_URL: databaseUrl(E2E_DATABASE) },
    encoding: 'utf8',
  });
  const found = /Password: (\S+)/.exec(out.stdout)?.[1];
  if (out.status !== 0 || !found) throw new Error(`could not reset the e2e password:\n${out.stdout}\n${out.stderr}`);
  mkdirSync(join(here, '.auth'), { recursive: true });
  writeFileSync(
    join(here, '.auth', credentialsFile(E2E_DATABASE)),
    `${JSON.stringify({ email: E2E_USER.email, password: found }, null, 2)}\n`,
  );
  password = found;
  return found;
}

export interface SignedInOptions {
  viewport?: { width: number; height: number };
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  /** Extra localStorage entries (keys without the `ar:` prefix, JSON values). */
  storage?: Record<string, unknown>;
}

/** A signed-in page of the e2e account at `path` (reference viewport, zone and locale). */
export async function signedIn(
  browser: Browser,
  path: string | null,
  options: SignedInOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const theme = options.theme ?? 'light';
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1512, height: 945 },
    colorScheme: theme,
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: TIME_ZONE,
  });
  await context.addInitScript(
    ({ theme, collapsed, storage }) => {
      if (sessionStorage.getItem('e2e:init')) return;
      sessionStorage.setItem('e2e:init', '1');
      localStorage.setItem('ar:preferred-theme', theme);
      localStorage.setItem('ar:sidebar-collapsed', JSON.stringify(collapsed));
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(`ar:${k}`, JSON.stringify(v));
    },
    { theme, collapsed: options.sidebarCollapsed ?? false, storage: options.storage ?? {} },
  );
  const page = await context.newPage();
  await page.goto(`/auth/sign-in?origin=${encodeURIComponent(`/${WORKSPACE_SLUG}/home`)}`);
  await submitSignIn(page, e2ePassword());
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  if (path) await page.goto(path);
  return { context, page };
}

export interface DashboardRow {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  favoriteId: string | null;
  reportCount: number;
  reports: { id: string; title: string; reportType: string; visualisationType: string }[];
}

/** A dashboard (workspace and creator get Full access, as the "New dashboard" does). */
export async function createDashboard(page: Page, title: string, description = ''): Promise<string> {
  const id = uuid();
  await trpc(page, 'dashboards.create', { id, title, description });
  return id;
}

/** An Insight report over Companies on the dashboard (the cell goes at the end). */
export async function addReport(
  page: Page,
  dashboardId: string,
  title: string,
  visualisationType: 'bar' | 'line' | 'pie' | 'single_metric' = 'bar',
): Promise<{ reportId: string; cellId: string }> {
  const reportId = uuid();
  const cellId = uuid();
  await trpc(page, 'reports.create', {
    id: reportId,
    cellId,
    dashboardId,
    entityDefinitionId: 'companies',
    title,
    reportType: 'insights',
    visualisationType,
    settings: defaultReportSettings('insights'),
  });
  return { reportId, cellId };
}

export async function listDashboards(page: Page, scope: 'member' | 'admin' = 'member'): Promise<DashboardRow[]> {
  return trpc<DashboardRow[]>(page, 'dashboards.list', { scope });
}

export async function dashboardByTitle(
  page: Page,
  title: string,
  scope: 'member' | 'admin' = 'member',
): Promise<DashboardRow | undefined> {
  return (await listDashboards(page, scope)).find((d) => d.title === title);
}

/** Deletes every dashboard whose title starts with `prefix` (leftovers of an earlier run). */
export async function deleteDashboardsTitled(page: Page, prefix: string): Promise<void> {
  for (const d of await listDashboards(page, 'admin')) {
    if (d.title.startsWith(prefix)) await trpc(page, 'dashboards.delete', { dashboardId: d.id }).catch(() => undefined);
  }
}

export async function renameDashboard(page: Page, dashboardId: string, title: string): Promise<void> {
  await trpc(page, 'dashboards.update', { dashboardId, title });
}

/**
 * Moves a dashboard's creation time back (the date-bucket groups and "Yesterday" need older dashboards than a test can
 * create): `hours` before now, written straight to the e2e database.
 */
export async function backdateDashboard(dashboardId: string, hours: number): Promise<void> {
  const db = createDb({ connectionString: databaseUrl(E2E_DATABASE), max: 1, applicationName: 'reports-e2e' });
  try {
    await sql`UPDATE reporting_dashboards SET created_at = now() - make_interval(hours => ${hours}) WHERE id = ${dashboardId}`.execute(
      db.kysely,
    );
  } finally {
    await db.destroy();
  }
}

export interface GrantRow {
  id: string | null;
  level: 'full-access' | 'read-write' | 'read-only' | 'no-access';
  target: { type: 'workspace' | 'team' | 'member' | 'workflow'; id: string };
  targetName: string | null;
  targetDetail: string | null;
  flags: Record<string, boolean>;
}

export async function grantsOf(page: Page, dashboardId: string): Promise<GrantRow[]> {
  const out = await trpc<{ grants: GrantRow[] }>(page, 'permissions.list', {
    resourceKind: 'dashboard',
    resourceId: dashboardId,
  });
  return out.grants;
}

export async function memberIdByEmail(page: Page, email: string): Promise<string> {
  const members = await trpc<{ id: string; emailAddress: string }[]>(page, 'members.list', undefined);
  const found = members.find((m) => m.emailAddress === email);
  if (!found) throw new Error(`no member ${email}`);
  return found.id;
}

/** A team (admins only) with the given members. */
export async function createTeam(page: Page, name: string, memberIds: string[] = []): Promise<string> {
  const id = uuid();
  await trpc(page, 'teams.create', { id, name, description: '', memberIds });
  return id;
}

export async function deleteTeam(page: Page, teamId: string): Promise<void> {
  await trpc(page, 'teams.delete', { teamId }).catch(() => undefined);
}

/** Deletes every team whose name starts with `prefix` (leftovers of an earlier run). */
export async function deleteTeamsNamed(page: Page, prefix: string): Promise<void> {
  for (const t of await trpc<{ id: string; name: string }[]>(page, 'teams.list', undefined))
    if (t.name.startsWith(prefix)) await deleteTeam(page, t.id);
}

/** Puts a favourite for the member on the dashboard (the index star does the same through favorites.put). */
export async function favouriteDashboard(page: Page, dashboardId: string): Promise<void> {
  await trpc(page, 'favorites.put', { id: uuid(), favoriteType: 'reporting-dashboard', targetId: dashboardId });
}
