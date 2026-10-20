// Maintenance of the record search index (migration 0600, search_index_refresh()). Called inside the write
// transaction (I1) by the value engine (finalize), record delete / merge (detach) and restore, so the index never
// lags the data it describes. Field extraction lives in one place — the SQL function — shared with the migration
// backfill and rebuildSearchIndex().
import { sql } from '@agentic-crm/db';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

/** Entity types whose records are searchable. */
export const SEARCHABLE_ENTITY_TYPE_LIST = [
  'person-record',
  'company-record',
  'standard-object',
  'custom-record',
] as const;
export const SEARCHABLE_ENTITY_TYPES: ReadonlySet<string> = new Set(SEARCHABLE_ENTITY_TYPE_LIST);

/** System attribute types feeding the index besides the record label (same list as search_index_refresh). */
const INDEXED_SYSTEM_TYPES = new Set([
  'email-address',
  'domains',
  'phone-numbers',
  'description',
  'angel-list',
  'facebook',
  'instagram',
  'linked-in',
  'twitter',
  'primary-location',
  'avatar-url',
]);

/** True when a write to `attr` changes what the index holds for a record of `def`. */
export function isSearchIndexed(def: DefInfo, attr: AttrDef): boolean {
  if (attr.systemAttributeType !== null && INDEXED_SYSTEM_TYPES.has(attr.systemAttributeType)) return true;
  if (def.imagePath?.[0]?.attributeDefinitionId === attr.id) return true;
  if (attr.type !== 'text' && attr.type !== 'personal-name') return false;
  const epithet = def.epithetPath?.[0]?.attributeDefinitionId;
  return epithet ? epithet === attr.id : attr.apiSlug === 'name';
}

/**
 * Recomputes the rows of `instanceIds` (dead records and non-records lose theirs). `recency` is the record's new
 * "last updated" time; null derives it from the value history (rebuilds, restores).
 */
export async function refreshSearchIndex(tx: Tx, instanceIds: string[], recency: string | null): Promise<void> {
  const ids = [...new Set(instanceIds)];
  if (ids.length === 0) return;
  await sql`SELECT search_index_refresh(${ids}::uuid[], ${recency}::timestamptz)`.execute(tx.db);
}

/**
 * After value writes on `instanceIds` of `def`: a full refresh when an indexed attribute changed, otherwise only the
 * recency bump (records without a row yet — fresh creates — get one).
 */
export async function indexAfterWrite(tx: Tx, def: DefInfo, instanceIds: string[], attrs: AttrDef[]): Promise<void> {
  if (!SEARCHABLE_ENTITY_TYPES.has(def.entityType) || instanceIds.length === 0) return;
  if (attrs.some((a) => isSearchIndexed(def, a))) {
    await refreshSearchIndex(tx, instanceIds, tx.now);
    return;
  }
  const { rows } = await sql<{ instance_id: string }>`
    UPDATE search_index SET recency_at = ${tx.now}::timestamptz
    WHERE instance_id = ANY(${instanceIds}::uuid[])
    RETURNING instance_id`.execute(tx.db);
  const present = new Set(rows.map((r) => r.instance_id));
  const missing = instanceIds.filter((id) => !present.has(id));
  if (missing.length > 0) await refreshSearchIndex(tx, missing, tx.now);
}

/** Rebuilds the index of the workspace (or of one object) in batches; answers the number of records indexed. */
export async function rebuildSearchIndex(tx: Tx, entityDefinitionId?: string): Promise<{ indexed: number }> {
  const BATCH = 5000;
  let after = '00000000-0000-0000-0000-000000000000';
  // Rows of records that no longer exist (or of definitions that stopped being records) go first.
  await sql`
    DELETE FROM search_index si
    WHERE ${entityDefinitionId ?? null}::uuid IS NULL OR si.entity_definition_id = ${entityDefinitionId ?? null}::uuid`.execute(
    tx.db,
  );
  for (;;) {
    const { rows } = await sql<{ id: string }>`
      SELECT i.id FROM entity_instances i
      WHERE i.id > ${after}::uuid AND i.archived_at IS NULL AND i.merged_at IS NULL
        AND (${entityDefinitionId ?? null}::uuid IS NULL OR i.entity_definition_id = ${entityDefinitionId ?? null}::uuid)
      ORDER BY i.id LIMIT ${BATCH}`.execute(tx.db);
    if (rows.length === 0) break;
    const ids = rows.map((r) => r.id);
    await refreshSearchIndex(tx, ids, null);
    after = ids[ids.length - 1] as string;
  }
  const { rows } = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM search_index
    WHERE ${entityDefinitionId ?? null}::uuid IS NULL OR entity_definition_id = ${entityDefinitionId ?? null}::uuid`.execute(
    tx.db,
  );
  return { indexed: Number(rows[0]?.n ?? 0) };
}
