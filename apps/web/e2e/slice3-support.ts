// Slice-3 e2e helpers (notes, tasks, comments, favorites, overlays): the seeded data (seed-slice3.ts, once per run),
// signed-in contexts at the reference viewport and zone, and tRPC calls for setup.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { E2E_DATABASE, WORKSPACE_SLUG } from './env.ts';
import { submitSignIn } from './support.ts';

const here = dirname(fileURLToPath(import.meta.url));

/** The Attio captures were taken in Europe/Moscow; en-US keeps Sunday weeks ("This week" ends Saturday). */
export const TIME_ZONE = 'Europe/Moscow';

export interface Slice3Seed {
  workspaceId: string;
  memberId: string;
  companiesId: string;
  projectsId: string;
  northwind: string;
  cedar: string;
  projects: string[];
  notes: Record<string, string>;
  templateId: string;
  tasks: Record<string, string>;
  thread: { threadId: string; rootId: string; recordId: string };
  resolvedThreadId: string;
}

let seeded: Slice3Seed | null = null;

export function seedSlice3(): Slice3Seed {
  if (seeded) return seeded;
  const run = spawnSync(
    'pnpm',
    [
      '--filter',
      '@agentic-crm/api',
      'exec',
      'tsx',
      join(here, 'seed-slice3.ts'),
      '--db',
      E2E_DATABASE,
      '--tz',
      TIME_ZONE,
    ],
    { env: process.env, encoding: 'utf8' },
  );
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    throw new Error('[e2e] seeding slice 3 failed');
  }
  const last = run.stdout.trim().split('\n').pop() ?? '{}';
  seeded = JSON.parse(last) as Slice3Seed;
  return seeded;
}

export interface ContextOptions {
  viewport?: { width: number; height: number };
  theme?: 'light' | 'dark';
  sidebarCollapsed?: boolean;
  /** Extra localStorage entries (keys without the `ar:` prefix, JSON values). */
  storage?: Record<string, unknown>;
}

export async function signedInPage(
  browser: Browser,
  path: string,
  options: ContextOptions = {},
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
  await submitSignIn(page);
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  await page.goto(path);
  return { context, page };
}

export async function trpc<T>(page: Page, name: string, input: unknown): Promise<T> {
  const response = await page.request.post(`/trpc/${name}`, {
    headers: { 'content-type': 'application/json', 'x-workspace-slug': WORKSPACE_SLUG },
    data: input,
  });
  if (!response.ok()) throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return ((await response.json()) as { result: { data: T } }).result.data;
}

export const ws = (path: string) => `/${WORKSPACE_SLUG}/${path}`;

export function uuid(): string {
  return crypto.randomUUID();
}

/** Removes the member's favourites and folders (the parity run leaves some behind). */
export async function clearFavorites(page: Page): Promise<void> {
  const list = await trpc<{ favorites: { id: string }[]; directories: { id: string }[] }>(
    page,
    'favorites.list',
    undefined,
  );
  for (const d of list.directories) await trpc(page, 'favorites.deleteDirectory', { directoryId: d.id });
  for (const f of list.favorites) await trpc(page, 'favorites.delete', { favoriteId: f.id });
}
