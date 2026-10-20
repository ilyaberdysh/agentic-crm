// Display data of group keys (meta.groups): option/stage titles and colours in attribute order, record and member
// names, original spellings of normalised text values; natural order — options by rank, time buckets and numbers
// ascending, everything else alphabetically — with the null group last.
import type { DatasetGroupInfo } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { recordLabels } from '../../collab/common.ts';
import type { AttrDef } from '../../schema/model.ts';
import type { Tx } from '../../tx.ts';
import type { GroupSpec } from './context.ts';

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function sortInfos(infos: Omit<DatasetGroupInfo, 'order'>[], compare: (a: string, b: string) => number) {
  const keyed = infos.filter((i) => i.key !== null).sort((a, b) => compare(a.key as string, b.key as string));
  const nulls = infos.filter((i) => i.key === null);
  return [...keyed, ...nulls].map((i, order) => ({ ...i, order }));
}

/** Options or stages of an attribute as group infos (all of them when `all`, else only `keys`). */
export async function optionInfos(
  tx: Tx,
  attr: AttrDef,
  keys: (string | null)[],
  all = false,
): Promise<DatasetGroupInfo[]> {
  const options = await tx.db
    .selectFrom('select_options')
    .select(['id', 'title', 'color', 'sort_order', 'is_archived'])
    .where('attribute_id', '=', attr.id)
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const wanted = new Set(keys);
  const out: Omit<DatasetGroupInfo, 'order'>[] = options
    .filter((o) => wanted.has(o.id) || (all && !o.is_archived))
    .map((o) => ({ key: o.id, label: o.title, color: o.color }));
  const known = new Set(options.map((o) => o.id));
  for (const k of wanted) if (k !== null && !known.has(k)) out.push({ key: k, label: null, color: null });
  if (wanted.has(null)) out.push({ key: null, label: null, color: null });
  return out.map((i, order) => ({ ...i, order }));
}

async function memberNames(tx: Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'first_name', 'last_name', 'email_address'])
    .where('id', 'in', ids)
    .execute();
  return new Map(rows.map((m) => [m.id, `${m.first_name} ${m.last_name}`.trim() || m.email_address]));
}

/**
 * Original spelling of normalised text keys (the projection stores norm_key values): the values of one sample record
 * per key (the query returns them), read through av_inst.
 */
async function textLabels(tx: Tx, spec: GroupSpec, samples: Map<string, string>): Promise<Map<string, string>> {
  const ids = [...new Set(samples.values())];
  if (ids.length === 0) return new Map();
  const raw =
    spec.attr.type === 'location'
      ? spec.suffix === '_region'
        ? `v.v_json->>'region'`
        : `v.v_json->>'locality'`
      : spec.attr.type === 'personal-name'
        ? spec.suffix === '_first'
          ? `v.v_json->>'firstName'`
          : spec.suffix === '_last'
            ? `v.v_json->>'lastName'`
            : 'v.v_text'
        : 'v.v_text';
  const { rows } = await sql<{ k: string; label: string }>`
    SELECT DISTINCT ON (k) norm_key(${sql.raw(raw)}) COLLATE "C" AS k, ${sql.raw(raw)} AS label
    FROM attribute_values v
    WHERE v.instance_id = ANY(${ids}::uuid[]) AND v.attribute_id = ${spec.attr.id}::uuid AND v.active_until IS NULL
    ORDER BY k, label`.execute(tx.db);
  const wanted = new Set(samples.keys());
  return new Map(rows.filter((r) => wanted.has(r.k)).map((r) => [r.k, r.label]));
}

/** Group infos of a grouping for the keys present in the result. */
export async function groupInfos(
  tx: Tx,
  spec: GroupSpec,
  keys: (string | null)[],
  /** Text groupings: key → a record id holding that value (for the original spelling). */
  samples: Map<string, string> = new Map(),
): Promise<DatasetGroupInfo[]> {
  const unique = [...new Set(keys)];
  const present = unique.filter((k): k is string => k !== null);
  const withNull = (infos: Omit<DatasetGroupInfo, 'order'>[]) =>
    unique.includes(null) ? [...infos, { key: null, label: null, color: null }] : infos;

  if (spec.kind === 'uuid') {
    const t = spec.attr.type;
    if (t === 'pipeline' || t === 'select') return optionInfos(tx, spec.attr, unique, spec.grouping.includeEmptyGroups);
    if (t === 'entity-reference') {
      const defs = present.length
        ? await tx.db
            .selectFrom('entity_instances')
            .select(['id', 'entity_definition_id'])
            .where('id', 'in', present)
            .execute()
        : [];
      const labels = await recordLabels(
        tx,
        defs.map((d) => ({ entityDefinitionId: d.entity_definition_id, entityInstanceId: d.id })),
      );
      const infos = present.map((k) => ({ key: k, label: labels.get(k) ?? null, color: null }));
      return sortInfos(withNull(infos), (a, b) => collator.compare(labels.get(a) ?? '￿', labels.get(b) ?? '￿'));
    }
    // Actor references and interaction owners: workspace members.
    const names = await memberNames(tx, present);
    const infos = present.map((k) => ({ key: k, label: names.get(k) ?? null, color: null }));
    return sortInfos(withNull(infos), (a, b) => collator.compare(names.get(a) ?? '￿', names.get(b) ?? '￿'));
  }
  if (spec.kind === 'number' || spec.kind === 'rating') {
    return sortInfos(
      withNull(present.map((k) => ({ key: k, label: k, color: null }))),
      (a, b) => Number(a) - Number(b),
    );
  }
  if (spec.kind === 'date' || spec.kind === 'timestamp') {
    return sortInfos(withNull(present.map((k) => ({ key: k, label: k, color: null }))), (a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
  }
  if (spec.kind === 'boolean') {
    return sortInfos(withNull(present.map((k) => ({ key: k, label: k, color: null }))), (a, b) =>
      a === b ? 0 : a === 'false' ? -1 : 1,
    );
  }
  if (spec.kind === 'text') {
    const labels = await textLabels(tx, spec, samples);
    return sortInfos(withNull(present.map((k) => ({ key: k, label: labels.get(k) ?? k, color: null }))), (a, b) =>
      collator.compare(labels.get(a) ?? a, labels.get(b) ?? b),
    );
  }
  return sortInfos(withNull(present.map((k) => ({ key: k, label: k, color: null }))), (a, b) => collator.compare(a, b));
}

/** Time bucket keys as group infos. */
export function bucketInfos(keys: string[]): DatasetGroupInfo[] {
  return [...new Set(keys)].sort().map((k, order) => ({ key: k, label: k, color: null, order }));
}
