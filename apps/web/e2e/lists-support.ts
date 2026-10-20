// Slice-4 lists e2e helpers: lists, list attributes and entries created through the tRPC procedures (lists.*,
// entries.*, schema.*), and lookups of the seeded demo records ("[seed] Northwind Robotics", …).
import type { Page } from '@playwright/test';
import { trpc, uuid } from './slice3-support.ts';

export interface ListInfo {
  id: string;
  name: string;
  parentRecordAttributeId: string;
}

export interface Hit {
  entityDefinitionId: string;
  entityInstanceId: string;
  title: string | null;
}

export async function objectId(page: Page, slug: string): Promise<string> {
  return (await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: slug })).id;
}

/** A seeded record by (part of) its name. */
export async function findRecord(page: Page, slug: string, query: string): Promise<Hit> {
  const { hits } = await trpc<{ hits: Hit[] }>(page, 'search.records', {
    query,
    entityDefinitionIds: [slug],
    limit: 5,
  });
  const hit = hits[0];
  if (!hit) throw new Error(`no ${slug} record matching "${query}"`);
  return hit;
}

export async function createList(
  page: Page,
  name: string,
  parentSlug = 'companies',
  options: { stage?: boolean } = {},
): Promise<ListInfo> {
  const parent = await objectId(page, parentSlug);
  const { list } = await trpc<{ list: ListInfo }>(page, 'lists.create', {
    id: uuid(),
    name,
    icon: 'emoji:clipboard',
    parentEntityDefinitionIds: [parent],
  });
  if (options.stage) {
    await trpc(page, 'schema.attributes.create', {
      id: uuid(),
      entityDefinitionId: list.id,
      title: 'Stage',
      type: 'pipeline',
      stages: [
        { title: 'Lead', color: 'block_orange' },
        { title: 'Qualified', color: 'block_yellow' },
        { title: 'Won', color: 'block_green' },
      ],
    });
    await trpc(page, 'schema.attributes.create', {
      id: uuid(),
      entityDefinitionId: list.id,
      title: 'Deal value',
      type: 'currency',
    });
  }
  return list;
}

export async function addEntry(page: Page, list: ListInfo, record: Hit): Promise<string> {
  const out = await trpc<{ entries: { id: string }[] }>(page, 'entries.add', {
    listId: list.id,
    parentRecords: [{ entityDefinitionId: record.entityDefinitionId, entityInstanceId: record.entityInstanceId }],
    onDuplicate: 'keep',
  });
  return out.entries[0]?.id as string;
}

export async function deleteList(page: Page, list: ListInfo): Promise<void> {
  await trpc(page, 'lists.delete', { listId: list.id }).catch(() => undefined);
}

export async function entriesOf(page: Page, list: ListInfo): Promise<number> {
  const snap = await trpc<{ total: number }>(page, 'snapshots.query', {
    entityDefinitionId: list.id,
    initialRange: { start: 0, size: 0 },
  });
  return snap.total;
}
