// @agentic-crm/formula — the formula language (I-ai-calls/formulas.md): Lezer grammar, AST, type checker, the 72
// functions, evaluator, diagnostics with fixes, output types. Pure TypeScript: used by the server (validation,
// preview, recompute) and by the web editor (parser for CodeMirror, client-side checks, helper panel content).

export { type Expr, type ParseOptions, type ParseResult, parseFormula, type RawDiagnostic, type Span } from './ast.ts';
export {
  checkExpression,
  type FormulaSchema,
  type ReferenceInfo,
  type SchemaAttribute,
  type TExpr,
} from './checker.ts';
export { displayText, identityKey, numberText } from './coerce.ts';
export {
  type CompiledFormula,
  type CompileOptions,
  compileEditorText,
  compileFormula,
  type EvaluationResult,
  evaluateFormula,
  saveError,
  toStoredSource,
} from './compile.ts';
export { addUnits, diffUnits, formatDate, parseDateText, parseTimestampText } from './dates.ts';
export {
  DIAGNOSTIC_CODES,
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticFix,
  diagnosticMessage,
  FormulaRuntimeError,
  RUNTIME_ERROR_CODES,
  type RuntimeErrorCode,
  SAVE_ERROR_CODES,
  SAVE_ERROR_MESSAGES,
  type SaveErrorCode,
  summarizeDiagnostics,
  type TextEdit,
} from './diagnostics.ts';
export { applyField, type EvalEnv, evaluateTyped } from './evaluator.ts';
export { FIELDS, fieldKind, IDENTITY_FIELDS, MEMBER_ACCESS_KINDS } from './fields.ts';
export {
  AUTOCOMPLETE_FUNCTIONS,
  BINARY_OPERATORS,
  FUNCTION_NAMES,
  FUNCTIONS,
  type FunctionCategory,
  type FunctionDecl,
  type FunctionHelp,
  type FunctionName,
  HELP_FUNCTIONS,
  lookupFunction,
  type ParamDecl,
  UNARY_OPERATORS,
} from './functions.ts';
export { ATTRIBUTE_EXAMPLES, ATTRIBUTE_PLACEHOLDER, type AttributeExamples } from './help.ts';
export {
  checkOutput,
  inferOutputKind,
  OUTPUT_KINDS,
  OUTPUT_OVERRIDES,
  type OutputKind,
  type OutputOverride,
  previewText,
  toOutputValue,
} from './output.ts';
export { parser } from './parser.gen.ts';
export {
  type EditorSource,
  type FormulaAnnotation,
  type FormulaSource,
  fromEditorSource,
  lineColumn,
  type OffsetMap,
  type PathHop,
  REFERENCE_TOKEN_RE,
  toEditorSource,
  tokenIdFor,
  validateSource,
} from './source.ts';
export {
  arr,
  attrOf,
  COERCIONS,
  coercible,
  type FType,
  KINDS,
  type Kind,
  kindLabel,
  NULL,
  typeLabel,
  unwrapAttr,
  v,
} from './types.ts';
export type {
  ActorValue,
  EmailValue,
  HistoryEntry,
  InteractionValue,
  LocationValue,
  NameValue,
  OptionValue,
  PhoneValue,
  RecordValue,
  RV,
} from './values.ts';
