// Ask AI e2e helpers: a signed-in page, the chat locators, API reads of threads and a call imported through /v2, and a
// way to patch the answer of one tRPC procedure (the not-configured and out-of-credits states).
import { spawnSync } from 'node:child_process';
import { expect, type Page } from '@playwright/test';
import { API_ORIGIN, databaseUrl, E2E_DATABASE, WORKSPACE_SLUG } from './env.ts';
import { findRecord, type RecordRef, recordPath } from './record-support.ts';
import { signedInPage, trpc, ws } from './slice3-support.ts';

export type { RecordRef };
export { findRecord, recordPath, signedInPage, trpc, ws };

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** The composer's text box (full page, panel or Home). */
export const input = (page: Page) => page.getByTestId('ask-input').first();

export async function typeAndSend(page: Page, text: string): Promise<void> {
  const box = input(page);
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

/** Waits until the last assistant turn has finished (completed, failed or canceled). */
export async function answered(page: Page): Promise<void> {
  await expect(page.getByTestId('ask-assistant-turn').last()).toHaveAttribute(
    'data-status',
    /completed|failed|canceled/,
    { timeout: 20_000 },
  );
}

export const panel = (page: Page) => page.getByTestId('ask-panel');

/** Opens the side panel with ⌘J from a quiet spot of the page. */
export async function openPanel(page: Page): Promise<void> {
  await page.getByTestId('page-header').waitFor();
  await page.mouse.click(900, 24);
  await page.keyboard.press(`${mod}+j`);
  await expect(panel(page)).toBeVisible();
}

// ---- API reads ---------------------------------------------------------------------------------------------------------------

export interface ApiTurn {
  id: string;
  role: 'user' | 'assistant';
  status: string;
  parentTurnId: string | null;
  model: string | null;
  modelMode: string | null;
  parts: {
    type: string;
    content?: string;
    annotations?: { type: string }[];
    interestType?: string;
    params?: unknown;
  }[];
  steps: {
    parts: { type: string; tool?: string; toolStatus?: string | null; input?: unknown; inputAmendment?: unknown }[];
  }[];
  feedback: { type: string; issueType?: string | null; reason?: string | null } | null;
  creditCost: number | null;
}

export interface ApiThread {
  thread: { id: string; title: string | null; aiTitle: string | null; webSearchAllowed: boolean };
  turns: ApiTurn[];
}

export async function threadList(page: Page): Promise<{ id: string; title: string | null; aiTitle: string | null }[]> {
  return (
    await trpc<{ threads: { id: string; title: string | null; aiTitle: string | null }[] }>(page, 'ai.threads.list', {})
  ).threads;
}

export const threadDetail = (page: Page, threadId: string) => trpc<ApiThread>(page, 'ai.threads.get', { threadId });

/** The thread the page's URL shows (`/chats/<id>`). */
export function threadIdOf(page: Page): string {
  const id = /\/chats\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (!id) throw new Error(`not on a chat: ${page.url()}`);
  return id;
}

/** Task titles of the workspace (to check that an approved or discarded write did or did not run). */
export async function taskTitles(page: Page): Promise<string[]> {
  const out = await trpc<{ groups: { tasks: { content: { text: string } }[] }[] }>(page, 'tasks.list', {
    groupBy: 'none',
  });
  return out.groups.flatMap((g) => g.tasks.map((t) => t.content.text));
}

// ---- patching one procedure of the tRPC batch ----------------------------------------------------------------------

/**
 * Lets the real server answer, then edits the result of `procedure` (queries are batched into one request, so the
 * response is patched at the procedure's position). Used for states the stack cannot be in on demand.
 */
export async function patchTrpc(page: Page, procedure: string, patch: (data: any) => unknown): Promise<void> {
  await page.route(`**/trpc/**`, async (route) => {
    const url = new URL(route.request().url());
    const names = decodeURIComponent(url.pathname.replace(/^.*\/trpc\//, '')).split(',');
    const at = names.indexOf(procedure);
    if (at === -1) return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as unknown;
    const batched = Array.isArray(body);
    const entries = (batched ? body : [body]) as { result?: { data: unknown } }[];
    const entry = entries[batched ? at : 0];
    if (entry?.result) entry.result.data = patch(entry.result.data);
    await route.fulfill({ response, json: batched ? entries : entries[0] });
  });
}

// ---- a call imported through /v2 ---------------------------------------------------------------------------------------------

function run(args: string[], env: Record<string, string> = {}): string {
  const out = spawnSync('pnpm', ['--filter', '@agentic-crm/api', ...args], {
    env: { ...process.env, DATABASE_URL: databaseUrl(E2E_DATABASE), ...env },
    encoding: 'utf8',
  });
  if (out.status !== 0) throw new Error(`${args.join(' ')} failed:\n${out.stdout}\n${out.stderr}`);
  return out.stdout;
}

let imported: { meetingId: string; recordingId: string } | null = null;

/** The sample mymeet call imported once per run (token → POST /v2/meetings → transcript → processed). */
export async function importedCall(page: Page): Promise<{ meetingId: string; recordingId: string; title: string }> {
  if (!imported) {
    const token = /Token: (\S+)/.exec(
      run([
        'exec',
        'tsx',
        'src/cli/token-create.ts',
        WORKSPACE_SLUG,
        'e2e-ask',
        'meeting:read-write',
        'call_recording:read-write',
        'record_permission:read',
        'object_configuration:read',
        'user_management:read',
      ]),
    )?.[1];
    if (!token) throw new Error('no token');
    run(['exec', 'tsx', 'src/cli/import-mymeet-sample.ts', '--token', token, '--url', API_ORIGIN, '--wait']);
    const { items } = await trpc<{ items: { id: string; meetingId: string; title: string | null }[] }>(
      page,
      'calls.list',
      {},
    );
    const call = items[0];
    if (!call) throw new Error('the imported call is not listed');
    imported = { meetingId: call.meetingId, recordingId: call.id };
  }
  const detail = await trpc<{ title: string | null }>(page, 'calls.get', { recordingId: imported.recordingId });
  return { ...imported, title: detail.title ?? '' };
}
