// Entry points: compile a formula (parse → check → output type) and evaluate it for one record.
//   compileFormula(source, options)   stored form (plaintext + annotations); diagnostics in plaintext offsets
//   compileEditorText(text, tokens, options)   editor text with `_{id}` tokens; diagnostics in editor offsets
//   evaluateFormula(compiled, env)    → {type:'complete', value, outputValue} | {type:'evaluation_error', code}
import { parseFormula, type RawDiagnostic } from './ast.ts';
import { checkExpression, type FormulaSchema, type ReferenceInfo, type TExpr } from './checker.ts';
import {
  type Diagnostic,
  diagnosticMessage,
  FormulaRuntimeError,
  type RuntimeErrorCode,
  type SaveErrorCode,
} from './diagnostics.ts';
import { type EvalEnv, evaluateTyped } from './evaluator.ts';
import { checkOutput, type OutputKind, type OutputOverride, previewText, toOutputValue } from './output.ts';
import {
  type EditorSource,
  type FormulaAnnotation,
  type FormulaSource,
  fromEditorSource,
  lineColumn,
  toEditorSource,
  validateSource,
} from './source.ts';
import type { FType } from './types.ts';
import type { RV } from './values.ts';

export interface CompileOptions {
  /** The definition the formula attribute belongs to (object or list). */
  entityDefinitionId: string;
  schema: FormulaSchema;
  outputTypeOverride?: OutputOverride | null;
  /** Accept `$n` placeholders (AI generation output). */
  allowLlmReferences?: boolean;
}

export interface CompiledFormula {
  /** Empty formula (whitespace / comments only): no diagnostics, but cannot be saved (FORMULA_EMPTY). */
  empty: boolean;
  /** No diagnostics and not empty: can be saved and evaluated. */
  ok: boolean;
  diagnostics: Diagnostic[];
  expr: TExpr | null;
  /** Checked type of the expression (before output conversion). */
  resultType: FType | null;
  /** "Auto" output type (null = none). */
  inferredOutputType: OutputKind | null;
  /** Stored attribute type: override ?? inferred ?? text. */
  outputType: OutputKind;
  outputTypeOverride: OutputOverride | null;
  references: ReferenceInfo[];
  /** Uses now() / today() (recomputed daily). */
  usesNow: boolean;
}

function finalize(raw: RawDiagnostic[], text: string, mapOffset: (o: number) => number): Diagnostic[] {
  return raw
    .map((d) => {
      const from = mapOffset(d.from);
      const to = Math.max(from, mapOffset(d.to));
      const start = lineColumn(text, from);
      const end = lineColumn(text, to);
      return {
        code: d.code,
        message: d.message,
        severity: 'error' as const,
        from,
        to,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
        ...(d.fix
          ? {
              fix: {
                label: d.fix.label,
                edits: d.fix.edits.map((e) => ({ from: mapOffset(e.from), to: mapOffset(e.to), insert: e.insert })),
              },
            }
          : {}),
      };
    })
    .sort((a, b) => a.from - b.from);
}

function compileCore(
  editor: EditorSource,
  options: CompileOptions,
  reportText: string,
  mapOffset: (o: number) => number,
): CompiledFormula {
  const override = options.outputTypeOverride ?? null;
  const base = {
    expr: null,
    resultType: null,
    inferredOutputType: null,
    outputType: (override ?? 'text') as OutputKind,
    outputTypeOverride: override,
    references: [],
    usesNow: false,
  };
  const parsed = parseFormula(editor.text, { allowLlmReferences: options.allowLlmReferences ?? false });
  if (parsed.diagnostics.length > 0) {
    return { ...base, empty: false, ok: false, diagnostics: finalize(parsed.diagnostics, reportText, mapOffset) };
  }
  if (!parsed.expr) return { ...base, empty: true, ok: false, diagnostics: [] };
  const checked = checkExpression(parsed.expr, {
    entityDefinitionId: options.entityDefinitionId,
    schema: options.schema,
    tokens: editor.tokens,
    text: editor.text,
  });
  const raw = [...checked.diagnostics];
  let output = { inferred: null as OutputKind | null, attributeType: (override ?? 'text') as OutputKind };
  if (checked.expr) {
    const o = checkOutput(checked.expr.type, override);
    output = { inferred: o.inferred, attributeType: o.attributeType };
    if (o.unsupported !== null) {
      raw.push({
        code: 'UNSUPPORTED_OUTPUT_TYPE',
        message: diagnosticMessage('UNSUPPORTED_OUTPUT_TYPE', { receivedType: o.unsupported }),
        from: parsed.expr.from,
        to: parsed.expr.to,
      });
    }
  }
  const diagnostics = finalize(raw, reportText, mapOffset);
  return {
    empty: false,
    ok: diagnostics.length === 0 && checked.expr !== null,
    diagnostics,
    expr: checked.expr,
    resultType: checked.expr?.type ?? null,
    inferredOutputType: output.inferred,
    outputType: output.attributeType,
    outputTypeOverride: override,
    references: checked.references,
    usesNow: checked.usesNow,
  };
}

/** Compiles editor text (`_{id}` tokens bound by `tokens`); diagnostics use editor offsets. */
export function compileEditorText(
  text: string,
  tokens: Map<string, FormulaAnnotation>,
  options: CompileOptions,
): CompiledFormula {
  return compileCore({ text, tokens }, options, text, (o) => o);
}

/** Compiles a stored formula (plaintext + annotations); diagnostics use plaintext offsets. */
export function compileFormula(source: FormulaSource, options: CompileOptions): CompiledFormula {
  const editor = toEditorSource(source);
  const compiled = compileCore(editor, options, source.plaintext, (o) => editor.map.toPlain(o));
  const problems = validateSource(source);
  if (problems.length > 0 && compiled.ok) {
    return {
      ...compiled,
      ok: false,
      diagnostics: [
        {
          code: 'TYPE_SYSTEM_ERROR',
          message: diagnosticMessage('TYPE_SYSTEM_ERROR'),
          severity: 'error',
          from: 0,
          to: source.plaintext.length,
          line: 1,
          column: 1,
          ...(() => {
            const end = lineColumn(source.plaintext, source.plaintext.length);
            return { endLine: end.line, endColumn: end.column };
          })(),
        },
      ],
    };
  }
  return compiled;
}

/** Editor text → stored form (for saving what the editor holds). */
export function toStoredSource(text: string, tokens: Map<string, FormulaAnnotation>): FormulaSource {
  const { plaintext, annotations } = fromEditorSource({ text, tokens });
  return { plaintext, annotations };
}

/** Save-time validation (§3.6) of a compiled formula; chain checks (circularity, depth) are the server's. */
export function saveError(compiled: CompiledFormula): SaveErrorCode | null {
  if (compiled.empty) return 'FORMULA_EMPTY';
  if (compiled.diagnostics.length > 0) return 'FORMULA_HAS_ERRORS';
  if (!compiled.ok || !compiled.expr) return 'FORMULA_TYPECHECK_FAILED';
  return null;
}

export type EvaluationResult =
  | {
      type: 'complete';
      /** Raw result of the expression. */
      value: RV;
      /** Result converted to the output type (what is stored). */
      outputValue: RV;
      outputType: OutputKind;
      /** Text shown by the preview. */
      display: string | null;
    }
  | { type: 'syntax_error' }
  | { type: 'evaluation_error'; code: RuntimeErrorCode; message: string };

export function evaluateFormula(compiled: CompiledFormula, env: EvalEnv): EvaluationResult {
  if (!compiled.ok || !compiled.expr || !compiled.resultType) return { type: 'syntax_error' };
  try {
    const value = evaluateTyped(compiled.expr, compiled.references, env);
    const outputValue = toOutputValue(value, compiled.resultType, compiled.outputType);
    return {
      type: 'complete',
      value,
      outputValue,
      outputType: compiled.outputType,
      display: previewText(value, compiled.resultType),
    };
  } catch (err) {
    if (err instanceof FormulaRuntimeError) return { type: 'evaluation_error', code: err.code, message: err.message };
    if (err instanceof RangeError) return { type: 'evaluation_error', code: 'invalid-argument', message: err.message };
    throw err;
  }
}
