// Variable picker model (README §3.1, internal-api §4, B.7): levels of the picker over `workflows.variables` (accessible
// blocks nearest first → a block's outputs → attributes of a record / sub-fields of composite values, drilling through
// references), the type of a data source after its operations (mirrors the server's applyOperationTypes), greying
// with `isAssignable`, and the chip label "{ Record action › … › Headcount }". Pure.
import {
  type Assignability,
  isAssignable,
  T,
  type VariableExpr,
  type VariableMatcher,
  type VariableOperation,
  WF_PROPERTIES,
  type WfType,
} from '@agentic-crm/contracts';

export interface PickerOutput {
  key: string;
  label: string;
  type: WfType;
}
export interface PickerBlock {
  blockId: string;
  slug: string;
  title: string;
  distance: number;
  outcomes: { slug: string; label: string; outputs: PickerOutput[] | null }[];
}
export interface PickerAttribute {
  id: string;
  apiSlug: string;
  title: string;
  attributeType: string;
  isMultiselect: boolean;
  type: WfType;
}
export interface PickerDefinition {
  id: string;
  kind: 'object' | 'list';
  title: string;
  attributes: PickerAttribute[];
}
export interface PickerData {
  blocks: PickerBlock[];
  definitions: PickerDefinition[];
}

/** Where the picker is: the block list, a block's outputs, or below a value. */
export type PickerCursor =
  | { level: 'blocks' }
  | { level: 'outputs'; blockId: string; outcome: string }
  | { level: 'value'; blockId: string; outcome: string; operations: VariableOperation[] };

export interface PickerItem {
  key: string;
  label: string;
  /** null = an outcome without data ("If (True)  no data"). */
  type: WfType | null;
  blockId: string;
  outcome: string;
  operations: VariableOperation[];
  /** Number of children (shown before the chevron); 0 = a leaf. */
  childCount: number;
  /** Attribute type for the row icon (attribute rows). */
  attributeType?: string;
  /** Picker row state for the expected input type. */
  state: 'ok' | 'warning' | 'disabled';
}

const single = (t: WfType): WfType => (t.kind === 'array' ? t.of : t);

export function definitionOf(data: PickerData, id: string | null | undefined): PickerDefinition | undefined {
  return id ? data.definitions.find((d) => d.id === id) : undefined;
}

/** Child rows of a value of `type` (attributes of a record, sub-fields of composite values, object fields). */
function childrenOf(
  data: PickerData,
  type: WfType,
): { label: string; type: WfType; op: VariableOperation; attributeType?: string }[] {
  const many = type.kind === 'array';
  const one = single(type);
  const wrap = (t: WfType) => (many && t.kind !== 'array' ? T.array(t) : t);
  if (one.kind === 'record') {
    const def = definitionOf(data, one.entityDefinitionId);
    if (!def) return [];
    return def.attributes.map((a) => ({
      label: a.title,
      type: wrap(a.type),
      op: { type: 'attribute', entityDefinitionId: def.id, attributeDefinitionId: a.id },
      attributeType: a.attributeType,
    }));
  }
  if (one.kind === 'object') {
    return Object.entries(one.fields).map(([name, t]) => ({ label: name, type: wrap(t), op: { type: 'field', name } }));
  }
  const props = WF_PROPERTIES[one.kind];
  if (!props) return [];
  return Object.entries(props).map(([name, p]) => ({
    label: p.label,
    type: wrap(p.type),
    op: { type: 'property', name },
  }));
}

export function childCount(data: PickerData, type: WfType | null): number {
  return type ? childrenOf(data, type).length : 0;
}

/** Row state: incompatible leaves are disabled; incompatible values that can be drilled into carry a warning. */
export function itemState(type: WfType | null, expected: WfType | undefined, children: number): PickerItem['state'] {
  if (!type) return 'disabled';
  if (!expected) return 'ok';
  const a: Assignability = isAssignable(type, expected);
  if (a !== 'incompatible') return 'ok';
  return children > 0 ? 'warning' : 'disabled';
}

/** Label of a record-typed output: the object's singular noun ("[seed] Project"), else the output's own label. */
function outputLabel(data: PickerData, output: PickerOutput): string {
  const one = single(output.type);
  if (one.kind === 'record' && output.type.kind !== 'array')
    return definitionOf(data, one.entityDefinitionId)?.title ?? output.label;
  return output.label;
}

export function blockRowLabel(block: PickerBlock, outcome: PickerBlock['outcomes'][number]): string {
  return block.outcomes.length > 1 || outcome.slug !== 'done' ? `${block.title} (${outcome.label})` : block.title;
}

/** Rows of the first level: one per accessible block (and per outcome when it has several). */
export function blockRows(data: PickerData): {
  key: string;
  label: string;
  title: string;
  outcomeLabel: string | null;
  blockId: string;
  outcome: string;
  outputCount: number;
  noData: boolean;
}[] {
  const rows = [];
  for (const b of [...data.blocks].sort((x, y) => x.distance - y.distance)) {
    for (const o of b.outcomes) {
      const showOutcome = b.outcomes.length > 1 || o.outputs === null || o.slug !== 'done';
      rows.push({
        key: `${b.blockId}:${o.slug}`,
        label: blockRowLabel(b, o),
        title: b.title,
        outcomeLabel: showOutcome ? o.label : null,
        blockId: b.blockId,
        outcome: o.slug,
        outputCount: o.outputs?.length ?? 0,
        noData: o.outputs === null || o.outputs.length === 0,
      });
    }
  }
  return rows;
}

/** Items of a non-root level, plus the item standing for the value itself (the record row at the top of level 3). */
export function levelItems(
  data: PickerData,
  cursor: Exclude<PickerCursor, { level: 'blocks' }>,
  expected?: WfType,
): { self: PickerItem | null; items: PickerItem[] } {
  const block = data.blocks.find((b) => b.blockId === cursor.blockId);
  const outcome = block?.outcomes.find((o) => o.slug === cursor.outcome);
  if (!block || !outcome?.outputs) return { self: null, items: [] };
  if (cursor.level === 'outputs') {
    return {
      self: null,
      items: outcome.outputs.map((out) => {
        const n = childCount(data, out.type);
        return {
          key: out.key,
          label: outputLabel(data, out),
          type: out.type,
          blockId: block.blockId,
          outcome: outcome.slug,
          operations: [{ type: 'field', name: out.key }],
          childCount: n,
          state: itemState(out.type, expected, n),
        };
      }),
    };
  }
  const type = typeOfOperations(data, block.blockId, outcome.slug, cursor.operations);
  if (!type) return { self: null, items: [] };
  const selfChildren = childCount(data, type);
  const self: PickerItem = {
    key: 'self',
    label: pathLabels(data, block.title, outcome, cursor.operations).slice(-1)[0] ?? block.title,
    type,
    blockId: block.blockId,
    outcome: outcome.slug,
    operations: cursor.operations,
    childCount: 0,
    state: itemState(type, expected, 0) === 'disabled' ? (selfChildren > 0 ? 'warning' : 'disabled') : 'ok',
  };
  const items = childrenOf(data, type).map((c, i) => {
    const n = childCount(data, c.type);
    return {
      key: `${i}:${c.label}`,
      label: c.label,
      type: c.type,
      blockId: block.blockId,
      outcome: outcome.slug,
      operations: [...cursor.operations, c.op],
      childCount: n,
      ...(c.attributeType ? { attributeType: c.attributeType } : {}),
      state: itemState(c.type, expected, n),
    };
  });
  return { self, items };
}

/** Type of a data source after its operations (null = deleted / unknown). */
export function typeOfOperations(
  data: PickerData,
  blockId: string,
  outcomeSlug: string,
  operations: readonly VariableOperation[],
): WfType | null {
  const block = data.blocks.find((b) => b.blockId === blockId);
  const outcome = block?.outcomes.find((o) => o.slug === outcomeSlug);
  const [first, ...rest] = operations;
  if (!outcome?.outputs || !first || first.type !== 'field') return null;
  let current: WfType | undefined = outcome.outputs.find((o) => o.key === first.name)?.type;
  if (!current) return null;
  for (const op of rest) {
    const many: boolean = current.kind === 'array';
    const one: WfType = single(current);
    let next: WfType | undefined;
    if (op.type === 'attribute') {
      if (one.kind !== 'record') return null;
      next = definitionOf(data, op.entityDefinitionId)?.attributes.find((a) => a.id === op.attributeDefinitionId)?.type;
      if (next && many && next.kind !== 'array') next = T.array(next);
    } else if (op.type === 'property') {
      const prop: WfType | undefined =
        one.kind === 'object' ? one.fields[op.name] : WF_PROPERTIES[one.kind]?.[op.name]?.type;
      next = prop && many ? T.array(prop) : prop;
    } else if (op.type === 'index') {
      next = many ? one : undefined;
    } else if (one.kind === 'object') {
      const field = one.fields[op.name];
      next = field && many ? T.array(field) : field;
    } else if (one.kind === 'json') next = T.json;
    if (!next) return null;
    current = next;
  }
  return current;
}

/** Labels along a data source: [block, output, attribute…]. */
function pathLabels(
  data: PickerData,
  blockTitle: string,
  outcome: { slug: string; label: string; outputs: PickerOutput[] | null } | undefined,
  operations: readonly VariableOperation[],
): string[] {
  const labels = [
    outcome && outcome.slug !== 'done' && outcome.slug !== 'next' ? `${blockTitle} (${outcome.label})` : blockTitle,
  ];
  const [first, ...rest] = operations;
  if (!first || first.type !== 'field') return labels;
  const output = outcome?.outputs?.find((o) => o.key === first.name);
  labels.push(output ? outputLabel(data, output) : first.name);
  for (const op of rest) {
    if (op.type === 'attribute') {
      const def = definitionOf(data, op.entityDefinitionId);
      labels.push(def?.attributes.find((a) => a.id === op.attributeDefinitionId)?.title ?? 'Unknown attribute');
    } else if (op.type === 'property') {
      const prop = Object.values(WF_PROPERTIES).find((p) => p?.[op.name])?.[op.name];
      labels.push(prop?.label ?? op.name);
    } else if (op.type === 'index') labels.push(op.index === -1 ? 'Last' : `#${op.index + 1}`);
    else labels.push(op.name);
  }
  return labels;
}

export interface ChipLabel {
  /** Full path, for the tooltip. */
  segments: string[];
  /** Shown: first › ⋯ › last when longer than two (README §3.1 "middle segments collapse to ⋯"). */
  shown: string[];
  /** The data source no longer resolves (deleted block / attribute). */
  broken: boolean;
}

/**
 * Chip label of a variable (first data source). `blockTitle` resolves blocks the picker does not list (inaccessible
 * from this block, or the picker has not loaded).
 */
export function chipLabel(
  data: PickerData | undefined,
  variable: VariableExpr,
  blockTitle: (blockId: string) => string | null,
): ChipLabel {
  const m = variable.matchers[0] as VariableMatcher | undefined;
  if (!m) return { segments: ['Unknown'], shown: ['Unknown'], broken: true };
  const block = data?.blocks.find((b) => b.blockId === m.blockId);
  const title = block?.title ?? blockTitle(m.blockId);
  if (!title) return { segments: ['Deleted variable'], shown: ['Deleted variable'], broken: true };
  const outcome = block?.outcomes.find((o) => o.slug === m.outcome);
  const segments = data
    ? pathLabels(data, title, outcome, m.operations)
    : [title, ...m.operations.map((op) => (op.type === 'field' || op.type === 'property' ? op.name : '…'))];
  const broken = data ? !block || typeOfOperations(data, m.blockId, m.outcome, m.operations) === null : false;
  const shown = segments.length > 2 ? [segments[0] as string, '⋯', segments[segments.length - 1] as string] : segments;
  return { segments, shown, broken };
}

/** Type of a variable's first data source (null while unknown). */
export function variableTypeOf(data: PickerData | undefined, variable: VariableExpr): WfType | null {
  const m = variable.matchers[0];
  if (!data || !m) return null;
  return typeOfOperations(data, m.blockId, m.outcome, m.operations);
}

export function makeVariable(blockId: string, outcome: string, operations: VariableOperation[]): VariableExpr {
  return {
    type: 'variable',
    matchers: [{ id: `${blockId}:${outcome}:${Math.random().toString(36).slice(2, 8)}`, blockId, outcome, operations }],
  };
}

/** A further data source ("Add data source"): first non-empty wins. */
export function addDataSource(variable: VariableExpr, source: VariableExpr): VariableExpr {
  return { ...variable, matchers: [...variable.matchers, ...source.matchers].slice(0, 10) };
}
