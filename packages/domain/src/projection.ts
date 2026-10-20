// Typed projection per entity definition (ARCHITECTURE D-06, S1 §8.2): proj.p_<definition> holds one row per live
// instance and typed columns a<attnum>[_suffix] per attribute, derived from the current attribute_values. It is a
// cache: written in the same transaction as the values (read-your-writes), rebuildable at any time, and the only
// thing the view compiler queries.
//
// Column mapping (S1 sql/10_final_schema.sql, extended with sub-field columns used by filters and sorts):
//   text, personal-name, email, domain, phone, location → text COLLATE "C" (norm_key for free text)
//     personal-name adds _first/_last · email adds _domain · phone adds _cc · location: locality + _region + _cc
//   number, currency, rating → numeric · checkbox → boolean · date → date · timestamp, interaction → timestamptz
//     interaction adds _owner (uuid)
//   select, pipeline, actor-reference, entity-reference → uuid; pipeline adds _from (time entered the stage),
//     actor-reference adds _type (referenced actor type; migration 0201 backfilled existing tables)
//   multi-value attributes use arrays of the same types (NULL when empty, never '{}')
//   system attribute `id` (record_id) has no column: the compiler maps it to instance_id
import { sql } from '@agentic-crm/db';
import type { AttrDef, DefInfo } from './schema/model.ts';
import { projectionTableName, projectionTableRef, uuidLit } from './sqltext.ts';
import type { Tx } from './tx.ts';

export interface ProjColumn {
  /** Column name in the projection table. */
  name: string;
  /** Scalar SQL type (arrays get [] for multi-value attributes). */
  baseType: 'text' | 'numeric' | 'boolean' | 'date' | 'timestamptz' | 'uuid';
  /** Expression over the attribute_values row aliased `v`. */
  expr: string;
  /** Sub-field suffix ('' = main column). */
  suffix: string;
}

const TEXT_C = (expr: string) => `(${expr}) COLLATE "C"`;

function columnSpecs(attr: AttrDef): Omit<ProjColumn, 'name'>[] {
  if (attr.systemAttributeType === 'id') return [];
  switch (attr.type) {
    case 'text':
      return [{ suffix: '', baseType: 'text', expr: TEXT_C('norm_key(v.v_text)') }];
    case 'personal-name':
      return [
        { suffix: '', baseType: 'text', expr: TEXT_C('norm_key(v.v_text)') },
        { suffix: '_first', baseType: 'text', expr: TEXT_C(`norm_key(v.v_json->>'firstName')`) },
        { suffix: '_last', baseType: 'text', expr: TEXT_C(`norm_key(v.v_json->>'lastName')`) },
      ];
    case 'email-address':
      return [
        { suffix: '', baseType: 'text', expr: TEXT_C('v.v_text') },
        { suffix: '_domain', baseType: 'text', expr: TEXT_C(`v.v_json->>'emailDomain'`) },
      ];
    case 'domain':
      return [{ suffix: '', baseType: 'text', expr: TEXT_C('v.v_text') }];
    case 'phone-number':
      return [
        { suffix: '', baseType: 'text', expr: TEXT_C('v.v_text') },
        { suffix: '_cc', baseType: 'text', expr: TEXT_C(`v.v_json->>'countryCode'`) },
      ];
    case 'location':
      return [
        { suffix: '', baseType: 'text', expr: TEXT_C(`norm_key(v.v_json->>'locality')`) },
        { suffix: '_region', baseType: 'text', expr: TEXT_C(`norm_key(v.v_json->>'region')`) },
        { suffix: '_cc', baseType: 'text', expr: TEXT_C(`v.v_json->>'countryCode'`) },
      ];
    case 'number':
    case 'currency':
    case 'rating':
      return [{ suffix: '', baseType: 'numeric', expr: 'v.v_num' }];
    case 'checkbox':
      return [{ suffix: '', baseType: 'boolean', expr: 'v.v_bool' }];
    case 'date':
      return [{ suffix: '', baseType: 'date', expr: 'v.v_date' }];
    case 'timestamp':
      return [{ suffix: '', baseType: 'timestamptz', expr: 'v.v_ts' }];
    case 'interaction':
      return [
        { suffix: '', baseType: 'timestamptz', expr: 'v.v_ts' },
        { suffix: '_owner', baseType: 'uuid', expr: 'v.v_ref' },
      ];
    case 'pipeline':
      return [
        { suffix: '', baseType: 'uuid', expr: 'v.v_ref' },
        { suffix: '_from', baseType: 'timestamptz', expr: 'v.active_from' },
      ];
    case 'actor-reference':
      return [
        { suffix: '', baseType: 'uuid', expr: 'v.v_ref' },
        { suffix: '_type', baseType: 'text', expr: TEXT_C('v.v_text') },
      ];
    case 'select':
    case 'entity-reference':
      return [{ suffix: '', baseType: 'uuid', expr: 'v.v_ref' }];
  }
}

export function projectionColumns(attr: AttrDef): ProjColumn[] {
  return columnSpecs(attr).map((c) => ({ ...c, name: `a${attr.attnum}${c.suffix}` }));
}

/** Projection column for (attribute, suffix), e.g. the main column or `_cc`. */
export function projectionColumn(attr: AttrDef, suffix = ''): ProjColumn | undefined {
  return projectionColumns(attr).find((c) => c.suffix === suffix);
}

function sqlType(attr: AttrDef, col: ProjColumn): string {
  const base = col.baseType === 'text' ? 'text' : col.baseType;
  const arr = attr.isMultiselect ? '[]' : '';
  return col.baseType === 'text' ? `${base}${arr} COLLATE "C"` : `${base}${arr}`;
}

/** Aggregate that computes a projection column from the current value rows `v` of one instance. */
function aggregate(attr: AttrDef, col: ProjColumn): string {
  const filter = `FILTER (WHERE v.attribute_id = ${uuidLit(attr.id)})`;
  return attr.isMultiselect
    ? `NULLIF(array_agg(${col.expr} ORDER BY v.sort_order, v.id) ${filter}, '{}')`
    : `(array_agg(${col.expr} ORDER BY v.active_from DESC, v.id DESC) ${filter})[1]`;
}

function projected(def: DefInfo, attrs: AttrDef[] = def.attrs) {
  return attrs.flatMap((attr) => projectionColumns(attr).map((col) => ({ attr, col })));
}

function tableRef(def: DefInfo): string {
  if (!def.projectionTable) throw new Error(`Entity definition ${def.id} has no projection table`);
  return projectionTableRef(def.projectionTable);
}

/** Creates the (empty) projection table with its RLS backstop. Returns the table name. */
export async function createProjectionTable(tx: Tx, def: { id: string; workspaceId: string }): Promise<string> {
  const name = projectionTableName(def.id);
  const ref = projectionTableRef(name);
  const ws = uuidLit(def.workspaceId);
  await tx.asOwner(async () => {
    await sql
      .raw(
        `CREATE TABLE ${ref} (instance_id uuid PRIMARY KEY)
         WITH (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_insert_scale_factor = 0.02)`,
      )
      .execute(tx.db);
    await sql.raw(`ALTER TABLE ${ref} ENABLE ROW LEVEL SECURITY`).execute(tx.db);
    // Constant policy: the whole table belongs to one workspace, so no per-row workspace_id column is needed.
    await sql
      .raw(
        `CREATE POLICY tenant_isolation ON ${ref} USING (app_workspace_id() = ${ws}) WITH CHECK (app_workspace_id() = ${ws})`,
      )
      .execute(tx.db);
  });
  return name;
}

/** Adds the columns of new attributes (metadata-only ALTER under a lock timeout; retried by the tx runner). */
export async function addProjectionColumns(tx: Tx, def: DefInfo, attrs: AttrDef[]): Promise<void> {
  const cols = projected(def, attrs);
  if (cols.length === 0 || !def.projectionTable) return;
  const adds = cols.map(({ attr, col }) => `ADD COLUMN IF NOT EXISTS ${col.name} ${sqlType(attr, col)}`).join(', ');
  await tx.asOwner(async () => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(tx.db);
    await sql.raw(`ALTER TABLE ${tableRef(def)} ${adds}`).execute(tx.db);
  });
}

/**
 * Replaces an attribute's projection columns after its type changed (formula output type; its values were cleared).
 * Indexes on the old columns are dropped with them.
 */
export async function replaceProjectionColumns(tx: Tx, def: DefInfo, before: AttrDef, after: AttrDef): Promise<void> {
  if (!def.projectionTable) return;
  const drops = projectionColumns(before).map((c) => `DROP COLUMN IF EXISTS ${c.name}`);
  const adds = projectionColumns(after).map((c) => `ADD COLUMN IF NOT EXISTS ${c.name} ${sqlType(after, c)}`);
  await tx.asOwner(async () => {
    await sql`SET LOCAL lock_timeout = '5s'`.execute(tx.db);
    if (drops.length > 0) await sql.raw(`ALTER TABLE ${tableRef(def)} ${drops.join(', ')}`).execute(tx.db);
    if (adds.length > 0) await sql.raw(`ALTER TABLE ${tableRef(def)} ${adds.join(', ')}`).execute(tx.db);
  });
}

/** Adds rows for live instances and fills every column. */
export async function insertProjectionRows(tx: Tx, def: DefInfo, instanceIds: string[]): Promise<void> {
  if (instanceIds.length === 0 || !def.projectionTable) return;
  await sql`INSERT INTO ${sql.raw(tableRef(def))} (instance_id) SELECT unnest(${instanceIds}::uuid[]) ON CONFLICT DO NOTHING`.execute(
    tx.db,
  );
  await refreshProjection(tx, def, instanceIds, def.attrs);
}

/** Recomputes the given attributes' columns for the given instances from their current values. */
export async function refreshProjection(tx: Tx, def: DefInfo, instanceIds: string[], attrs: AttrDef[]): Promise<void> {
  const cols = projected(def, attrs);
  if (cols.length === 0 || instanceIds.length === 0 || !def.projectionTable) return;
  const attrIds = [...new Set(cols.map((c) => uuidLit(c.attr.id)))].join(', ');
  await sql`UPDATE ${sql.raw(tableRef(def))} p SET (${sql.raw(cols.map((c) => c.col.name).join(', '))}) = (
      SELECT ${sql.raw(cols.map((c) => aggregate(c.attr, c.col)).join(', '))}
      FROM attribute_values v
      WHERE v.instance_id = p.instance_id AND v.attribute_id IN (${sql.raw(attrIds)}) AND v.active_until IS NULL)
    WHERE p.instance_id = ANY(${instanceIds}::uuid[])`.execute(tx.db);
}

export async function deleteProjectionRows(tx: Tx, def: DefInfo, instanceIds: string[]): Promise<void> {
  if (instanceIds.length === 0 || !def.projectionTable) return;
  await sql`DELETE FROM ${sql.raw(tableRef(def))} WHERE instance_id = ANY(${instanceIds}::uuid[])`.execute(tx.db);
}

/** SELECT computing the full projection of a definition from attribute_values (rebuild and verification). */
function computedProjectionSql(def: DefInfo): { columns: string[]; select: string } {
  const cols = projected(def);
  const attrIds = [...new Set(cols.map((c) => uuidLit(c.attr.id)))];
  const join = attrIds.length
    ? `LEFT JOIN attribute_values v ON v.instance_id = i.id AND v.active_until IS NULL AND v.attribute_id IN (${attrIds.join(', ')})`
    : '';
  const aggs = cols.map((c) => `${aggregate(c.attr, c.col)} AS ${c.col.name}`);
  return {
    columns: ['instance_id', ...cols.map((c) => c.col.name)],
    select: `SELECT ${['i.id AS instance_id', ...aggs].join(', ')}
             FROM entity_instances i ${join}
             WHERE i.entity_definition_id = ${uuidLit(def.id)} AND i.archived_at IS NULL AND i.merged_at IS NULL
             GROUP BY i.id`,
  };
}

/** Rebuilds the projection of one definition from attribute_values (same transaction, in place). */
export async function rebuildProjection(tx: Tx, def: DefInfo): Promise<number> {
  const ref = tableRef(def);
  const { columns, select } = computedProjectionSql(def);
  await sql.raw(`DELETE FROM ${ref}`).execute(tx.db);
  const res = await sql.raw(`INSERT INTO ${ref} (${columns.join(', ')}) ${select}`).execute(tx.db);
  return Number(res.numAffectedRows ?? 0);
}

/** Counts rows where the live projection differs from a rebuild (0 = in sync). */
export async function diffProjection(tx: Tx, def: DefInfo): Promise<{ rows: number; mismatchedRows: number }> {
  const ref = tableRef(def);
  const { columns, select } = computedProjectionSql(def);
  const have = `SELECT ${columns.join(', ')} FROM ${ref}`;
  const { rows } = await sql
    .raw<{ rows: string; mismatched: string }>(
      `WITH want AS (${select}), have AS (${have})
       SELECT (SELECT count(*) FROM have) AS rows,
              (SELECT count(*) FROM (SELECT * FROM want EXCEPT ALL SELECT * FROM have) a)
            + (SELECT count(*) FROM (SELECT * FROM have EXCEPT ALL SELECT * FROM want) b) AS mismatched`,
    )
    .execute(tx.db);
  const r = rows[0] as { rows: string; mismatched: string };
  return { rows: Number(r.rows), mismatchedRows: Number(r.mismatched) };
}

/**
 * Creates the on-demand index for an attribute (S1 §8.3): btree (col, instance_id) for scalars, GIN for arrays,
 * trigram GIN for "contains" on text. Runs inside the transaction (not CONCURRENTLY) — fine at slice-1 sizes.
 */
export async function ensureProjectionIndex(
  tx: Tx,
  def: DefInfo,
  attr: AttrDef,
  kind: 'sort' | 'contains' = 'sort',
): Promise<void> {
  const col = projectionColumn(attr);
  if (!col || !def.projectionTable) return;
  const ref = tableRef(def);
  const name = `${def.projectionTable}_${col.name}_${kind === 'contains' ? 'trgm' : 'idx'}`;
  const body =
    kind === 'contains' && col.baseType === 'text' && !attr.isMultiselect
      ? `USING gin (${col.name} gin_trgm_ops)`
      : attr.isMultiselect
        ? `USING gin (${col.name})`
        : `(${col.name}, instance_id)`;
  await tx.asOwner(async () => {
    await sql.raw(`CREATE INDEX IF NOT EXISTS ${name} ON ${ref} ${body}`).execute(tx.db);
  });
  await tx.db.updateTable('attribute_definitions').set({ is_indexed: true }).where('id', '=', attr.id).execute();
}
