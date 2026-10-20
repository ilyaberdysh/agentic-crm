import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateParser } from '../scripts/build-grammar.ts';
import {
  compileFormula,
  type Diagnostic,
  fromEditorSource,
  parseFormula,
  saveError,
  summarizeDiagnostics,
  toEditorSource,
  typeLabel,
} from '../src/index.ts';
import { compile, D, schema, TOKENS } from './helpers.ts';

const codes = (text: string) => compile(text).diagnostics.map((d) => d.code);
const first = (text: string) => compile(text).diagnostics[0] as Diagnostic;

describe('grammar', () => {
  it('committed parser matches formula.grammar', () => {
    const { parser, terms } = generateParser();
    const src = join(import.meta.dirname, '..', 'src');
    expect(readFileSync(join(src, 'parser.gen.ts'), 'utf8')).toBe(parser);
    expect(readFileSync(join(src, 'parser.terms.gen.ts'), 'utf8')).toBe(terms);
  });

  it.each([
    [
      '1 + 2 * 3',
      'BinaryExpression(Number(Integer),Operator,BinaryExpression(Number(Integer),Operator,Number(Integer)))',
    ],
    ['a ?? b * c', 'BinaryExpression(BinaryExpression(Identifier,Operator,Identifier),Operator,Identifier)'],
    ['a ?? b ?? c', 'BinaryExpression(Identifier,Operator,BinaryExpression(Identifier,Operator,Identifier))'],
    ['a < b == c', 'BinaryExpression(BinaryExpression(Identifier,Operator,Identifier),Operator,Identifier)'],
    [
      'f(x)[0].y',
      'MemberExpression(MemberExpression(FunctionCall(Identifier,ArgList(LParen,Identifier,RParen)),ArrayIndex(LBracket,Number(Integer),RBracket)),Dot,Identifier)',
    ],
    ['if(TRUE, NULL, 1)', 'FunctionCall(ControlKeyword,ArgList(LParen,Bool,Comma,Null,Comma,Number(Integer),RParen))'],
    [
      'ifNull(1, 2)',
      'FunctionCall(IfNullFunctionIdentifier,ArgList(LParen,Number(Integer),Comma,Number(Integer),RParen))',
    ],
    ['_{ab-cd} // c', 'AttioReference,LineComment'],
    ['$1', 'LLMReference'],
  ])('%s', (text, tree) => {
    const s = parseFormula(text).tree.toString();
    expect(s.replace(/"[^"]*"/g, '').replace(/Operator\(\)/g, 'Operator')).toBe(`Formula(${tree})`);
  });

  it('empty and comment-only formulas are the empty expression', () => {
    expect(compile('').empty).toBe(true);
    expect(compile('  // nothing\n').empty).toBe(true);
    expect(compile('').diagnostics).toEqual([]);
    expect(saveError(compile(''))).toBe('FORMULA_EMPTY');
  });
});

describe('syntax diagnostics', () => {
  it.each([
    ['1 +', 'MISSING_EXPRESSION'],
    ['round(1, 2', 'MISSING_PARENTHESES'],
    ['(1 + 2', 'MISSING_PARENTHESES'],
    ['[1, 2', 'CLOSING_BRACKET_MISSING'],
    ['"abc', 'UNTERMINATED_STRING'],
    ['upper("abc', 'UNTERMINATED_STRING'],
    ['today', 'FUNCTION_ARGUMENTS_MISSING'],
    ['1 2', 'UNEXPECTED_TOKEN'],
    ['1e5', 'UNEXPECTED_TOKEN'],
    ["'single'", 'UNEXPECTED_TOKEN'],
    ['1_000', 'UNEXPECTED_TOKEN'],
    ['$1 + 2', 'UNEXPECTED_TOKEN'],
    ['/* c */ 1', 'UNEXPECTED_TOKEN'],
    ['[1, 2,]', 'UNEXPECTED_TOKEN'],
    ['"a _{d-name} b"', 'REFERENCE_IN_STRING_LITERAL'],
  ])('%s → %s', (text, code) => {
    expect(codes(text)[0]).toBe(code);
    expect(compile(text).ok).toBe(false);
  });

  it('fixes: close strings, parentheses, brackets; add argument lists', () => {
    expect(first('"abc').fix?.edits).toEqual([{ from: 4, to: 4, insert: '"' }]);
    expect(first('round(1, 2').fix?.edits).toEqual([{ from: 10, to: 10, insert: ')' }]);
    expect(first('[1, 2').fix?.edits).toEqual([{ from: 5, to: 5, insert: ']' }]);
    expect(first('today').fix?.edits).toEqual([{ from: 5, to: 5, insert: '()' }]);
  });

  it('positions are 1-based lines and columns', () => {
    const d = first('1 +\n  unknownFn(1)');
    expect(d.code).toBe('INVALID_FUNCTION_NAME');
    expect([d.line, d.column, d.endLine, d.endColumn]).toEqual([2, 3, 2, 12]);
  });

  it('accepts LLM references when asked (AI output)', () => {
    expect(parseFormula('round($1 / $2, 0)', { allowLlmReferences: true }).diagnostics).toEqual([]);
  });
});

describe('type errors', () => {
  it.each([
    ['unknownFn(1)', 'INVALID_FUNCTION_NAME'],
    ['add(1, 2)', 'INVALID_FUNCTION_NAME'],
    ['negate(1)', 'INVALID_FUNCTION_NAME'],
    ['round(1)', 'INVALID_ARGUMENT_COUNT'],
    ['now(1)', 'INVALID_ARGUMENT_COUNT'],
    ['upper(1, 2)', 'INVALID_ARGUMENT_COUNT'],
    ['"a" * 2', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['upper(_{d-company})', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['sum(1)', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['_{d-company} + 1', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['if(1, 2, 3)', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['true and 1', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['if(true, 1, _{d-company})', 'UNABLE_TO_COERCE_ARGUMENT_TYPES'],
    ['_{d-tags} == _{opt-vip}', 'UNABLE_TO_COERCE_ARGUMENT_TYPES'],
    ['[1, _{d-company}]', 'INCOMPATIBLE_ARRAY_ELEMENT_TYPES'],
    ['_{nope-token}', 'UNKNOWN_VARIABLE'],
    ['_{missing-attr}', 'UNKNOWN_VARIABLE'],
    ['_{bad-field}', 'INVALID_VARIABLE'],
    ['_{d-name}.first_name', 'UNSUPPORTED_FIELD_ACCESS'],
    ['_{c-hq}.planet', 'UNSUPPORTED_FIELD_ACCESS'],
    ['_{d-headcount}[0]', 'INDEXED_ACCESS_NOT_SUPPORTED'],
    ['_{d-tags}["a"]', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['split("a,b", ",")', 'UNSUPPORTED_OUTPUT_TYPE'],
    ['_{d-people}', 'UNSUPPORTED_OUTPUT_TYPE'],
    ['_{d-touch}', 'UNSUPPORTED_OUTPUT_TYPE'],
    ['phoneNumber("+442079460958")', 'UNSUPPORTED_OUTPUT_TYPE'],
    ['valueSetAt(_{d-stage}, _{stage-won}, "middle")', 'INVALID_ARGUMENT_VALUE'],
    ['timeSpentIn(_{d-stage}, _{stage-won}, "years")', 'INVALID_ARGUMENT_VALUE'],
    ['hasBeenIn(_{d-stage}, "Won")', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['hasBeenIn(_{d-name}, _{stage-won})', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['previousValue(_{d-touch})', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['previousValue(_{p-age})', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['valueAt(_{d-tags}[0], now())', 'INCOMPATIBLE_ARGUMENT_TYPES'],
    ['hasBeenIn(_{d-stage}, _{stage-won}, "any")', 'INVALID_ARGUMENT_COUNT'],
  ])('%s → %s', (text, code) => {
    expect(codes(text)).toContain(code);
  });

  it('messages carry the types', () => {
    expect(first('"a" * 2').message).toBe('Argument of type text is not compatible with expected type (number)');
    expect(first('unknownFn(1)').message).toBe('Invalid function name unknownFn');
    expect(first('round(1)').message).toBe('Invalid argument count on function round');
    expect(first('if(true, 1, _{d-company})').message).toBe('Unable to coerce argument types number, record');
    expect(first('split("a", ",")').message).toBe('A formula cannot output a value of type text[]');
    expect(first('valueSetAt(_{d-stage}, _{stage-won}, "middle")').message).toBe(
      'Invalid value for argument position, expected one of: "first", "last"',
    );
    expect(first('text(_{d-company}) + _{d-company}').message).toBe(
      'Argument of type record attribute is not compatible with expected type (number | text)',
    );
    expect(first('hasBeenIn(_{d-name}, _{stage-won})').message).toBe(
      'Argument of type text attribute is not compatible with expected type (select attribute | status attribute | person attribute | …)',
    );
  });

  it('collects every error and summarises them', () => {
    const c = compile('unknownFn(1) + upper(_{d-company}) + "a" * 2');
    expect(c.diagnostics.map((d) => d.code)).toEqual([
      'INVALID_FUNCTION_NAME',
      'INCOMPATIBLE_ARGUMENT_TYPES',
      'INCOMPATIBLE_ARGUMENT_TYPES',
    ]);
    expect(summarizeDiagnostics(c.diagnostics)).toBe('Multiple errors (3)');
    expect(summarizeDiagnostics(compile('upper(_{d-owner})').diagnostics)).toBe(
      'Argument of type person attribute is not compatible with expected type (text)',
    );
  });

  it('+ with a text operand is accepted (live observation)', () => {
    expect(codes('_{d-headcount} + "abc" + unknownFn(1)')).toEqual(['INVALID_FUNCTION_NAME']);
  });

  it('fix suggestions: closest name, operator form, allowed literal', () => {
    expect(first('uper("a")').fix).toEqual({
      label: 'Replace with upper()',
      edits: [{ from: 0, to: 4, insert: 'upper' }],
    });
    expect(first('add(1, 2)').fix).toEqual({
      label: 'Use the + operator',
      edits: [{ from: 0, to: 9, insert: '1 + 2' }],
    });
    expect(first('valueSetAt(_{d-stage}, _{stage-won}, "lst")').fix?.edits[0]?.insert).toBe('"last"');
  });

  it('function names are case-insensitive', () => {
    expect(compile('ROUND(1.26, 1)').ok).toBe(true);
    expect(compile('DateAdd(today(), 1, "days")').ok).toBe(true);
  });
});

describe('references and output types', () => {
  it.each([
    ['_{d-name}', 'text attribute', 'text'],
    ['_{d-value}', 'currency attribute', 'currency'],
    ['_{d-value} * 0.4', 'number', 'number'],
    ['_{d-stage}', 'status attribute', 'text'],
    ['_{d-tags}', 'select[] attribute', 'text'],
    ['_{d-owner}', 'person attribute', 'actor-reference'],
    ['_{d-company}', 'record attribute', 'entity-reference'],
    ['_{c-name}', 'text attribute', 'text'],
    ['_{c-domains}', 'domain[] attribute', undefined],
    ['_{c-hq}', 'location attribute', 'location'],
    ['_{p-age}', 'number[]', undefined],
    ['_{p-first}', 'text[]', undefined],
    ['_{p-first}[0]', 'text', 'text'],
    ['_{c-hq}.locality', 'text', 'text'],
    ['today()', 'date', 'date'],
    ['now()', 'timestamp', 'timestamp'],
    ['null', 'null', null],
    ['[]', 'null[]', null],
    ['rating(3)', 'rating', 'rating'],
    ['5 > 3', 'checkbox', 'checkbox'],
  ])('%s : %s → output %s', (text, type, output) => {
    const c = compile(text);
    expect(c.resultType && typeLabel(c.resultType)).toBe(type);
    if (output === undefined) expect(c.diagnostics.map((d) => d.code)).toEqual(['UNSUPPORTED_OUTPUT_TYPE']);
    else expect(c.inferredOutputType).toBe(output);
  });

  it('fan-out paths are plain arrays; singular paths are attribute references', () => {
    const c = compile('count(_{p-age}) + _{c-employees}');
    expect(c.references.map((r) => [r.tokenId, r.singular, r.fanout])).toEqual([
      ['p-age', false, true],
      ['c-employees', true, false],
    ]);
  });

  it('history functions mark their reference', () => {
    const c = compile('hasBeenIn(_{d-stage}, [_{stage-won}, _{stage-lost}])');
    expect(c.ok).toBe(true);
    expect(c.references[0]?.needsHistory).toBe(true);
    expect(compile('valueAt(_{d-tags}, now())').ok).toBe(true);
    expect(compile('hasBeenIn(_{d-owner}, _{m-ann})').ok).toBe(true);
  });

  it('output override converts or rejects', () => {
    expect(compile('_{d-headcount} * 2', 'currency').outputType).toBe('currency');
    expect(compile('"+44 20 7946 0958"', 'phone-number').ok).toBe(true);
    expect(compile('_{d-company}', 'number').diagnostics.map((d) => d.code)).toEqual(['UNSUPPORTED_OUTPUT_TYPE']);
    expect(compile('split("a", ",")', 'text').ok).toBe(true);
    expect(compile('null', 'number').outputType).toBe('number');
    expect(compile('null').outputType).toBe('text');
  });

  it('uses now() / today() is reported', () => {
    expect(compile('today()').usesNow).toBe(true);
    expect(compile('1').usesNow).toBe(false);
  });
});

describe('stored representation', () => {
  it('round-trips plaintext + annotations with offsets in plaintext coordinates', () => {
    const tokens = new Map([
      ['x-1', TOKENS.get('d-value')!],
      ['x-2', TOKENS.get('d-headcount')!],
    ]);
    const stored = fromEditorSource({ text: 'round(_{x-1} / _{x-2}, 0)', tokens });
    expect(stored.plaintext).toBe('round(_ / _, 0)');
    expect(stored.annotations.map((a) => a.startPosition)).toEqual([6, 10]);
    const editor = toEditorSource(stored);
    expect(editor.text).toBe('round(_{ref-0} / _{ref-1}, 0)');
    const compiled = compileFormula(stored, { entityDefinitionId: D, schema });
    expect(compiled.ok).toBe(true);
    expect(compiled.inferredOutputType).toBe('number');
    const bad = compileFormula(
      { plaintext: 'upper(_)', annotations: [{ ...TOKENS.get('d-company')!, startPosition: 6 }] },
      { entityDefinitionId: D, schema },
    );
    expect(bad.diagnostics[0]).toMatchObject({ code: 'INCOMPATIBLE_ARGUMENT_TYPES', from: 6, to: 7, column: 7 });
  });

  it('a path that does not start on the formula definition is invalid', () => {
    const c = compileFormula(
      {
        plaintext: '_',
        annotations: [
          {
            ...TOKENS.get('d-name')!,
            startPosition: 0,
            path: [{ entityDefinitionId: 'other', attributeDefinitionId: 'a-name' }],
          } as never,
        ],
      },
      { entityDefinitionId: D, schema },
    );
    expect(c.diagnostics[0]?.code).toBe('INVALID_VARIABLE');
  });
});
