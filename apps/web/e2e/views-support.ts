// Helpers for the views e2e specs: tRPC calls from the signed-in page and a "[seed] All projects" view that mirrors
// the column set of Attio's study view (C1 README §10), so screenshots line up with evidence/C1.
import { expect, type Page } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { submitSignIn } from './support.ts';

export const DEV_PATH = `/${WORKSPACE_SLUG}/__dev/views`;

/** POSTs one tRPC procedure (queries go as POST: the client uses methodOverride). */
export async function trpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ procedure, input, slug }) => {
      const res = await fetch(`/trpc/${procedure}?batch=1`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-workspace-slug': slug },
        body: JSON.stringify({ 0: input }),
      });
      const body = (await res.json()) as [{ result?: { data: unknown }; error?: { message: string } }];
      if (!res.ok || body[0]?.error) throw new Error(`${procedure}: ${JSON.stringify(body[0]?.error ?? res.status)}`);
      return body[0]?.result?.data as never;
    },
    { procedure, input, slug: WORKSPACE_SLUG },
  );
}

export async function signInTo(page: Page, path: string): Promise<void> {
  await page.goto(`/auth/sign-in?origin=${encodeURIComponent(path)}`);
  await submitSignIn(page);
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  if (!page.url().includes(path)) await page.goto(path);
}

interface Attr {
  id: string;
  apiSlug: string;
  entityDefinitionId: string;
  systemAttributeType: string | null;
}

export interface SeedView {
  id: string;
  objectId: string;
}

function uuidv7(): string {
  const ms = Date.now().toString(16).padStart(12, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${rand.slice(0, 3)}-${((Number.parseInt(rand.slice(3, 4), 16) & 0x3) | 0x8).toString(16)}${rand.slice(4, 7)}-${rand.slice(7, 19)}`;
}

/** Creates "[seed] All projects" on Projects with Attio's study column set; returns its id. */
export async function createSeedView(page: Page, title = '[seed] All projects'): Promise<SeedView> {
  const objects = await trpc<{ id: string; apiSlug: string; entityType: string }[]>(page, 'schema.objects.list', {
    includeArchived: true,
  });
  const projects = objects.find((o) => o.apiSlug === 'projects');
  const tasks = objects.find((o) => o.entityType === 'task');
  if (!projects || !tasks) throw new Error('seeded objects missing');
  const attrs = await trpc<Attr[]>(page, 'schema.attributes.list', { entityDefinitionId: projects.id });
  const taskAttrs = await trpc<Attr[]>(page, 'schema.attributes.list', { entityDefinitionId: tasks.id });
  const by = (slug: string) => {
    const a = attrs.find((x) => x.apiSlug === slug);
    if (!a) throw new Error(`no attribute ${slug}`);
    return { entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id };
  };
  const deadline = taskAttrs.find((a) => a.systemAttributeType === 'task-deadline');
  const columns = [
    ['code'],
    ['summary'],
    ['budget'],
    ['headcount'],
    ['strategic'],
    ['start_date'],
    ['kickoff_at'],
    ['phase'],
    ['tags'],
    ['health'],
    ['stakeholders'],
    ['owner'],
    ['created_at'],
    ...(deadline ? [['next_due_task', 'deadline']] : []),
    ['priority'],
    ['created_by'],
  ].map((slugs) => ({
    id: uuidv7(),
    path:
      slugs.length === 2 && deadline
        ? [by('next_due_task'), { entityDefinitionId: deadline.entityDefinitionId, attributeDefinitionId: deadline.id }]
        : [by(slugs[0] as string)],
  }));
  const existing = await trpc<{ id: string; title: string }[]>(page, 'views.list', { entityDefinitionId: projects.id });
  const reuse = existing.find((v) => v.title === title);
  if (reuse) return { id: reuse.id, objectId: projects.id };
  const id = uuidv7();
  await trpc(page, 'views.create', {
    id,
    entityDefinitionId: projects.id,
    type: 'table',
    title,
    columns,
    sorts: [],
    filter: null,
    sortOrder: '0001',
  });
  return { id, objectId: projects.id };
}

/** Opens the view on the real object page (features/objects + features/table) with the real cells. */
export async function openDevView(page: Page, viewId: string): Promise<void> {
  await page.goto(`/${WORKSPACE_SLUG}/custom/projects/view/${viewId}`);
  await expect(page.getByTestId('view-switcher')).toBeVisible();
  await expect(tableRows(page).first()).toBeVisible();
  await page
    .waitForFunction(() => !document.querySelector('[data-loading]'), null, { timeout: 10_000 })
    .catch(() => {});
}

/** Rows of the record table (loaded records only). */
export const tableRows = (page: Page) => page.locator('[role="row"][data-record-id]');

/** Deletes the object's views with this title (frames that create views clean up after themselves). */
export async function deleteViewsTitled(page: Page, objectId: string, title: string): Promise<void> {
  const views = await trpc<{ id: string; title: string }[]>(page, 'views.list', { entityDefinitionId: objectId });
  for (const v of views.filter((x) => x.title === title)) await trpc(page, 'views.delete', { viewId: v.id });
}
