// Workspace data the formula engine needs: the schema for type checking (definitions along reference paths, option /
// stage titles, members) and the reference values of records for evaluation (paths resolved hop by hop, history of
// attributes used by history functions).
import type {
  FormulaAnnotation,
  FormulaSchema,
  HistoryEntry,
  ReferenceInfo,
  RV,
  SchemaAttribute,
} from '@agentic-crm/formula';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import { loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';
import { type RowLookups, rowToRV } from './values.ts';

export function schemaAttribute(attr: AttrDef): SchemaAttribute {
  const allowed = attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null;
  return {
    id: attr.id,
    entityDefinitionId: attr.entityDefinitionId,
    title: attr.title,
    type: attr.type,
    isMultiselect: attr.isMultiselect,
    isArchived: attr.isArchived,
    targetEntityDefinitionIds:
      attr.type === 'entity-reference'
        ? attr.relatedEntityDefinitionId
          ? [attr.relatedEntityDefinitionId]
          : allowed && allowed.length > 0
            ? allowed
            : null
        : null,
  };
}

export interface LoadedSchema {
  schema: FormulaSchema;
  defs: Map<string, DefInfo>;
}

/** Schema for checking a formula whose annotations are `annotations` (plus every attribute of `extraDefIds`). */
export async function loadFormulaSchema(
  tx: Tx,
  annotations: FormulaAnnotation[],
  extraDefIds: string[] = [],
): Promise<LoadedSchema> {
  const defIds = new Set(extraDefIds);
  const optionIds: string[] = [];
  const memberIds: string[] = [];
  for (const a of annotations) {
    if (a.type === 'entity-variable') for (const hop of a.path) defIds.add(hop.entityDefinitionId);
    else if (a.type === 'select-option') optionIds.push(a.selectOptionId);
    else if (a.type === 'pipeline-stage') optionIds.push(a.pipelineStageId);
    else if (a.referencedActorType === 'workspace-member') memberIds.push(a.referencedActorId);
  }
  const uuidish = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
  const defs = await loadDefinitionsByIds(tx, [...defIds].filter(uuidish));
  const options = optionIds.length
    ? await tx.db
        .selectFrom('select_options')
        .select(['id', 'attribute_id', 'title', 'kind'])
        .where(
          'id',
          'in',
          optionIds.filter(uuidish).length ? optionIds.filter(uuidish) : ['00000000-0000-0000-0000-000000000000'],
        )
        .execute()
    : [];
  const members = await memberLookup(tx, memberIds);
  return {
    defs,
    schema: {
      attribute(ed, ad) {
        const attr = defs.get(ed)?.byId.get(ad);
        return attr ? schemaAttribute(attr) : null;
      },
      selectOption(attributeId, optionId) {
        const o = options.find((x) => x.id === optionId && x.kind === 'option');
        return o && o.attribute_id === attributeId ? { title: o.title } : null;
      },
      pipelineStage(attributeId, stageId) {
        const o = options.find((x) => x.id === stageId && x.kind === 'stage');
        return o && o.attribute_id === attributeId ? { title: o.title } : null;
      },
      actor(type, id) {
        if (type !== 'workspace-member') return { name: null, email: null };
        return members.get(id) ?? null;
      },
    },
  };
}

async function memberLookup(tx: Tx, ids: string[]) {
  const uuids = [...new Set(ids)].filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  const out = new Map<string, { name: string | null; email: string | null }>();
  if (uuids.length === 0) return out;
  const rows = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'first_name', 'last_name', 'email_address'])
    .where('id', 'in', uuids)
    .execute();
  for (const r of rows) {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ').trim();
    out.set(r.id, { name: name || null, email: r.email_address });
  }
  return out;
}

type Row = {
  instance_id: string;
  attribute_id: string;
  active_from: string;
  active_until: string | null;
  sort_order: string | null;
  v_text: string | null;
  v_num: string | number | null;
  v_ts: string | null;
  v_date: string | null;
  v_bool: boolean | null;
  v_ref: string | null;
  v_ref_def: string | null;
  v_json: unknown;
};

async function currentRows(tx: Tx, instanceIds: string[], attributeId: string): Promise<Row[]> {
  if (instanceIds.length === 0) return [];
  return tx.db
    .selectFrom('attribute_values')
    .select([
      'instance_id',
      'attribute_id',
      'active_from',
      'active_until',
      'sort_order',
      'v_text',
      'v_num',
      'v_ts',
      'v_date',
      'v_bool',
      'v_ref',
      'v_ref_def',
      'v_json',
    ])
    .where('instance_id', 'in', instanceIds)
    .where('attribute_id', '=', attributeId)
    .where('active_until', 'is', null)
    .orderBy('sort_order')
    .orderBy('active_from')
    .orderBy('id')
    .execute();
}

async function historyRows(tx: Tx, instanceIds: string[], attributeId: string): Promise<Row[]> {
  if (instanceIds.length === 0) return [];
  return tx.db
    .selectFrom('attribute_values')
    .select([
      'instance_id',
      'attribute_id',
      'active_from',
      'active_until',
      'sort_order',
      'v_text',
      'v_num',
      'v_ts',
      'v_date',
      'v_bool',
      'v_ref',
      'v_ref_def',
      'v_json',
    ])
    .where('instance_id', 'in', instanceIds)
    .where('attribute_id', '=', attributeId)
    .orderBy('active_from')
    .orderBy('id')
    .execute();
}

async function liveIds(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.db
    .selectFrom('entity_instances')
    .select('id')
    .where('id', 'in', ids)
    .where('archived_at', 'is', null)
    .where('merged_at', 'is', null)
    .execute();
  return new Set(rows.map((r) => r.id));
}

export interface RecordReferenceData {
  /** Raw value(s) per reference index (singular: value or null; otherwise an array). */
  values: RV[];
  /** History rows per reference index (only references used by history functions). */
  history: Map<number, HistoryEntry[]>;
}

/** Loads every reference of a compiled formula for a batch of records. */
export async function loadReferenceData(
  tx: Tx,
  refs: ReferenceInfo[],
  defs: Map<string, DefInfo>,
  instanceIds: string[],
): Promise<Map<string, RecordReferenceData>> {
  const out = new Map<string, RecordReferenceData>(
    instanceIds.map((id) => [id, { values: refs.map(() => null), history: new Map() }]),
  );
  const pendingRows: { ref: ReferenceInfo; perRoot: Map<string, Row[]>; history: Map<string, Row[]> | null }[] = [];
  const optionIds = new Set<string>();
  const memberIds = new Set<string>();
  const collect = (attr: AttrDef, rows: Row[]) => {
    for (const r of rows) {
      if ((attr.type === 'select' || attr.type === 'pipeline') && r.v_ref) optionIds.add(r.v_ref);
      if (attr.type === 'actor-reference' && r.v_ref && (r.v_text ?? 'workspace-member') === 'workspace-member')
        memberIds.add(r.v_ref);
      if (attr.type === 'interaction' && r.v_ref) memberIds.add(r.v_ref);
    }
  };
  for (const ref of refs) {
    if (!ref.attribute || ref.archived) continue;
    // frontier: root record → instances reached at the current hop
    let frontier = new Map<string, string[]>(instanceIds.map((id) => [id, [id]]));
    for (let i = 0; i < ref.path.length; i++) {
      const hop = ref.path[i] as { entityDefinitionId: string; attributeDefinitionId: string };
      const attr = defs.get(hop.entityDefinitionId)?.byId.get(hop.attributeDefinitionId);
      if (!attr) break;
      const ids = [...new Set([...frontier.values()].flat())];
      const rows = await currentRows(tx, ids, attr.id);
      const byInstance = new Map<string, Row[]>();
      for (const r of rows) byInstance.set(r.instance_id, [...(byInstance.get(r.instance_id) ?? []), r]);
      if (i < ref.path.length - 1) {
        const targets = rows.map((r) => r.v_ref).filter((x): x is string => x !== null);
        const live = await liveIds(tx, [...new Set(targets)]);
        const next = new Map<string, string[]>();
        for (const [root, at] of frontier) {
          next.set(
            root,
            at.flatMap((id) => (byInstance.get(id) ?? []).map((r) => r.v_ref as string).filter((t) => live.has(t))),
          );
        }
        frontier = next;
        continue;
      }
      collect(attr, rows);
      const perRoot = new Map<string, Row[]>();
      for (const [root, at] of frontier)
        perRoot.set(
          root,
          at.flatMap((id) => byInstance.get(id) ?? []),
        );
      let history: Map<string, Row[]> | null = null;
      if (ref.needsHistory) {
        const hrows = await historyRows(tx, ids, attr.id);
        collect(attr, hrows);
        const byInst = new Map<string, Row[]>();
        for (const r of hrows) byInst.set(r.instance_id, [...(byInst.get(r.instance_id) ?? []), r]);
        history = new Map();
        for (const [root, at] of frontier)
          history.set(
            root,
            at.flatMap((id) => byInst.get(id) ?? []),
          );
      }
      pendingRows.push({ ref, perRoot, history });
    }
  }
  const titles = new Map<string, string>();
  if (optionIds.size > 0) {
    const rows = await tx.db
      .selectFrom('select_options')
      .select(['id', 'title'])
      .where('id', 'in', [...optionIds])
      .execute();
    for (const r of rows) titles.set(r.id, r.title);
  }
  const members = await memberLookup(tx, [...memberIds]);
  const lookups: RowLookups = {
    optionTitle: (id) => titles.get(id) ?? '',
    member: (id) => members.get(id) ?? null,
  };
  for (const { ref, perRoot, history } of pendingRows) {
    const type = (ref.attribute as { type: AttrDef['type'] }).type;
    for (const [root, rows] of perRoot) {
      const data = out.get(root) as RecordReferenceData;
      const vals = rows.map((r) => rowToRV(type, r, lookups)).filter((x) => x !== null);
      data.values[ref.index] = ref.singular ? (vals[0] ?? null) : vals;
      const h = history?.get(root);
      if (h) {
        data.history.set(
          ref.index,
          h.map((r) => ({
            value: rowToRV(type, r, lookups),
            activeFrom: Date.parse(r.active_from),
            activeUntil: r.active_until === null ? null : Date.parse(r.active_until),
          })),
        );
      }
    }
  }
  return out;
}
