// External specializer of the formula grammar (formula.grammar `@external specialize {Identifier}`).
// Word operators and literals are case-insensitive (`AND`, `True`, `NULL`); `if` and `ifNull` are exact-case keywords
// (other casings stay identifiers and resolve case-insensitively as function names in the AST builder, §1.3).
import type { Stack } from '@lezer/lr';
import { ControlKeyword, IfNullFunctionIdentifier, kwAnd, kwFalse, kwNull, kwOr, kwTrue } from './parser.terms.gen.ts';

const WORDS: Record<string, number> = { true: kwTrue, false: kwFalse, null: kwNull, and: kwAnd, or: kwOr };

export function specializeIdentifier(value: string, _stack: Stack): number {
  if (value === 'if') return ControlKeyword;
  if (value === 'ifNull') return IfNullFunctionIdentifier;
  return WORDS[value.toLowerCase()] ?? -1;
}
