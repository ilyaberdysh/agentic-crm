// Workflow version graphs and their static typing (B.7 variable picker, edit-time type checking):
//   • TypeEnv — every entity definition of the workspace (objects and lists) with attributes, loaded once per call;
//   • outcomes of a block for its config (record outputs typed by the configured object / list, Switch cases, Loop
//     item type from the iterable, Parse JSON properties from the schema);
//   • upstream reachability (which blocks and outcomes a block can reference: some path leads from them to it);
//   • the type of a variable matcher (field → attribute / property / index operations).
import {
  attributeValueType,
  type BlockConfig,
  type BlockDefinition,
  blockDefinition,
  type ConfigExpr,
  type Position,
  type ResolvedOutcome,
  T,
  type VariableMatcher,
  WF_PROPERTIES,
  type WfType,
} from '@agentic-crm/contracts';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import { loadDefinitionsByIds } from '../schema/model.ts';
import type { Tx } from '../tx.ts';

export interface BlockRow {
  id: string;
  version_id: string;
  workflow_id: string;
  block_type: 'trigger' | 'step';
  slug: string;
  block_version: number;
  description: string | null;
  position: Position;
  config: BlockConfig;
  created_by: unknown;
  created_at: string;
  updated_at: string;
}

export interface PathRow {
  id: string;
  version_id: string;
  source_block_id: string;
  source_outcome: string;
  target_block_id: string;
  created_at: string;
}

export interface Graph {
  versionId: string;
  blocks: Map<string, BlockRow>;
  paths: PathRow[];
}

export async function loadGraph(tx: Tx, versionId: string): Promise<Graph> {
  const [blocks, paths] = await Promise.all([
    tx.db.selectFrom('workflow_blocks').selectAll().where('version_id', '=', versionId).orderBy('created_at').execute(),
    tx.db.selectFrom('workflow_paths').selectAll().where('version_id', '=', versionId).orderBy('created_at').execute(),
  ]);
  return {
    versionId,
    blocks: new Map(blocks.map((b) => [b.id, b as unknown as BlockRow])),
    paths: paths as PathRow[],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Type environment

export interface TypeEnv {
  defs: Map<string, DefInfo>;
  /** List names (lists are collection-entry definitions; their display name lives in collections). */
  listNames: Map<string, string>;
  def(ref: string | null | undefined): DefInfo | undefined;
}

export async function loadTypeEnv(tx: Tx): Promise<TypeEnv> {
  const cached = tx.memo.get('workflow-type-env') as TypeEnv | undefined;
  if (cached) return cached;
  const ids = await tx.db.selectFrom('entity_definitions').select('id').execute();
  const defs = await loadDefinitionsByIds(
    tx,
    ids.map((r) => r.id),
  );
  const lists = await tx.db.selectFrom('collections').select(['id', 'name']).where('deleted_at', 'is', null).execute();
  const bySlug = new Map([...defs.values()].map((d) => [d.apiSlug, d]));
  const env: TypeEnv = {
    defs,
    listNames: new Map(lists.map((l) => [l.id, l.name])),
    def: (ref) => (ref ? (defs.get(ref) ?? bySlug.get(ref)) : undefined),
  };
  tx.memo.set('workflow-type-env', env);
  return env;
}

export const isListDef = (def: DefInfo) => def.entityType === 'collection-entry';
const OBJECT_TYPES = new Set(['person-record', 'company-record', 'standard-object', 'custom-record']);
export const isObjectDef = (def: DefInfo) => OBJECT_TYPES.has(def.entityType);

/** The value type of an attribute (arrays for multi-value attributes). */
export function attributeType(attr: AttrDef): WfType {
  const allowed = attr.relatedEntityDefinitionId
    ? [attr.relatedEntityDefinitionId]
    : (attr.config.entityReferenceConfiguration?.allowedEntityDefinitionIds ?? null);
  const base = attributeValueType(attr.type, { allowedEntityDefinitionIds: allowed });
  return attr.isMultiselect ? T.array(base) : base;
}

// ---------------------------------------------------------------------------------------------------------------
// Config access

export function entryOf(config: BlockConfig | null | undefined, key: string): ConfigExpr | undefined {
  return config?.entries?.[key];
}

/** The definition id named by an object / list input (static pickers only). */
export function definitionRef(expr: ConfigExpr | undefined): string | null {
  if (!expr) return null;
  if (expr.type === 'agentic-crm-object') return expr.entityDefinitionId;
  if (expr.type === 'agentic-crm-list') return expr.listId;
  if (expr.type === 'string') return expr.value || null;
  return null;
}

export function stringOf(expr: ConfigExpr | undefined): string | null {
  if (!expr) return null;
  if (expr.type === 'string') return expr.value;
  if (expr.type === 'json' && typeof expr.value === 'string') return expr.value;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes

export interface Typing {
  graph: Graph;
  env: TypeEnv;
  cache: Map<string, ResolvedOutcome[]>;
  visiting: Set<string>;
}

export function typing(graph: Graph, env: TypeEnv): Typing {
  return { graph, env, cache: new Map(), visiting: new Set() };
}

function jsonSchemaType(schema: unknown): WfType {
  const s = (schema ?? {}) as { type?: unknown; items?: unknown; properties?: Record<string, unknown> };
  switch (s.type) {
    case 'string':
      return T.string;
    case 'number':
    case 'integer':
      return T.number;
    case 'boolean':
      return T.boolean;
    case 'array':
      return T.array(jsonSchemaType(s.items));
    case 'object': {
      const fields: Record<string, WfType> = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) fields[k] = jsonSchemaType(v);
      return { kind: 'object', fields };
    }
    default:
      return T.json;
  }
}

/** Parse JSON outputs: one per root property (object schemas), else one `value` output. */
export function parseJsonOutputs(schemaText: string | null): { key: string; label: string; type: WfType }[] {
  if (!schemaText) return [];
  let schema: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    return [];
  }
  const root = jsonSchemaType(schema);
  if (root.kind === 'object') {
    return Object.entries(root.fields).map(([key, type]) => ({ key, label: key, type }));
  }
  return [{ key: 'value', label: 'Value', type: root }];
}

function recordOutputType(spec: { type: WfType; recordOf?: string }, config: BlockConfig): WfType {
  if (!spec.recordOf) return spec.type;
  const id = definitionRef(entryOf(config, spec.recordOf));
  const record = T.record(id);
  return spec.type.kind === 'array' ? T.array(record) : record;
}

export function switchCases(config: BlockConfig): { id: string; label: string; predicate: ConfigExpr | null }[] {
  const cases = entryOf(config, 'cases');
  if (!cases || cases.type !== 'array') return [];
  return cases.items.map((item, i) => {
    const entries = item.type === 'object' ? item.entries : {};
    const id = stringOf(entries.id) ?? `case-${i + 1}`;
    const label = stringOf(entries.label);
    return { id, label: label?.trim() ? label : `Case ${i + 1}`, predicate: entries.predicate ?? null };
  });
}

/** The outcomes (with typed outputs) a block has for its current config. */
export function outcomesOf(t: Typing, block: BlockRow): ResolvedOutcome[] {
  const cached = t.cache.get(block.id);
  if (cached) return cached;
  const def = blockDefinition(block.slug);
  if (!def) return [];
  if (t.visiting.has(block.id)) return staticOutcomes(def, block.config);
  t.visiting.add(block.id);
  try {
    let outcomes = staticOutcomes(def, block.config);
    if (def.dynamicOutcomes === 'switch-cases') {
      outcomes = [
        ...switchCases(block.config).map((c) => ({ slug: c.id, label: c.label, outputs: null })),
        { slug: 'default', label: 'Default', outputs: null },
      ];
    } else if (def.dynamicOutcomes === 'parse-json') {
      outcomes = [
        { slug: 'done', label: 'Next step', outputs: parseJsonOutputs(stringOf(entryOf(block.config, 'schema'))) },
      ];
    } else if (def.dynamicOutcomes === 'custom-agent') {
      // Structured output: Response plus one output per property of the schema (slice 10).
      if (stringOf(entryOf(block.config, 'output_mode')) === 'structured') {
        outcomes = [
          {
            slug: 'done',
            label: 'Next step',
            outputs: [
              { key: 'response', label: 'Response', type: T.string },
              ...parseJsonOutputs(stringOf(entryOf(block.config, 'structured_output_schema'))).filter(
                (o) => o.key !== 'response',
              ),
            ],
          },
        ];
      }
    } else if (def.dynamicOutcomes === 'loop') {
      const iterable = entryOf(block.config, 'iterable');
      let item: WfType = T.json;
      if (iterable?.type === 'variable') {
        const resolved = variableType(t, block.id, iterable.matchers[0] as VariableMatcher);
        if ('type' in resolved && resolved.type.kind === 'array') item = resolved.type.of;
      }
      outcomes = outcomes.map((o) =>
        o.slug === 'next' && o.outputs
          ? { ...o, outputs: o.outputs.map((out) => (out.key === 'item' ? { ...out, type: item } : out)) }
          : o,
      );
    }
    t.cache.set(block.id, outcomes);
    return outcomes;
  } finally {
    t.visiting.delete(block.id);
  }
}

function staticOutcomes(def: BlockDefinition, config: BlockConfig): ResolvedOutcome[] {
  return def.outcomes.map((o) => ({
    slug: o.slug,
    label: o.label,
    outputs: o.outputs
      ? o.outputs.map((out) => ({ key: out.key, label: out.label, type: recordOutputType(out, config) }))
      : null,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Reachability

export interface Upstream {
  /** blockId → the outcomes of that block from which some path leads to the target. */
  outcomes: Map<string, Set<string>>;
  /** blockId → hops to the target (nearest first in the picker). */
  distance: Map<string, number>;
}

/** Blocks upstream of `blockId`: some path leads from (block, outcome) to it. */
export function upstreamOf(graph: Graph, blockId: string): Upstream {
  const outcomes = new Map<string, Set<string>>();
  const distance = new Map<string, number>();
  const byTarget = new Map<string, PathRow[]>();
  for (const p of graph.paths) byTarget.set(p.target_block_id, [...(byTarget.get(p.target_block_id) ?? []), p]);
  let frontier = [blockId];
  const seen = new Set([blockId]);
  for (let d = 1; frontier.length > 0 && d <= 10_000; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const p of byTarget.get(node) ?? []) {
        const set = outcomes.get(p.source_block_id) ?? new Set<string>();
        set.add(p.source_outcome);
        outcomes.set(p.source_block_id, set);
        if (!distance.has(p.source_block_id)) distance.set(p.source_block_id, d);
        if (!seen.has(p.source_block_id)) {
          seen.add(p.source_block_id);
          next.push(p.source_block_id);
        }
      }
    }
    frontier = next;
  }
  return { outcomes, distance };
}

/** Blocks reachable from some trigger (steps outside it are "not connected to a trigger"). */
export function reachableFromTriggers(graph: Graph): Set<string> {
  const bySource = new Map<string, PathRow[]>();
  for (const p of graph.paths) bySource.set(p.source_block_id, [...(bySource.get(p.source_block_id) ?? []), p]);
  const seen = new Set<string>();
  const queue = [...graph.blocks.values()].filter((b) => b.block_type === 'trigger').map((b) => b.id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of bySource.get(id) ?? []) if (!seen.has(p.target_block_id)) queue.push(p.target_block_id);
  }
  return seen;
}

// ---------------------------------------------------------------------------------------------------------------
// Variable types

export type TypeResult = { type: WfType } | { code: 'deleted-variable' | 'inaccessible-variable'; message: string };

const DELETED = { code: 'deleted-variable' as const, message: 'This step uses a deleted variable' };

/** Type of the value at `operations` below an output of type `type`. */
export function applyOperationTypes(env: TypeEnv, type: WfType, operations: VariableMatcher['operations']): TypeResult {
  let current = type;
  for (const op of operations) {
    const many = current.kind === 'array';
    const single = many ? (current as { of: WfType }).of : current;
    let next: WfType;
    if (op.type === 'attribute') {
      if (single.kind !== 'record') return DELETED;
      if (single.entityDefinitionId !== null && single.entityDefinitionId !== op.entityDefinitionId) return DELETED;
      const attr = env.def(op.entityDefinitionId)?.byId.get(op.attributeDefinitionId);
      if (!attr || attr.isArchived) return DELETED;
      next = attributeType(attr);
      if (many) next = next.kind === 'array' ? next : T.array(next);
    } else if (op.type === 'property') {
      const prop = single.kind === 'object' ? { type: single.fields[op.name] } : WF_PROPERTIES[single.kind]?.[op.name];
      if (!prop?.type) return DELETED;
      next = many ? T.array(prop.type) : prop.type;
    } else if (op.type === 'index') {
      if (!many) return DELETED;
      next = single;
    } else {
      // A field below the first step (objects of Parse JSON / HTTP).
      if (single.kind === 'object') {
        const field = single.fields[op.name];
        if (!field) return DELETED;
        next = many ? T.array(field) : field;
      } else if (single.kind === 'json') next = T.json;
      else return DELETED;
    }
    current = next;
  }
  return { type: current };
}

/** Type of one data source as seen from `fromBlockId` (accessibility included). */
export function variableType(t: Typing, fromBlockId: string, matcher: VariableMatcher): TypeResult {
  const source = t.graph.blocks.get(matcher.blockId);
  if (!source) return DELETED;
  const upstream = upstreamOf(t.graph, fromBlockId);
  if (!upstream.outcomes.get(matcher.blockId)?.has(matcher.outcome)) {
    return { code: 'inaccessible-variable', message: 'This variable is not accessible from this block' };
  }
  const outcome = outcomesOf(t, source).find((o) => o.slug === matcher.outcome);
  if (!outcome?.outputs) return DELETED;
  const [first, ...rest] = matcher.operations;
  if (!first || first.type !== 'field') return DELETED;
  const output = outcome.outputs.find((o) => o.key === first.name);
  if (!output) return DELETED;
  return applyOperationTypes(t.env, output.type, rest);
}
