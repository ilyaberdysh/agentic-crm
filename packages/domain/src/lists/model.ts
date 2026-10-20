// In-transaction model of a list: its collection row and its collection-entry definition (same id, A §4.4), plus the
// system attribute holding each entry's parent record.
import type { Actor, List, ListSummary } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { notFound } from '../errors.ts';
import { type AttrDef, type DefInfo, isUuid, loadDefinition, loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { grantSummary, loadGrants, scopeOfFlags } from './access.ts';

export interface CollectionRow {
  id: string;
  workspace_id: string;
  name: string;
  icon: string | null;
  sort_order: string;
  parent_entity_definition_ids: string[];
  created_by: unknown;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ListInfo {
  row: CollectionRow;
  def: DefInfo;
  parentAttr: AttrDef;
}

export const PARENT_RECORD_TYPE = 'entry-parent-record';
/** Objects whose records can be list parents. */
export const PARENT_ENTITY_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);

export const listNotFound = (ref: string) =>
  notFound('This list either doesn’t exist or you don’t have permission to access it', { list_id: ref });

export function parentAttrOf(def: DefInfo): AttrDef {
  const attr = def.attrs.find((a) => a.systemAttributeType === PARENT_RECORD_TYPE);
  if (!attr) throw listNotFound(def.id);
  return attr;
}

async function collectionRow(tx: Tx, id: string): Promise<CollectionRow | undefined> {
  return (await tx.db.selectFrom('collections').selectAll().where('id', '=', id).executeTakeFirst()) as
    | CollectionRow
    | undefined;
}

/** Loads a live list by id or api_slug; 404 for unknown, deleted, or non-list definitions. */
export async function loadList(tx: Tx, idOrSlug: string, opts: { includeDeleted?: boolean } = {}): Promise<ListInfo> {
  let id = idOrSlug.toLowerCase();
  if (!isUuid(idOrSlug)) {
    const def = await tx.db
      .selectFrom('entity_definitions')
      .select(['id', 'entity_type'])
      .where('api_slug', '=', idOrSlug)
      .executeTakeFirst();
    if (!def || def.entity_type !== 'collection-entry') throw listNotFound(idOrSlug);
    id = def.id;
  }
  const row = await collectionRow(tx, id);
  if (!row || (row.deleted_at !== null && !opts.includeDeleted)) throw listNotFound(idOrSlug);
  const def = await loadDefinition(tx, id);
  return { row, def, parentAttr: parentAttrOf(def) };
}

/** Live lists in sidebar order. */
export async function loadLists(tx: Tx): Promise<ListInfo[]> {
  const rows = (await tx.db
    .selectFrom('collections')
    .selectAll()
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .orderBy('created_at')
    .execute()) as CollectionRow[];
  const defs = await loadDefinitionsByIds(
    tx,
    rows.map((r) => r.id),
  );
  return rows.flatMap((row) => {
    const def = defs.get(row.id);
    return def ? [{ row, def, parentAttr: parentAttrOf(def) }] : [];
  });
}

export function toListSummary(info: ListInfo): ListSummary {
  return {
    id: info.row.id,
    name: info.row.name,
    icon: info.row.icon,
    apiSlug: info.def.apiSlug,
    sortOrder: info.row.sort_order,
  };
}

/** Lists → contract objects, with grants, the caller's effective access and live entry counts. */
export async function toLists(
  tx: Tx,
  infos: ListInfo[],
  flagsOf: (infos: ListInfo[]) => Promise<Map<string, Parameters<typeof scopeOfFlags>[0]>>,
): Promise<List[]> {
  if (infos.length === 0) return [];
  const ids = infos.map((i) => i.row.id);
  const [grants, flags, counts] = await Promise.all([
    loadGrants(tx, ids),
    flagsOf(infos),
    sql<{ id: string; n: string }>`
      SELECT entity_definition_id AS id, count(*) AS n FROM entity_instances
      WHERE entity_definition_id = ANY(${ids}::uuid[]) AND archived_at IS NULL AND merged_at IS NULL
      GROUP BY entity_definition_id`.execute(tx.db),
  ]);
  const countOf = new Map(counts.rows.map((r) => [r.id, Number(r.n)]));
  return infos.map((info) => ({
    id: info.row.id,
    workspaceId: info.row.workspace_id,
    name: info.row.name,
    icon: info.row.icon,
    apiSlug: info.def.apiSlug,
    sortOrder: info.row.sort_order,
    parentEntityDefinitionIds: info.row.parent_entity_definition_ids,
    parentRecordAttributeId: info.parentAttr.id,
    ...grantSummary(grants.get(info.row.id)),
    myAccess: scopeOfFlags(flags.get(info.row.id)),
    entryCount: countOf.get(info.row.id) ?? 0,
    createdBy: info.row.created_by as Actor,
    createdAt: info.row.created_at,
    updatedAt: info.row.updated_at,
  }));
}

/** The acting member's workspace role (admins may manage any list's access and see every list in settings). */
export async function isWorkspaceAdmin(tx: Tx): Promise<boolean> {
  const memberId = actingMemberId(tx.ctx);
  if (!memberId) return tx.ctx.actor.type === 'system';
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', memberId)
    .executeTakeFirst();
  return row?.access_level === 'admin';
}
