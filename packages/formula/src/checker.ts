// Type checker (formulas.md §3.1–3.4): resolves references against the workspace schema, checks calls against the
// declaration table (arity → allowed literals → per-argument candidate matching → generic unification → return
// type) and produces a typed tree for the evaluator plus diagnostics. Every error is collected (the editor shows
// "Multiple errors (n)"); a sub-expression with an error does not produce follow-up errors.
import type { Expr, RawDiagnostic, Span } from './ast.ts';
import { type DiagnosticCode, type DiagnosticFix, diagnosticMessage, editDistance } from './diagnostics.ts';
import { FIELDS, fieldKind, IDENTITY_FIELDS, MEMBER_ACCESS_KINDS } from './fields.ts';
import { AUTOCOMPLETE_FUNCTIONS, type FunctionDecl, type FunctionName, lookupFunction } from './functions.ts';
import type { FormulaAnnotation, PathHop } from './source.ts';
import {
  arr,
  attrOf,
  coercible,
  type FType,
  KINDS,
  type Kind,
  matchesExactly,
  NULL,
  typeEquals,
  typeLabel,
  unwrapAttr,
  v,
} from './types.ts';
import type { RV } from './values.ts';

export interface SchemaAttribute {
  id: string;
  entityDefinitionId: string;
  title: string;
  type: Kind;
  isMultiselect: boolean;
  isArchived?: boolean;
  /** Record references: definitions the attribute may point to (null = any). */
  targetEntityDefinitionIds?: string[] | null;
}

/** Synchronous schema lookups (the server preloads the workspace schema; the editor uses its cache). */
export interface FormulaSchema {
  attribute(entityDefinitionId: string, attributeDefinitionId: string): SchemaAttribute | null | undefined;
  selectOption?(attributeDefinitionId: string, selectOptionId: string): { title: string } | null | undefined;
  pipelineStage?(attributeDefinitionId: string, pipelineStageId: string): { title: string } | null | undefined;
  actor?(type: string, id: string): { name: string | null; email: string | null } | null | undefined;
}

export interface ReferenceInfo {
  index: number;
  tokenId: string;
  annotation: FormulaAnnotation;
  /** Type of the reference expression: attr<…> without fan-out, plain value/array otherwise. */
  type: FType;
  /** entity-variable: the referenced (last hop) attribute, the path, singular/fan-out flags. */
  attribute: SchemaAttribute | null;
  path: PathHop[];
  field: string | null;
  singular: boolean;
  fanout: boolean;
  /** Some attribute along the path is archived (runtime error referenced-attribute-missing-or-archived). */
  archived: boolean;
  /** Used as the attribute argument of a history function: the evaluator needs its value history. */
  needsHistory: boolean;
}

export type TExpr =
  | { k: 'literal'; value: RV; type: FType }
  | { k: 'ref'; ref: number; type: FType }
  | { k: 'call'; fn: FunctionName; args: TExpr[]; targets: FType[]; type: FType }
  | { k: 'field'; object: TExpr; objectKind: Kind; field: string; type: FType }
  | { k: 'index'; object: TExpr; index: TExpr; type: FType }
  | { k: 'array'; elements: TExpr[]; target: FType; type: FType };

export interface CheckContext {
  /** Definition the formula belongs to: every path starts here. */
  entityDefinitionId: string;
  schema: FormulaSchema;
  tokens: Map<string, FormulaAnnotation>;
  /** Source text (for fix edits that rewrite sub-expressions). */
  text: string;
}

export interface CheckResult {
  expr: TExpr | null;
  diagnostics: RawDiagnostic[];
  references: ReferenceInfo[];
  usesNow: boolean;
}

const ERR = Symbol('error');
type Checked = TExpr | typeof ERR;

const UNIVERSAL_SCALARS = KINDS.length;

function describeExpected(candidates: FType[]): string {
  const attrs = candidates.filter((c) => c.t === 'attr');
  if (attrs.length === candidates.length && attrs.length >= UNIVERSAL_SCALARS * 2 - 2) return 'any attribute';
  if (candidates.length === UNIVERSAL_SCALARS * 2) return 'any | any[]';
  const labels = candidates.map(typeLabel);
  return labels.length > 3 ? `${labels.slice(0, 3).join(' | ')} | …` : labels.join(' | ');
}

class Checker {
  readonly diagnostics: RawDiagnostic[] = [];
  readonly references: ReferenceInfo[] = [];
  private readonly refByToken = new Map<string, number>();
  usesNow = false;

  constructor(private readonly ctx: CheckContext) {}

  private error(code: DiagnosticCode, span: Span, params?: Record<string, string>, fix?: DiagnosticFix): typeof ERR {
    this.diagnostics.push({
      code,
      message: diagnosticMessage(code, params),
      from: span.from,
      to: span.to,
      ...(fix ? { fix } : {}),
    });
    return ERR;
  }

  check(e: Expr): Checked {
    switch (e.type) {
      case 'number':
        return { k: 'literal', value: e.value, type: v('number') };
      case 'string':
        return { k: 'literal', value: e.value, type: v('text') };
      case 'bool':
        return { k: 'literal', value: e.value, type: v('checkbox') };
      case 'null':
        return { k: 'literal', value: null, type: NULL };
      case 'reference':
        return this.reference(e);
      case 'array':
        return this.array(e);
      case 'member':
        return this.member(e);
      case 'index':
        return this.index(e);
      case 'call':
        return this.call(e);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // References

  private reference(e: Extract<Expr, { type: 'reference' }>): Checked {
    const annotation = this.ctx.tokens.get(e.tokenId);
    if (!annotation) return this.error('UNKNOWN_VARIABLE', e);
    const { schema } = this.ctx;
    switch (annotation.type) {
      case 'select-option': {
        const option = schema.selectOption
          ? schema.selectOption(annotation.attributeDefinitionId, annotation.selectOptionId)
          : { title: '' };
        if (!option) return this.error('UNKNOWN_VARIABLE', e);
        return { k: 'literal', value: { id: annotation.selectOptionId, title: option.title }, type: v('select') };
      }
      case 'pipeline-stage': {
        const stage = schema.pipelineStage
          ? schema.pipelineStage(annotation.attributeDefinitionId, annotation.pipelineStageId)
          : { title: '' };
        if (!stage) return this.error('UNKNOWN_VARIABLE', e);
        return { k: 'literal', value: { id: annotation.pipelineStageId, title: stage.title }, type: v('pipeline') };
      }
      case 'actor-reference': {
        const actor = schema.actor ? schema.actor(annotation.referencedActorType, annotation.referencedActorId) : null;
        if (schema.actor && !actor) return this.error('UNKNOWN_VARIABLE', e);
        return {
          k: 'literal',
          value: {
            type: annotation.referencedActorType,
            id: annotation.referencedActorId,
            name: actor?.name ?? null,
            email: actor?.email ?? null,
          },
          type: v('actor-reference'),
        };
      }
      case 'entity-variable':
        return this.entityVariable(e, annotation);
    }
  }

  private entityVariable(
    e: Extract<Expr, { type: 'reference' }>,
    annotation: Extract<FormulaAnnotation, { type: 'entity-variable' }>,
  ): Checked {
    const existing = this.refByToken.get(e.tokenId);
    if (existing !== undefined) {
      const info = this.references[existing] as ReferenceInfo;
      return { k: 'ref', ref: info.index, type: info.type };
    }
    const path = annotation.path;
    if (path.length === 0) return this.error('INVALID_VARIABLE', e);
    if ((path[0] as PathHop).entityDefinitionId !== this.ctx.entityDefinitionId)
      return this.error('INVALID_VARIABLE', e);
    let singular = true;
    let fanout = false;
    let archived = false;
    let last: SchemaAttribute | null = null;
    for (let i = 0; i < path.length; i++) {
      const hop = path[i] as PathHop;
      const attr = this.ctx.schema.attribute(hop.entityDefinitionId, hop.attributeDefinitionId);
      if (!attr) return this.error('UNKNOWN_VARIABLE', e);
      if (attr.isArchived) archived = true;
      if (attr.isMultiselect) singular = false;
      if (i < path.length - 1) {
        if (attr.type !== 'entity-reference') return this.error('INVALID_VARIABLE', e);
        const next = path[i + 1] as PathHop;
        const targets = attr.targetEntityDefinitionIds;
        if (targets && targets.length > 0 && !targets.includes(next.entityDefinitionId)) {
          return this.error('INVALID_VARIABLE', e);
        }
        if (attr.isMultiselect) fanout = true;
      }
      last = attr;
    }
    const attr = last as SchemaAttribute;
    let kind: Kind = attr.type;
    let identity = true;
    if (annotation.field) {
      const k = fieldKind(attr.type, annotation.field);
      if (!k) return this.error('INVALID_VARIABLE', e);
      kind = k;
      identity = IDENTITY_FIELDS.has(annotation.field);
    }
    const valueType = singular ? v(kind) : arr(kind);
    const type = !fanout && identity ? attrOf(valueType) : valueType;
    const info: ReferenceInfo = {
      index: this.references.length,
      tokenId: e.tokenId,
      annotation,
      type,
      attribute: attr,
      path,
      field: annotation.field,
      singular,
      fanout,
      archived,
      needsHistory: false,
    };
    this.references.push(info);
    this.refByToken.set(e.tokenId, info.index);
    return { k: 'ref', ref: info.index, type };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Arrays, members, indexing

  private array(e: Extract<Expr, { type: 'array' }>): Checked {
    const elements = e.elements.map((x) => this.check(x));
    if (elements.some((x) => x === ERR)) return ERR;
    const typed = elements as TExpr[];
    if (typed.length === 0) return { k: 'array', elements: [], target: NULL, type: arr(NULL) };
    const types = typed.map((x) => unwrapAttr(x.type));
    const nonNull = types.filter((t) => t.t !== 'null');
    if (nonNull.length === 0) return { k: 'array', elements: typed, target: NULL, type: arr(NULL) };
    const target = nonNull.find((t) => types.every((o) => typeEquals(o, t) || coercible(o, t)));
    if (!target) {
      return this.error('INCOMPATIBLE_ARRAY_ELEMENT_TYPES', e, {
        elementTypes: [...new Set(types.map(typeLabel))].join(', '),
      });
    }
    return { k: 'array', elements: typed, target, type: arr(target) };
  }

  private member(e: Extract<Expr, { type: 'member' }>): Checked {
    const object = this.check(e.object);
    if (object === ERR) return ERR;
    const base = unwrapAttr(object.type);
    const scalar = base.t === 'array' ? base.element : base;
    if (scalar.t !== 'value' || !MEMBER_ACCESS_KINDS.has(scalar.kind)) {
      return this.error('UNSUPPORTED_FIELD_ACCESS', { from: e.object.to, to: e.to });
    }
    const kind = FIELDS[scalar.kind][e.key];
    if (!kind) return this.error('UNSUPPORTED_FIELD_ACCESS', e.keySpan);
    const type = base.t === 'array' ? arr(kind) : v(kind);
    return { k: 'field', object, objectKind: scalar.kind, field: e.key, type };
  }

  private index(e: Extract<Expr, { type: 'index' }>): Checked {
    const object = this.check(e.object);
    const index = this.check(e.index);
    if (object === ERR || index === ERR) return ERR;
    const base = unwrapAttr(object.type);
    if (base.t !== 'array' || base.element.t === 'array') {
      return this.error('INDEXED_ACCESS_NOT_SUPPORTED', e);
    }
    if (!coercible(index.type, v('number'))) {
      return this.error('INCOMPATIBLE_ARGUMENT_TYPES', e.index, {
        receivedType: typeLabel(index.type),
        expectedTypes: 'number',
      });
    }
    return { k: 'index', object, index, type: base.element };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Calls

  private nameFix(e: Extract<Expr, { type: 'call' }>, decl: FunctionDecl | null): DiagnosticFix | undefined {
    const { text } = this.ctx;
    if (decl?.operatorOnly && decl.operator && e.args.length === (decl.name === 'negate' ? 1 : 2)) {
      const src = e.args.map((a) => text.slice(a.from, a.to));
      const insert = decl.name === 'negate' ? `-(${src[0]})` : `${src[0]} ${decl.operator} ${src[1]}`;
      return { label: `Use the ${decl.operator} operator`, edits: [{ from: e.from, to: e.to, insert }] };
    }
    let best: { name: string; d: number } | null = null;
    for (const name of AUTOCOMPLETE_FUNCTIONS) {
      const d = editDistance(e.name, name);
      if (!best || d < best.d) best = { name, d };
    }
    if (best && best.d <= Math.max(1, Math.floor(e.name.length / 3))) {
      return {
        label: `Replace with ${best.name}()`,
        edits: [{ from: e.nameSpan.from, to: e.nameSpan.to, insert: best.name }],
      };
    }
    return undefined;
  }

  private call(e: Extract<Expr, { type: 'call' }>): Checked {
    const decl = lookupFunction(e.name);
    const args = e.args.map((a) => this.check(a));
    if (!decl || (decl.operatorOnly && e.operator === null)) {
      return this.error('INVALID_FUNCTION_NAME', e.nameSpan, { functionName: e.name }, this.nameFix(e, decl));
    }
    if (args.some((a) => a === ERR)) return ERR;
    const typed = args as TExpr[];
    const required = decl.params.filter((p) => !p.optional).length;
    if (typed.length < required || typed.length > decl.params.length) {
      return this.error('INVALID_ARGUMENT_COUNT', e, { functionName: decl.name });
    }
    let failed = false;
    // Allowed literal values (non-literal expressions are not checked).
    decl.params.forEach((param, i) => {
      const arg = typed[i];
      const src = e.args[i];
      if (!arg || !src || !param.allowedLiterals || src.type !== 'string') return;
      if (!param.allowedLiterals.includes(src.value)) {
        failed = true;
        const closest = [...param.allowedLiterals].sort(
          (a, b) => editDistance(src.value, a) - editDistance(src.value, b),
        )[0] as string;
        this.error(
          'INVALID_ARGUMENT_VALUE',
          src,
          {
            parameterName: param.name,
            allowedValues: param.allowedLiterals.map((x) => `"${x}"`).join(', '),
          },
          { label: `Use "${closest}"`, edits: [{ from: src.from, to: src.to, insert: `"${closest}"` }] },
        );
      }
    });
    // Candidate matching per argument.
    const bound = new Map<string, (FType | null)[]>();
    typed.forEach((arg, i) => {
      const param = decl.params[i];
      if (!param) return;
      const candidates = decl.generics[param.generic] ?? [];
      let binding: FType | null | undefined;
      const exact = candidates.find((c) => matchesExactly(arg.type, c));
      if (exact) binding = exact;
      else if (arg.type.t === 'null') binding = null;
      else binding = candidates.find((c) => coercible(arg.type, c));
      if (binding === undefined) {
        failed = true;
        this.error('INCOMPATIBLE_ARGUMENT_TYPES', e.args[i] as Span, {
          receivedType: typeLabel(arg.type),
          expectedTypes: describeExpected(candidates),
        });
        return;
      }
      bound.set(param.generic, [...(bound.get(param.generic) ?? []), binding]);
    });
    if (failed) return ERR;
    // Generic unification.
    const resolved = new Map<string, FType>();
    for (const [generic, candidates] of Object.entries(decl.generics)) {
      const types = (bound.get(generic) ?? []).filter((t): t is FType => t !== null);
      if (types.length === 0) {
        resolved.set(generic, candidates[0] ?? NULL);
        continue;
      }
      const winner = types.find((t) => types.every((o) => typeEquals(o, t) || coercible(o, t)));
      if (!winner) {
        return this.error('UNABLE_TO_COERCE_ARGUMENT_TYPES', e, {
          candidateTypes: [...new Set(types.map(typeLabel))].join(', '),
        });
      }
      resolved.set(generic, winner);
    }
    const targets = typed.map((_a, i) => resolved.get((decl.params[i] as { generic: string }).generic) ?? NULL);
    let type: FType;
    if ('type' in decl.returns) type = decl.returns.type;
    else {
      const r = resolved.get(decl.returns.generic) ?? NULL;
      if (decl.returns.unwrap === 'element') type = r.t === 'array' ? r.element : r;
      else if (decl.returns.unwrap === 'value') type = r.t === 'attr' ? r.value : r;
      else type = r;
    }
    if (decl.name === 'now' || decl.name === 'today') this.usesNow = true;
    if (decl.category === 'history') {
      const first = typed[0];
      if (first?.k === 'ref') (this.references[first.ref] as ReferenceInfo).needsHistory = true;
      // timeSpentIn without an end measures up to now.
      if (decl.name === 'timeSpentIn') this.usesNow = true;
    }
    return { k: 'call', fn: decl.name, args: typed, targets, type };
  }
}

export function checkExpression(expr: Expr, ctx: CheckContext): CheckResult {
  const checker = new Checker(ctx);
  const result = checker.check(expr);
  return {
    expr: result === ERR ? null : result,
    diagnostics: checker.diagnostics,
    references: checker.references,
    usesNow: checker.usesNow,
  };
}
