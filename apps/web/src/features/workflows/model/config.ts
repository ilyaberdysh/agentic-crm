// Config tree helpers for the configuration panel (internal-api §4; contracts/workflows.ts ConfigExpr): read and write
// one input of a block's root object, defaults from the catalogue, empty checks that match the server's validation,
// visibility (`visibleWhen`) and the rich-text ⇄ segments conversion used by the variable text input. Pure.
import type { BlockConfig, ConfigExpr, InputSpec, RichTextExpr, VariableExpr } from '@agentic-crm/contracts';

export function entryOf(config: BlockConfig | undefined, key: string): ConfigExpr | undefined {
  return config?.entries[key];
}

/** A copy of `config` with `key` set (or removed for undefined). */
export function withEntry(config: BlockConfig, key: string, value: ConfigExpr | undefined): BlockConfig {
  const entries = { ...config.entries };
  if (value === undefined) delete entries[key];
  else entries[key] = value;
  return { type: 'object', entries };
}

export function stringOf(expr: ConfigExpr | undefined): string | null {
  if (!expr) return null;
  if (expr.type === 'string') return expr.value;
  if (expr.type === 'json' && typeof expr.value === 'string') return expr.value;
  return null;
}

export function numberOf(expr: ConfigExpr | undefined): number | null {
  if (!expr) return null;
  if (expr.type === 'number') return expr.value;
  return null;
}

/** Object / list id of a definition input (agentic-crm-object, agentic-crm-list or a plain id string). */
export function definitionRef(expr: ConfigExpr | undefined): string | null {
  if (!expr) return null;
  if (expr.type === 'agentic-crm-object') return expr.entityDefinitionId;
  if (expr.type === 'agentic-crm-list') return expr.listId;
  if (expr.type === 'string') return expr.value || null;
  return null;
}

/** Same rule as the server's validation (validate.ts isEmptyExpr). */
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

/** The catalogue default of an input as a config expression (what the server assumes while it is unset). */
export function defaultExpr(spec: InputSpec): ConfigExpr | undefined {
  const d = spec.default;
  if (d === undefined || d === null) return undefined;
  if (spec.control === 'duration' && typeof d === 'object') {
    const v = d as { value: number; unit: string };
    return { type: 'duration', value: { type: 'number', value: v.value }, unit: v.unit as 'seconds' };
  }
  if (typeof d === 'number') return { type: 'number', value: d };
  if (typeof d === 'boolean') return { type: 'boolean', value: d };
  if (typeof d === 'string') return { type: 'string', value: d };
  return undefined;
}

/** The input's value or its default. */
export function valueOrDefault(config: BlockConfig, spec: InputSpec): ConfigExpr | undefined {
  const v = entryOf(config, spec.key);
  return v === undefined ? defaultExpr(spec) : v;
}

/** Whether an input shows for the current config (server isVisible: sibling value or its default). */
export function isVisible(spec: InputSpec, config: BlockConfig, specs: readonly InputSpec[]): boolean {
  const when = spec.visibleWhen;
  if (!when) return true;
  const sibling = specs.find((s) => s.key === when.key);
  const expr = entryOf(config, when.key) ?? (sibling ? defaultExpr(sibling) : undefined);
  let values: string[] = [];
  if (expr?.type === 'array') values = expr.items.map(stringOf).filter((v): v is string => v !== null);
  else {
    const v = stringOf(expr);
    if (v !== null) values = [v];
  }
  return values.some((v) => when.values.includes(v));
}

// ---- rich text ------------------------------------------------------------------------------------------------------

/** Text pieces and variables in reading order (one block; newlines stay in the text). */
export type Segment = string | VariableExpr;

export function richTextSegments(expr: ConfigExpr | undefined): Segment[] {
  if (!expr) return [];
  if (expr.type === 'string') return expr.value ? [expr.value] : [];
  if (expr.type === 'number') return [String(expr.value)];
  if (expr.type === 'variable') return [expr];
  if (expr.type !== 'rich-text') return [];
  const out: Segment[] = [];
  expr.blocks.forEach((block, bi) => {
    if (bi > 0) push(out, '\n');
    const vars = [...block.variables].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const v of vars) {
      if (v.start > cursor) push(out, block.plaintext.slice(cursor, v.start));
      out.push(v.variable);
      cursor = v.start + 1;
    }
    if (cursor < block.plaintext.length) push(out, block.plaintext.slice(cursor));
  });
  return out;
}

function push(out: Segment[], text: string) {
  if (!text) return;
  const last = out[out.length - 1];
  if (typeof last === 'string') out[out.length - 1] = last + text;
  else out.push(text);
}

/** Segments → rich text: one placeholder character `_` per variable (B.11; contracts cfg.text). */
export function segmentsToRichText(segments: readonly Segment[]): RichTextExpr {
  const blocks: RichTextExpr['blocks'] = [];
  let plaintext = '';
  let variables: RichTextExpr['blocks'][number]['variables'] = [];
  for (const seg of segments) {
    if (typeof seg === 'string') {
      const lines = seg.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) {
          blocks.push({ plaintext, variables });
          plaintext = '';
          variables = [];
        }
        plaintext += line;
      });
    } else {
      variables.push({ start: plaintext.length, variable: seg });
      plaintext += '_';
    }
  }
  blocks.push({ plaintext, variables });
  return { type: 'rich-text', blocks };
}

export function segmentsEmpty(segments: readonly Segment[]): boolean {
  return segments.every((s) => typeof s === 'string' && s.trim() === '');
}

/** The single variable of an input holding exactly one variable (record / number / task inputs), if any. */
export function soleVariable(expr: ConfigExpr | undefined): VariableExpr | null {
  if (!expr) return null;
  if (expr.type === 'variable') return expr;
  if (expr.type === 'rich-text') {
    const segs = richTextSegments(expr).filter((s) => typeof s !== 'string' || s.trim() !== '');
    if (segs.length === 1 && typeof segs[0] !== 'string') return segs[0] as VariableExpr;
  }
  return null;
}

/** Every variable inside an expression (rich text, conditions, arrays, filters). */
export function variablesIn(expr: ConfigExpr | undefined | null, out: VariableExpr[] = []): VariableExpr[] {
  if (!expr || typeof expr !== 'object') return out;
  switch (expr.type) {
    case 'variable':
      out.push(expr);
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
    default:
      break;
  }
  return out;
}

/** Issues of an input path (the panel shows the first message under the control). */
export function issueAt(issues: readonly { path: string[]; message: string }[], path: readonly string[]) {
  return issues.find((i) => i.path.length === path.length && i.path.every((p, k) => p === path[k]))?.message ?? null;
}

/** Issues on the input itself or below it (attributes to set, cases). */
export function issuesUnder(issues: readonly { path: string[]; message: string }[], key: string) {
  return issues.filter((i) => i.path[0] === key);
}
