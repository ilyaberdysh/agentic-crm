// Lezer syntax tree → AST (formulas.md §1). Operators are rewritten to their catalog functions (`a + b` → add(a, b)),
// parentheses disappear, function names keep their written form (resolved case-insensitively by the checker).
// Syntax errors become diagnostics with codes (§3.5); the AST is only built when the text parses cleanly.
import type { SyntaxNode, Tree } from '@lezer/common';
import { type DiagnosticCode, type DiagnosticFix, diagnosticMessage } from './diagnostics.ts';
import { BINARY_OPERATORS, UNARY_OPERATORS } from './functions.ts';
import { parser } from './parser.gen.ts';
import { REFERENCE_TOKEN_RE } from './source.ts';

export interface Span {
  from: number;
  to: number;
}

export type Expr =
  | (Span & { type: 'number'; value: number })
  | (Span & { type: 'string'; value: string })
  | (Span & { type: 'bool'; value: boolean })
  | (Span & { type: 'null' })
  | (Span & { type: 'reference'; tokenId: string })
  | (Span & {
      type: 'call';
      /** Written name (or the function an operator maps to). */
      name: string;
      nameSpan: Span;
      args: Expr[];
      /** Operator syntax when written as an operator. */
      operator: string | null;
    })
  | (Span & { type: 'member'; object: Expr; key: string; keySpan: Span })
  | (Span & { type: 'index'; object: Expr; index: Expr })
  | (Span & { type: 'array'; elements: Expr[] });

export interface RawDiagnostic {
  code: DiagnosticCode;
  message: string;
  from: number;
  to: number;
  fix?: DiagnosticFix;
}

export interface ParseResult {
  /** null for an empty formula (only whitespace / comments): the EmptyExpression. */
  expr: Expr | null;
  diagnostics: RawDiagnostic[];
  tree: Tree;
}

export interface ParseOptions {
  /** Accept `$n` placeholders (AI generation output); otherwise they are UNEXPECTED_TOKEN. */
  allowLlmReferences?: boolean;
}

const diag = (code: DiagnosticCode, span: Span, params?: Record<string, string>, fix?: DiagnosticFix) => ({
  code,
  message: diagnosticMessage(code, params),
  from: span.from,
  to: Math.max(span.to, span.from),
  ...(fix ? { fix } : {}),
});

function hasChild(node: SyntaxNode, name: string): boolean {
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) return true;
  return false;
}

/** Classifies one error node of the Lezer tree. */
function syntaxDiagnostic(text: string, err: SyntaxNode): RawDiagnostic {
  const parent = err.parent;
  const at = { from: err.from, to: err.to };
  if (text[err.from] === '"') {
    const eol = text.indexOf('\n', err.from);
    const end = eol < 0 ? text.length : eol;
    return diag('UNTERMINATED_STRING', { from: err.from, to: end }, undefined, {
      label: 'Close the string',
      edits: [{ from: end, to: end, insert: '"' }],
    });
  }
  if (parent) {
    const lastChild = parent.lastChild;
    const atEnd = lastChild !== null && lastChild.from === err.from && lastChild.to === err.to;
    if ((parent.name === 'ArgList' || parent.name === 'Parenthesized') && !hasChild(parent, 'RParen')) {
      const open = parent.firstChild;
      return diag(
        'MISSING_PARENTHESES',
        { from: open?.from ?? parent.from, to: parent.to },
        undefined,
        atEnd && err.from === err.to
          ? { label: 'Add the closing parenthesis', edits: [{ from: err.from, to: err.from, insert: ')' }] }
          : undefined,
      );
    }
    if ((parent.name === 'ArrayExpression' || parent.name === 'ArrayIndex') && !hasChild(parent, 'RBracket')) {
      const open = parent.firstChild;
      return diag(
        'CLOSING_BRACKET_MISSING',
        { from: open?.from ?? parent.from, to: parent.to },
        undefined,
        atEnd && err.from === err.to
          ? { label: 'Add the closing bracket', edits: [{ from: err.from, to: err.from, insert: ']' }] }
          : undefined,
      );
    }
    if ((parent.name === 'BinaryExpression' || parent.name === 'UnaryExpression') && atEnd && err.from === err.to) {
      const op = parent.getChild('Operator');
      return diag('MISSING_EXPRESSION', op ? { from: op.from, to: op.to } : at);
    }
  }
  return diag(
    'UNEXPECTED_TOKEN',
    err.from === err.to ? { from: err.from, to: Math.min(err.from + 1, text.length) } : at,
  );
}

function unescape(raw: string): string {
  // raw includes the quotes; a backslash escapes the next character, which is kept literally (§1.3).
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const ch = raw[i] as string;
    if (ch === '\\' && i + 1 < raw.length - 1) {
      out += raw[i + 1];
      i++;
    } else out += ch;
  }
  return out;
}

class Builder {
  readonly diagnostics: RawDiagnostic[] = [];
  constructor(
    private readonly text: string,
    private readonly options: ParseOptions,
  ) {}

  private slice(n: Span): string {
    return this.text.slice(n.from, n.to);
  }

  private children(n: SyntaxNode): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.name === 'LineComment') continue;
      out.push(c);
    }
    return out;
  }

  /** Expression children of a node (skips punctuation). */
  private exprChildren(n: SyntaxNode): SyntaxNode[] {
    return this.children(n).filter((c) => c.type.is('Expression'));
  }

  build(n: SyntaxNode): Expr | null {
    const span = { from: n.from, to: n.to };
    switch (n.name) {
      case 'Number':
        return { ...span, type: 'number', value: Number(this.slice(n)) };
      case 'String': {
        const raw = this.slice(n);
        REFERENCE_TOKEN_RE.lastIndex = 0;
        if (REFERENCE_TOKEN_RE.test(raw)) {
          this.diagnostics.push(diag('REFERENCE_IN_STRING_LITERAL', span));
        }
        return { ...span, type: 'string', value: unescape(raw) };
      }
      case 'Bool':
        return { ...span, type: 'bool', value: this.slice(n).toLowerCase() === 'true' };
      case 'Null':
        return { ...span, type: 'null' };
      case 'RecordReference': {
        const raw = this.slice(n);
        return { ...span, type: 'reference', tokenId: raw.slice(2, -1) };
      }
      case 'LLMReference': {
        if (this.options.allowLlmReferences) return { ...span, type: 'reference', tokenId: this.slice(n) };
        this.diagnostics.push(diag('UNEXPECTED_TOKEN', span));
        return null;
      }
      case 'Identifier': {
        this.diagnostics.push(
          diag('FUNCTION_ARGUMENTS_MISSING', span, undefined, {
            label: 'Add the argument list',
            edits: [{ from: n.to, to: n.to, insert: '()' }],
          }),
        );
        return null;
      }
      case 'Parenthesized': {
        const [inner] = this.exprChildren(n);
        if (!inner) return null;
        const e = this.build(inner);
        return e ? { ...e, from: n.from, to: n.to } : null;
      }
      case 'ArrayExpression': {
        const elements = this.exprChildren(n).map((c) => this.build(c));
        if (elements.some((e) => e === null)) return null;
        return { ...span, type: 'array', elements: elements as Expr[] };
      }
      case 'UnaryExpression': {
        const op = n.getChild('Operator');
        const [operand] = this.exprChildren(n);
        if (!op || !operand) return null;
        const symbol = this.slice(op);
        const arg = this.build(operand);
        if (!arg) return null;
        return {
          ...span,
          type: 'call',
          name: UNARY_OPERATORS[symbol] as string,
          nameSpan: { from: op.from, to: op.to },
          args: [arg],
          operator: symbol,
        };
      }
      case 'BinaryExpression': {
        const op = n.getChild('Operator');
        const [left, right] = this.exprChildren(n);
        if (!op || !left || !right) return null;
        const symbol = this.slice(op).toLowerCase();
        const l = this.build(left);
        const r = this.build(right);
        if (!l || !r) return null;
        return {
          ...span,
          type: 'call',
          name: BINARY_OPERATORS[symbol] as string,
          nameSpan: { from: op.from, to: op.to },
          args: [l, r],
          operator: symbol,
        };
      }
      case 'MemberExpression': {
        const [objectNode] = this.exprChildren(n);
        if (!objectNode) return null;
        const object = this.build(objectNode);
        const index = n.getChild('ArrayIndex');
        if (index) {
          const [indexExpr] = this.exprChildren(index);
          const i = indexExpr ? this.build(indexExpr) : null;
          if (!object || !i) return null;
          return { ...span, type: 'index', object, index: i };
        }
        const key = n.getChildren('Identifier').at(-1);
        if (!object || !key || key.from < objectNode.to) return null;
        return { ...span, type: 'member', object, key: this.slice(key), keySpan: { from: key.from, to: key.to } };
      }
      case 'FunctionCall': {
        const argList = n.getChild('ArgList');
        if (!argList) return null;
        // The callee is a named token, or the anonymous word operator token of `and(…)` / `or(…)`.
        const first = n.firstChild;
        const nameNode = first && first.name !== 'ArgList' ? first : { from: n.from, to: argList.from };
        const args = this.exprChildren(argList).map((c) => this.build(c));
        if (args.some((a) => a === null)) return null;
        return {
          ...span,
          type: 'call',
          name: this.slice(nameNode),
          nameSpan: { from: nameNode.from, to: nameNode.to },
          args: args as Expr[],
          operator: null,
        };
      }
      default:
        this.diagnostics.push(diag('TYPE_SYSTEM_ERROR', span));
        return null;
    }
  }
}

/** Parses editor text into an AST with syntax diagnostics. */
export function parseFormula(text: string, options: ParseOptions = {}): ParseResult {
  const tree = parser.parse(text);
  const errors: RawDiagnostic[] = [];
  const seen = new Set<string>();
  tree.iterate({
    enter(ref) {
      if (!ref.type.isError) return;
      const d = syntaxDiagnostic(text, ref.node);
      const key = `${d.code}:${d.from}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(d);
      }
      // An unterminated string swallows the rest of the line: do not report what follows it.
      if (d.code === 'UNTERMINATED_STRING') return false;
      return undefined;
    },
  });
  if (errors.length > 0) {
    // One unterminated string explains every later error on its line.
    const unterminated = errors.find((e) => e.code === 'UNTERMINATED_STRING');
    const kept = unterminated ? [unterminated] : errors;
    return { expr: null, diagnostics: kept, tree };
  }
  const top = tree.topNode;
  const builder = new Builder(text, options);
  const exprs: SyntaxNode[] = [];
  for (let c = top.firstChild; c; c = c.nextSibling) if (c.type.is('Expression')) exprs.push(c);
  if (exprs.length === 0) return { expr: null, diagnostics: [], tree };
  if (exprs.length > 1) {
    const second = exprs[1] as SyntaxNode;
    return { expr: null, diagnostics: [diag('UNEXPECTED_TOKEN', { from: second.from, to: second.to })], tree };
  }
  const expr = builder.build(exprs[0] as SyntaxNode);
  return { expr: builder.diagnostics.length > 0 ? null : expr, diagnostics: builder.diagnostics, tree };
}
