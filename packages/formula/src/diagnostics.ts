// Editor diagnostic codes (formulas.md §3.5), save-time codes (§3.6) and runtime error codes (§3.7). Messages are the
// UI copy quoted by the spec. Diagnostics carry an optional deterministic Fix (text edits) where the repair is
// unambiguous; anything else is left to the AI "Fix" (formulas.fix).

export const DIAGNOSTIC_CODES = [
  'MISSING_EXPRESSION',
  'MISSING_PARENTHESES',
  'MISSING_TOKEN',
  'UNEXPECTED_TOKEN',
  'UNTERMINATED_STRING',
  'FUNCTION_ARGUMENTS_MISSING',
  'CLOSING_BRACKET_MISSING',
  'INVALID_NODE_SHAPE',
  'REFERENCE_IN_STRING_LITERAL',
  'INVALID_ARGUMENT_COUNT',
  'INCOMPATIBLE_ARGUMENT_TYPES',
  'UNABLE_TO_COERCE_ARGUMENT_TYPES',
  'INVALID_FUNCTION_NAME',
  'INCOMPATIBLE_ARRAY_ELEMENT_TYPES',
  'TYPE_SYSTEM_ERROR',
  'UNKNOWN_VARIABLE',
  'INVALID_VARIABLE',
  'UNSUPPORTED_FIELD_ACCESS',
  'INDEXED_ACCESS_NOT_SUPPORTED',
  'UNSUPPORTED_OUTPUT_TYPE',
  'INVALID_ARGUMENT_VALUE',
] as const;
export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export const SAVE_ERROR_CODES = [
  'FORMULA_EMPTY',
  'FORMULA_HAS_ERRORS',
  'FORMULA_CIRCULAR_REFERENCE',
  'FORMULA_MAX_DEPTH_EXCEEDED',
  'FORMULA_TYPECHECK_FAILED',
] as const;
export type SaveErrorCode = (typeof SAVE_ERROR_CODES)[number];

export const SAVE_ERROR_MESSAGES: Record<SaveErrorCode, string> = {
  FORMULA_EMPTY: 'The formula cannot be empty.',
  FORMULA_HAS_ERRORS: 'The formula contains errors.',
  FORMULA_CIRCULAR_REFERENCE: 'The formula creates a circular dependency.',
  FORMULA_MAX_DEPTH_EXCEEDED:
    'A formula chain can contain at most three formulas. This formula, or another formula that depends on it, would exceed that.',
  FORMULA_TYPECHECK_FAILED: 'The formula could not be validated.',
};

export const RUNTIME_ERROR_CODES = [
  'division-by-zero',
  'array-index-out-of-bounds',
  'invalid-array-index',
  'invalid-argument',
  'math-domain-error',
  'referenced-attribute-missing-or-archived',
  'formula-feature-not-enabled',
] as const;
export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

export interface DiagnosticFix {
  label: string;
  edits: TextEdit[];
}

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  severity: 'error';
  /** Offsets in the coordinate system of the checked text (editor text, or plaintext for stored formulas). */
  from: number;
  to: number;
  /** 1-based positions. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: DiagnosticFix;
}

type Params = Record<string, string | number>;

const TEMPLATES: Record<DiagnosticCode, string> = {
  MISSING_EXPRESSION: 'Missing expression',
  MISSING_PARENTHESES: 'Missing parentheses',
  MISSING_TOKEN: 'Missing token',
  UNEXPECTED_TOKEN: 'Unexpected token',
  UNTERMINATED_STRING: 'Unterminated string',
  FUNCTION_ARGUMENTS_MISSING: 'Function arguments missing',
  CLOSING_BRACKET_MISSING: 'Closing bracket missing',
  INVALID_NODE_SHAPE: 'Invalid node shape',
  REFERENCE_IN_STRING_LITERAL: "Variables can't be used inside a quoted string",
  INVALID_ARGUMENT_COUNT: 'Invalid argument count on function {functionName}',
  INCOMPATIBLE_ARGUMENT_TYPES: 'Argument of type {receivedType} is not compatible with expected type ({expectedTypes})',
  UNABLE_TO_COERCE_ARGUMENT_TYPES: 'Unable to coerce argument types {candidateTypes}',
  INVALID_FUNCTION_NAME: 'Invalid function name {functionName}',
  INCOMPATIBLE_ARRAY_ELEMENT_TYPES: 'Incompatible array element types {elementTypes}',
  TYPE_SYSTEM_ERROR: 'Type system error',
  UNKNOWN_VARIABLE: 'Unknown variable',
  INVALID_VARIABLE: 'Invalid variable',
  UNSUPPORTED_FIELD_ACCESS: 'Unsupported field access',
  INDEXED_ACCESS_NOT_SUPPORTED: 'Indexed access not supported',
  UNSUPPORTED_OUTPUT_TYPE: 'A formula cannot output a value of type {receivedType}',
  INVALID_ARGUMENT_VALUE: 'Invalid value for argument {parameterName}, expected one of: {allowedValues}',
};

export function diagnosticMessage(code: DiagnosticCode, params: Params = {}): string {
  return TEMPLATES[code].replace(/\{(\w+)\}/g, (_m, key: string) => String(params[key] ?? ''));
}

/** "Multiple errors (n)" summary of the helper header, or the single message. */
export function summarizeDiagnostics(diagnostics: Diagnostic[]): string | null {
  if (diagnostics.length === 0) return null;
  if (diagnostics.length === 1) return (diagnostics[0] as Diagnostic).message;
  return `Multiple errors (${diagnostics.length})`;
}

export class FormulaRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  constructor(code: RuntimeErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

/** Levenshtein distance (for "did you mean" fixes). */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1]?.toLowerCase() === b[j - 1]?.toLowerCase() ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}
