// CodeMirror language for formulas: the @agentic-crm/formula Lezer parser with highlighting tags (formulas.md §4.4):
// function names blue, numbers green, strings and true / false / null cyan, operators / brackets / separators and
// comments tertiary, references purple, `if` orange. Auto-close for ( [ " and `//` line comments.
import { parser } from '@agentic-crm/formula';
import { vars } from '@agentic-crm/ui';
import { HighlightStyle, LanguageSupport, LRLanguage, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { styleTags, tags as t } from '@lezer/highlight';

export const formulaLanguage = LRLanguage.define({
  name: 'formula',
  parser: parser.configure({
    props: [
      styleTags({
        Number: t.number,
        String: t.string,
        Bool: t.bool,
        Null: t.null,
        'FunctionCall/Identifier': t.function(t.variableName),
        'FunctionCall/IfNullFunctionIdentifier': t.function(t.variableName),
        IfNullFunctionIdentifier: t.function(t.variableName),
        ControlKeyword: t.controlKeyword,
        'MemberExpression/Identifier': t.propertyName,
        Operator: t.operator,
        'LParen RParen': t.paren,
        'LBracket RBracket': t.squareBracket,
        Comma: t.separator,
        Dot: t.derefOperator,
        LineComment: t.lineComment,
        'AttioReference LLMReference': t.special(t.variableName),
      }),
    ],
  }),
  languageData: {
    closeBrackets: { brackets: ['(', '[', '"'] },
    commentTokens: { line: '//' },
  },
});

const c = vars.color;

export const formulaHighlightStyle = HighlightStyle.define([
  { tag: t.function(t.variableName), color: c.utilities.content.blue },
  { tag: t.number, color: c.utilities.content.green },
  { tag: [t.string, t.bool, t.null], color: c.utilities.content.cyan },
  {
    tag: [t.operator, t.paren, t.squareBracket, t.separator, t.derefOperator, t.lineComment],
    color: c.content.tertiary,
  },
  { tag: t.special(t.variableName), color: c.utilities.content.purple },
  { tag: t.controlKeyword, color: c.utilities.content.orange },
]);

export function formulaSupport(): LanguageSupport {
  return new LanguageSupport(formulaLanguage, [syntaxHighlighting(formulaHighlightStyle)]);
}

/** Whether `pos` sits inside a string literal or a comment (no pickers there, §4.4). */
export function inStringOrComment(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1);
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (n.name === 'String') return pos > n.from && pos < n.to;
    if (n.name === 'LineComment') return pos > n.from && pos <= n.to;
  }
  return false;
}
