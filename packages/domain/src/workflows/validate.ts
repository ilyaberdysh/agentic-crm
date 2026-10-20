// Edit-time validation of a version graph (README §3.3 "Validation before publish"; the per-block checks and the
// Checklist): required inputs, references to objects / lists / attributes, static values against the attribute type,
// variables (deleted, not accessible from the block, incompatible with the input type), conditions, schedules and
// connections. Issues carry the input path inside the config so the panel can show "This input is required." under the
// right field. Publishing needs a graph without issues, at least one trigger and at least one step.
import {
  type BlockConfig,
  type BlockIssue,
  blockDefinition,
  type ConfigExpr,
  type InputSpec,
  isAssignable,
  UNARY_CONDITION_OPERATORS,
  type VariableExpr,
  valueInputSchemas,
  type WfType,
  WORKFLOW_LIMITS,
} from '@agentic-crm/contracts';
import type { AttrDef, DefInfo } from '../schema/model.ts';
import { scheduleOf } from './cron.ts';
import {
  attributeType,
  type BlockRow,
  definitionRef,
  entryOf,
  type Graph,
  isListDef,
  isObjectDef,
  outcomesOf,
  reachableFromTriggers,
  stringOf,
  type Typing,
  variableType,
} from './graph.ts';

const REQUIRED = 'This input is required.';

export function isEmptyExpr(expr: ConfigExpr | undefined | null): boolean {
  if (!expr) return true;
  switch (expr.type) {
    case 'null':
      return true;
    case 'string':
      return expr.value.trim() === '';
    case 'rich-text':
      return expr.blocks.every((b) => b.variables.length === 0 && b.plaintext.trim() === '');
    case 'array':
      return expr.items.length === 0;
    case 'predicate-group':
      return expr.predicates.length === 0;
    case 'filter':
      return expr.predicate === null;
    case 'value':
    case 'json':
      return expr.value === null || expr.value === undefined || expr.value === '';
    default:
      return false;
  }
}

/** Every variable inside an expression (rich text, conditions, filter constraint values included). */
export function variablesIn(expr: ConfigExpr | undefined | null, out: VariableExpr[] = []): VariableExpr[] {
  if (!expr || typeof expr !== 'object') return out;
  switch (expr.type) {
    case 'variable':
      out.push(expr);
      if (expr.fallback) variablesIn(expr.fallback, out);
      break;
    case 'rich-text':
      for (const b of expr.blocks) for (const v of b.variables) out.push(v.variable);
      break;
    case 'object':
      for (const e of Object.values(expr.entries)) variablesIn(e, out);
      break;
    case 'array':
      for (const e of expr.items) variablesIn(e, out);
      break;
    case 'duration':
      variablesIn(expr.value, out);
      break;
    case 'binary-predicate':
      variablesIn(expr.left, out);
      variablesIn(expr.right, out);
      break;
    case 'predicate-group':
      for (const p of expr.predicates) variablesIn(p, out);
      break;
    case 'filter':
      collectFilterVariables(expr.predicate, out);
      break;
    default:
      break;
  }
  return out;
}

function collectFilterVariables(p: unknown, out: VariableExpr[]): void {
  if (!p || typeof p !== 'object') return;
  const node = p as { and?: unknown[]; or?: unknown[]; constraints?: { value?: unknown }[] };
  for (const c of node.and ?? []) collectFilterVariables(c, out);
  for (const c of node.or ?? []) collectFilterVariables(c, out);
  for (const c of node.constraints ?? []) {
    const v = c.value as ConfigExpr | undefined;
    if (v && typeof v === 'object' && (v as { type?: string }).type === 'variable') variablesIn(v, out);
  }
}

class Collector {
  readonly issues: BlockIssue[] = [];
  add(path: string[], code: BlockIssue['code'], message: string): void {
    if (this.issues.some((i) => i.code === code && i.path.join('.') === path.join('.'))) return;
    this.issues.push({ path, code, message });
  }
}

/** Whether an input is shown for the current config (`visibleWhen` on a sibling input, its default when unset). */
export function isVisible(spec: InputSpec, config: BlockConfig, defaults: Map<string, unknown>): boolean {
  const when = spec.visibleWhen;
  if (!when) return true;
  const expr = entryOf(config, when.key);
  let values: string[];
  if (expr === undefined) {
    const fallback = defaults.get(when.key);
    values = fallback === undefined ? [] : [String(fallback)];
  } else if (expr.type === 'array') {
    values = expr.items.map((i) => stringOf(i)).filter((v): v is string => v !== null);
  } else {
    const v = stringOf(expr);
    values = v === null ? [] : [v];
  }
  return values.some((v) => when.values.includes(v));
}

/** Type check of one variable against an expected type (each data source and the fallback). */
function checkVariable(
  t: Typing,
  block: BlockRow,
  v: VariableExpr,
  expected: WfType | undefined,
  path: string[],
  c: Collector,
) {
  for (const m of v.matchers) {
    const r = variableType(t, block.id, m);
    if ('code' in r) {
      c.add(path, r.code, r.message);
      continue;
    }
    if (expected && isAssignable(r.type, expected) === 'incompatible') {
      c.add(path, 'type-mismatch', 'This variable is not compatible with this input');
    }
  }
}

function checkAllVariables(t: Typing, block: BlockRow, expr: ConfigExpr | undefined, path: string[], c: Collector) {
  for (const v of variablesIn(expr)) checkVariable(t, block, v, undefined, path, c);
}

function defOfInput(t: Typing, config: BlockConfig, key: string | undefined): DefInfo | undefined {
  return key ? t.env.def(definitionRef(entryOf(config, key))) : undefined;
}

function checkStaticAttributeValue(attr: AttrDef, value: unknown): boolean {
  const schema = valueInputSchemas[attr.type];
  if (attr.isMultiselect && Array.isArray(value)) return value.every((v) => schema.safeParse(v).success);
  return schema.safeParse(value).success;
}

const NOT_WRITABLE_SYSTEM = new Set(['id', 'created-at', 'created-by', 'list-entries', 'entry-parent-record']);

function checkConfiguredAttributes(t: Typing, block: BlockRow, spec: InputSpec, expr: ConfigExpr, c: Collector) {
  const def = defOfInput(t, block.config, spec.of);
  if (expr.type !== 'object') {
    c.add([spec.key], 'invalid', 'Invalid attributes');
    return;
  }
  for (const [attrId, entry] of Object.entries(expr.entries)) {
    const path = [spec.key, attrId];
    const attr = def?.byId.get(attrId) ?? def?.bySlug.get(attrId);
    if (!attr || attr.isArchived) {
      c.add(path, 'invalid', 'This attribute no longer exists');
      continue;
    }
    if (attr.isReadOnly || NOT_WRITABLE_SYSTEM.has(attr.systemAttributeType ?? '')) {
      c.add(path, 'invalid', 'This attribute cannot be set by a workflow');
      continue;
    }
    const value = entry.type === 'object' && 'value' in entry.entries ? entry.entries.value : entry;
    if (!value || value.type === 'null') continue;
    const expected = attributeType(attr);
    if (value.type === 'value' && !checkStaticAttributeValue(attr, value.value)) {
      c.add(path, 'invalid', `Invalid value for "${attr.title}"`);
    } else if (value.type === 'array') {
      for (const item of value.items) {
        if (item.type === 'value' && !checkStaticAttributeValue(attr, item.value)) {
          c.add(path, 'invalid', `Invalid value for "${attr.title}"`);
        }
        if (item.type === 'variable') {
          checkVariable(t, block, item, expected.kind === 'array' ? expected.of : expected, path, c);
        }
      }
    } else if (value.type === 'variable') {
      checkVariable(t, block, value, expected, path, c);
    } else checkAllVariables(t, block, value, path, c);
  }
}

function checkCondition(t: Typing, block: BlockRow, expr: ConfigExpr | null | undefined, path: string[], c: Collector) {
  if (!expr) {
    c.add(path, 'required', REQUIRED);
    return;
  }
  if (expr.type === 'predicate-group') {
    if (expr.predicates.length === 0) c.add(path, 'required', 'Add a condition');
    for (const p of expr.predicates) checkCondition(t, block, p, path, c);
    return;
  }
  if (expr.type !== 'binary-predicate') {
    c.add(path, 'invalid', 'Invalid condition');
    return;
  }
  if (expr.left.type !== 'variable') {
    c.add(path, 'invalid', 'A condition needs a variable to compare');
    return;
  }
  let leftType: WfType | undefined;
  for (const m of expr.left.matchers) {
    const r = variableType(t, block.id, m);
    if ('code' in r) c.add(path, r.code, r.message);
    else leftType ??= r.type;
  }
  if (UNARY_CONDITION_OPERATORS.has(expr.operator)) return;
  if (isEmptyExpr(expr.right ?? undefined)) {
    c.add(path, 'required', 'This condition needs a value');
    return;
  }
  const right = expr.right as ConfigExpr;
  if (right.type === 'variable') {
    const compare = leftType?.kind === 'array' ? leftType.of : leftType;
    for (const m of right.matchers) {
      const r = variableType(t, block.id, m);
      if ('code' in r) c.add(path, r.code, r.message);
      else if (
        compare &&
        isAssignable(r.type, compare) === 'incompatible' &&
        isAssignable(compare, r.type) === 'incompatible'
      ) {
        c.add(path, 'type-mismatch', 'This variable is not compatible with this input');
      }
    }
  } else checkAllVariables(t, block, right, path, c);
}

function checkFilter(t: Typing, block: BlockRow, spec: InputSpec, expr: ConfigExpr, c: Collector) {
  if (expr.type !== 'filter') {
    c.add([spec.key], 'invalid', 'Invalid filter');
    return;
  }
  const def = defOfInput(t, block.config, spec.of);
  const walk = (p: unknown): void => {
    if (!p || typeof p !== 'object') return;
    const node = p as {
      and?: unknown[];
      or?: unknown[];
      path?: { entityDefinitionId: string; attributeDefinitionId: string }[];
    };
    for (const child of node.and ?? []) walk(child);
    for (const child of node.or ?? []) walk(child);
    const first = node.path?.[0];
    if (first && (!def || first.entityDefinitionId !== def.id || !def.byId.has(first.attributeDefinitionId))) {
      c.add([spec.key], 'invalid', 'This filter uses an attribute that does not exist');
    }
  };
  walk(expr.predicate);
  checkAllVariables(t, block, expr, [spec.key], c);
}

function checkInput(t: Typing, block: BlockRow, spec: InputSpec, c: Collector) {
  const expr = entryOf(block.config, spec.key);
  const path = [spec.key];
  if (isEmptyExpr(expr)) {
    if (spec.required && spec.default === undefined) c.add(path, 'required', REQUIRED);
    return;
  }
  const value = expr as ConfigExpr;
  switch (spec.control) {
    case 'object':
    case 'list':
    case 'object-or-list': {
      const def = t.env.def(definitionRef(value));
      const ok =
        def &&
        !def.isArchived &&
        (spec.control === 'object'
          ? isObjectDef(def)
          : spec.control === 'list'
            ? isListDef(def)
            : isObjectDef(def) || isListDef(def));
      if (!ok) {
        c.add(
          path,
          'invalid',
          `This input references ${spec.control === 'list' ? 'a list' : 'an object'} which does not exist.`,
        );
      }
      return;
    }
    case 'attribute':
    case 'unique-attribute': {
      const def = defOfInput(t, block.config, spec.of);
      const attrId = value.type === 'agentic-crm-attribute' ? value.attributeDefinitionId : stringOf(value);
      const attr = attrId ? (def?.byId.get(attrId) ?? def?.bySlug.get(attrId)) : undefined;
      if (!attr || attr.isArchived) c.add(path, 'invalid', 'This input references an attribute which does not exist.');
      else if (spec.control === 'unique-attribute' && !attr.isUnique)
        c.add(path, 'invalid', 'The matching attribute must be unique');
      return;
    }
    case 'configured-attributes':
      checkConfiguredAttributes(t, block, spec, value, c);
      return;
    case 'predicate':
      checkCondition(t, block, value, path, c);
      return;
    case 'cases': {
      if (value.type !== 'array' || value.items.length === 0) {
        c.add(path, 'required', 'Add a case');
        return;
      }
      value.items.forEach((item, i) => {
        const pred = item.type === 'object' ? item.entries.predicate : undefined;
        checkCondition(t, block, pred, [spec.key, String(i)], c);
      });
      return;
    }
    case 'filter':
      checkFilter(t, block, spec, value, c);
      return;
    case 'enum': {
      const s = stringOf(value);
      if (spec.options && (s === null || !spec.options.some((o) => o.value === s)))
        c.add(path, 'invalid', 'Invalid option');
      return;
    }
    case 'enum-multi': {
      const ok = value.type === 'array' && value.items.every((i) => spec.options?.some((o) => o.value === stringOf(i)));
      if (!ok) c.add(path, 'invalid', 'Invalid option');
      return;
    }
    case 'number': {
      if (value.type === 'number') {
        if (spec.key === 'limit' && (value.value < 1 || value.value > WORKFLOW_LIMITS.findMaxLimit)) {
          c.add(path, 'invalid', `The limit must be between 1 and ${WORKFLOW_LIMITS.findMaxLimit}`);
        }
        return;
      }
      break;
    }
    case 'json-schema': {
      const s = stringOf(value);
      try {
        JSON.parse(s ?? '');
      } catch {
        c.add(path, 'invalid', 'Invalid JSON schema');
      }
      return;
    }
    case 'duration': {
      if (value.type !== 'duration') {
        c.add(path, 'invalid', 'Invalid duration');
        return;
      }
      if (value.value.type === 'variable') checkVariable(t, block, value.value, spec.valueType, path, c);
      else if (value.value.type !== 'number' || value.value.value < 0) c.add(path, 'invalid', 'Invalid duration');
      return;
    }
    default:
      break;
  }
  if (value.type === 'variable') checkVariable(t, block, value, spec.valueType, path, c);
  else checkAllVariables(t, block, value, path, c);
}

/** Issues of every block of the graph. */
export function validateGraph(t: Typing): Map<string, BlockIssue[]> {
  const out = new Map<string, BlockIssue[]>();
  const graph: Graph = t.graph;
  const reachable = reachableFromTriggers(graph);
  const outgoing = new Map<string, number>();
  for (const p of graph.paths) outgoing.set(p.source_block_id, (outgoing.get(p.source_block_id) ?? 0) + 1);
  for (const block of graph.blocks.values()) {
    const c = new Collector();
    const def = blockDefinition(block.slug);
    if (!def) {
      c.add([], 'unknown-block', 'This block is not available');
      out.set(block.id, c.issues);
      continue;
    }
    if (!def.available) c.add([], 'not-available', 'This block is not available yet');
    if (def.blockType !== block.block_type) c.add([], 'unknown-block', 'This block is not available');
    const defaults = new Map(def.inputs.map((s) => [s.key, s.default]));
    for (const spec of def.inputs) {
      if (!isVisible(spec, block.config, defaults)) continue;
      checkInput(t, block, spec, c);
    }
    if (block.slug === 'on-recurring-schedule') {
      const schedule = scheduleOf(block.config);
      if ('error' in schedule) c.add([schedule.path], 'invalid', schedule.error);
    }
    if (block.block_type === 'trigger') {
      if (!outgoing.get(block.id)) c.add([], 'no-next-step', 'This trigger is not connected to any steps');
    } else if (!reachable.has(block.id)) {
      c.add([], 'not-connected', 'This step is not connected to a trigger');
    }
    const outcomes = new Set(outcomesOf(t, block).map((o) => o.slug));
    for (const p of graph.paths) {
      if (p.source_block_id !== block.id) continue;
      const target = graph.blocks.get(p.target_block_id);
      if (!outcomes.has(p.source_outcome) || !target || target.block_type === 'trigger') {
        c.add([], 'invalid-connection', 'This step has an invalid outbound connection');
      }
    }
    out.set(block.id, c.issues);
  }
  return out;
}

export interface Checklist {
  errorCount: number;
  blocksWithErrors: string[];
  messages: string[];
}

/** The Checklist and the publish errors. */
export function checklistOf(graph: Graph, issues: Map<string, BlockIssue[]>): Checklist {
  const blocksWithErrors = [...issues.entries()].filter(([, list]) => list.length > 0).map(([id]) => id);
  const errorCount = [...issues.values()].reduce((n, list) => n + list.length, 0);
  const messages: string[] = [];
  const blocks = [...graph.blocks.values()];
  if (!blocks.some((b) => b.block_type === 'trigger')) messages.push('Workflow must have a trigger');
  if (!blocks.some((b) => b.block_type === 'step')) messages.push('Workflow must have at least one step');
  if (blocks.length > WORKFLOW_LIMITS.maxBlocks) {
    messages.push(`Workflows can have a maximum of ${WORKFLOW_LIMITS.maxBlocks} blocks`);
  }
  if (errorCount > 0) {
    messages.push(`${blocksWithErrors.length} blocks have errors`);
  }
  return { errorCount, blocksWithErrors, messages };
}
