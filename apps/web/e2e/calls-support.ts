// Calls e2e helpers: an API token for the mymeet import, mymeet calls imported through the public /v2 path
// (`apps/api/src/cli/import-mymeet-sample.ts`, the reference client of), and small page helpers.
// The stack runs with AGENTIC_CRM_LLM=fake (playwright.config.ts), so summaries and insights come from the fixtures in
// packages/domain/src/ai/fixtures/calls.json.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { importMymeetCall, type MymeetCall, mymeetCallSchema } from '../../api/src/cli/import-mymeet-sample.ts';
import { API_ORIGIN, databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';
import { trpc, ws } from './slice3-support.ts';

export const NORTHWIND_TITLE = '[seed] Discovery call — Northwind';

const fixture = (name: string): MymeetCall =>
  mymeetCallSchema.parse(
    JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')),
  );

let token: string | null = null;

/** A workspace API token with the scopes the mymeet import needs (created once per run through the CLI). */
export function importToken(): string {
  if (token) return token;
  const run = spawnSync(
    'pnpm',
    [
      '--filter',
      '@agentic-crm/api',
      'token:create',
      WORKSPACE_SLUG,
      `calls-e2e-${Date.now()}`,
      'meeting:read-write',
      'call_recording:read-write',
      'record_permission:read',
      'user_management:read',
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl(E2E_DATABASE) }, encoding: 'utf8' },
  );
  const found = /Token: (\S+)/.exec(run.stdout);
  if (run.status !== 0 || !found?.[1]) throw new Error(`token:create failed:\n${run.stdout}\n${run.stderr}`);
  token = found[1];
  return token;
}

export interface ImportedCall {
  meetingId: string;
  recordingId: string;
}

/** Imports a mymeet call through /v2 and waits until it is `completed` (speakers mapped, summaries written). */
export async function importCall(
  options: { title?: string; file?: string; wait?: boolean } = {},
): Promise<ImportedCall & { status: string }> {
  const call = fixture(options.file ?? 'calls-northwind.json');
  if (options.title) call.meeting.title = options.title;
  const result = await importMymeetCall({
    baseUrl: API_ORIGIN,
    token: importToken(),
    call,
    organizerEmail: E2E_USER.email,
    wait: options.wait ?? true,
  });
  return { meetingId: result.meetingId, recordingId: result.recordingId, status: result.status };
}

interface ListedCall {
  id: string;
  meetingId: string;
  title: string | null;
}

/** The "[seed] Discovery call — Northwind" call: imported once per database, found again on reruns. */
export async function ensureNorthwind(page: Page): Promise<ImportedCall> {
  const found = await trpc<{ items: ListedCall[] }>(page, 'calls.list', { query: NORTHWIND_TITLE, groupBy: 'none' });
  const existing = found.items.find((c) => c.title === NORTHWIND_TITLE);
  if (existing) return { meetingId: existing.meetingId, recordingId: existing.id };
  const { meetingId, recordingId } = await importCall({ title: NORTHWIND_TITLE });
  return { meetingId, recordingId };
}

export const callUrl = (call: ImportedCall, tab = 'transcript'): string =>
  ws(`calls/${call.meetingId}/${call.recordingId}/${tab}`);

/** Deletes every call whose title starts with `prefix` (tests clean up their own imports). */
export async function deleteCallsLike(page: Page, prefix: string): Promise<void> {
  const list = await trpc<{ items: ListedCall[] }>(page, 'calls.list', { query: prefix, groupBy: 'none' });
  for (const c of list.items) if (c.title?.startsWith(prefix)) await trpc(page, 'calls.delete', { recordingId: c.id });
}
