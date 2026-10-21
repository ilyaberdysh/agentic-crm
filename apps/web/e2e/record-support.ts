// Record page e2e helpers: tRPC calls with the page's session, lookups of the seeded demo records and idempotent
// fixtures (values, notes, tasks, files) that the record visual review frames and specs rely on.
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';

export async function trpc<T>(page: Page, name: string, input: unknown): Promise<T> {
  const response = await page.request.post(`/trpc/${name}`, {
    headers: { 'content-type': 'application/json', 'x-workspace-slug': WORKSPACE_SLUG },
    data: input,
  });
  if (!response.ok()) throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return ((await response.json()) as { result: { data: T } }).result.data;
}

export interface Attr {
  id: string;
  apiSlug: string;
  entityDefinitionId: string;
  type: string;
}

export async function attributes(page: Page, object: string): Promise<Attr[]> {
  return trpc<Attr[]>(page, 'schema.attributes.list', { entityDefinitionId: object, includeArchived: false });
}

export interface RecordRef {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** A seeded record by its display name (record search). */
export async function findRecord(page: Page, title: string): Promise<RecordRef> {
  const { hits } = await trpc<{ hits: (RecordRef & { title: string })[] }>(page, 'search.records', {
    query: title,
    limit: 10,
  });
  const hit = hits.find((h) => h.title === title);
  if (!hit) throw new Error(`no record "${title}"`);
  return { entityDefinitionId: hit.entityDefinitionId, entityInstanceId: hit.entityInstanceId };
}

/** A seeded project by its code (projects have no name attribute, so they are not searchable by title). */
export async function findProject(page: Page, code: string): Promise<RecordRef> {
  const attrs = await attributes(page, 'projects');
  const codeAttr = attrs.find((a) => a.apiSlug === 'code') as Attr;
  const out = await trpc<{ ids: string[]; entityDefinitionId: string }>(page, 'snapshots.query', {
    entityDefinitionId: 'projects',
    limit: 5,
    filter: {
      and: [
        {
          path: [{ entityDefinitionId: codeAttr.entityDefinitionId, attributeDefinitionId: codeAttr.id }],
          mode: 'must',
          constraints: [{ field: 'value', operator: 'eq', value: code }],
        },
      ],
    },
  });
  const id = out.ids[0];
  if (!id) throw new Error(`no project ${code}`);
  return { entityDefinitionId: out.entityDefinitionId, entityInstanceId: id };
}

export async function patchValues(page: Page, ref: RecordRef, values: Record<string, unknown[]>): Promise<void> {
  await trpc(page, 'records.patch', { ...ref, values });
}

export async function optionId(page: Page, object: string, attribute: string, title: string): Promise<string> {
  const options = await trpc<{ id: string; title: string }[]>(page, 'schema.options.list', {
    entityDefinitionId: object,
    attributeDefinitionId: attribute,
  });
  const option = options.find((o) => o.title === title);
  if (!option) throw new Error(`no option ${title}`);
  return option.id;
}

interface Entry {
  id: string;
  name: string;
  entryType: 'file' | 'folder';
}

/** A folder and a 28-byte text file on the record's Files tab (D-company-files). */
export async function ensureFiles(page: Page, ref: RecordRef): Promise<void> {
  const { entries } = await trpc<{ entries: Entry[] }>(page, 'files.list', { ...ref, parentFolderId: null });
  if (!entries.some((e) => e.name === '[seed] Contracts')) {
    await trpc(page, 'files.createFolder', {
      id: randomUUID(),
      ...ref,
      parentFolderId: null,
      name: '[seed] Contracts',
    });
  }
  if (!entries.some((e) => e.name === 'seed-file.txt')) {
    const body = 'seed file for the files tab\n';
    const created = await trpc<{ session: { id: string }; upload: { url: string; headers: Record<string, string> } }>(
      page,
      'files.createUploadSession',
      {
        id: randomUUID(),
        ...ref,
        parentFolderId: null,
        filename: 'seed-file.txt',
        contentType: 'text/plain',
        contentSize: Buffer.byteLength(body),
      },
    );
    const put = await fetch(created.upload.url, { method: 'PUT', headers: created.upload.headers, body });
    if (!put.ok) throw new Error(`upload PUT ${put.status}`);
    await trpc(page, 'files.complete', { sessionId: created.session.id });
  }
}

/** The app path of a record page. */
export function recordPath(kind: 'company' | 'person' | 'deals' | 'projects', id: string, tab = 'overview'): string {
  if (kind === 'company') return `/${WORKSPACE_SLUG}/company/${id}/${tab}`;
  if (kind === 'person') return `/${WORKSPACE_SLUG}/person/${id}/${tab}`;
  if (kind === 'deals') return `/${WORKSPACE_SLUG}/deals/record/${id}/${tab}`;
  return `/${WORKSPACE_SLUG}/custom/projects/record/${id}/${tab}`;
}
