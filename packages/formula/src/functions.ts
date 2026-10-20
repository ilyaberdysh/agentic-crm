// Function catalog (formulas.md §2.3): 72 declarations — 11 operator-only (+ - * / == != > >= < <= and unary -)
// and 61 callable by name. Each declaration has generic variables with candidate type lists, parameters bound to a
// generic (optionally with allowed literal values) and a return type (fixed, or a generic unwrapped to its element /
// value type). Help entries (helper panel) exist for 55 functions; operator-only and the 6 conversion functions have
// none (they are still offered by autocomplete). Descriptions and examples are our own wording; every example is
// evaluated by the test suite.
import { arr, attrOf, type FType, KINDS, type Kind, v } from './types.ts';

export const FUNCTION_NAMES = [
  'add',
  'subtract',
  'multiply',
  'divide',
  'equals',
  'notEquals',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'avg',
  'exp',
  'log',
  'abs',
  'round',
  'ceil',
  'floor',
  'max',
  'mean',
  'median',
  'min',
  'sum',
  'count',
  'unique',
  'dateAdd',
  'dateDiff',
  'formatDate',
  'date',
  'timestamp',
  'power',
  'mod',
  'random',
  'now',
  'today',
  'if',
  'and',
  'or',
  'not',
  'negate',
  'ifNull',
  'day',
  'month',
  'year',
  'quarter',
  'hour',
  'minute',
  'second',
  'eomonth',
  'setTimezone',
  'contains',
  'length',
  'replace',
  'replaceAll',
  'startsWith',
  'endsWith',
  'left',
  'right',
  'lower',
  'upper',
  'split',
  'splitPart',
  'valueAt',
  'hasBeenIn',
  'valueSetAt',
  'timeSpentIn',
  'text',
  'number',
  'currency',
  'checkbox',
  'rating',
  'phoneNumber',
  'previousValue',
] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];

export type FunctionCategory = 'operator' | 'logic' | 'math' | 'date' | 'text' | 'conversion' | 'history';

export interface ParamDecl {
  /** Declaration name (e.g. `num_digits`). */
  name: string;
  generic: string;
  optional?: boolean;
  /** Literal arguments must be one of these (non-literal expressions are not checked statically). */
  allowedLiterals?: readonly string[];
}

export type ReturnDecl = { type: FType } | { generic: string; unwrap?: 'element' | 'value' };

export interface FunctionHelp {
  kind: 'function' | 'operator';
  /** Parameter labels shown in the signature `name(a, b)`. */
  parameters: string[];
  description: string;
  searchTerms: string[];
  examples: { code: string; output: string }[];
}

export interface FunctionDecl {
  name: FunctionName;
  category: FunctionCategory;
  /** Operator syntax mapping to this function (binary unless `negate`/`not`). */
  operator: string | null;
  /** Operator-only functions cannot be called by name (INVALID_FUNCTION_NAME). */
  operatorOnly: boolean;
  generics: Record<string, FType[]>;
  params: ParamDecl[];
  returns: ReturnDecl;
  help: FunctionHelp | null;
}

const ANY_SCALAR: FType[] = KINDS.map((k) => v(k));
const ANY_ARRAY: FType[] = KINDS.map((k) => arr(k));
const ANY: FType[] = [...ANY_SCALAR, ...ANY_ARRAY];
const ANY_ATTR: FType[] = [...KINDS.map((k) => attrOf(k)), ...KINDS.map((k) => attrOf(arr(k)))];
// Candidate order as the declaration: select / status / actor, then their arrays.
const HISTORY_ATTR_ORDERED: FType[] = (['select', 'pipeline', 'actor-reference'] as Kind[])
  .map((k) => attrOf(k))
  .concat((['select', 'pipeline', 'actor-reference'] as Kind[]).map((k) => attrOf(arr(k))));
const NUM = [v('number')];
const TEXT = [v('text')];
const CHECKBOX = [v('checkbox')];
const NUM_CUR = [v('number'), v('currency')];
const DATE_LIKE = [v('date'), v('timestamp'), v('number'), v('text')];

const ret = (type: FType): ReturnDecl => ({ type });
const gen = (generic: string, unwrap?: 'element' | 'value'): ReturnDecl => (unwrap ? { generic, unwrap } : { generic });
const p = (name: string, generic: string, extra: Partial<ParamDecl> = {}): ParamDecl => ({ name, generic, ...extra });
const help = (
  kind: FunctionHelp['kind'],
  parameters: string[],
  description: string,
  searchTerms: string[],
  examples: [string, string][],
): FunctionHelp => ({
  kind,
  parameters,
  description,
  searchTerms,
  examples: examples.map(([code, output]) => ({ code, output })),
});

type DeclInput = Omit<FunctionDecl, 'name' | 'operatorOnly' | 'operator'> & {
  operator?: string;
  operatorOnly?: boolean;
};

const binaryOp = (operator: string, candidates: FType[], returns: ReturnDecl): DeclInput => ({
  category: 'operator',
  operator,
  operatorOnly: true,
  generics: { T: candidates },
  params: [p('left', 'T'), p('right', 'T')],
  returns,
  help: null,
});

const datePart = (what: string, searchTerms: string[], example: [string, string]): DeclInput => ({
  category: 'date',
  generics: { T: DATE_LIKE },
  params: [p('date', 'T')],
  returns: ret(v('number')),
  help: help('function', ['date'], `Returns the ${what} of a date or timestamp.`, searchTerms, [example]),
});

const DECLS: Record<FunctionName, DeclInput> = {
  add: binaryOp('+', [v('number'), v('text')], gen('T')),
  subtract: binaryOp('-', NUM, gen('T')),
  multiply: binaryOp('*', NUM, gen('T')),
  divide: binaryOp('/', NUM, gen('T')),
  equals: binaryOp(
    '==',
    [
      v('text'),
      v('select'),
      v('pipeline'),
      v('actor-reference'),
      arr('text'),
      arr('select'),
      arr('pipeline'),
      arr('actor-reference'),
    ],
    ret(v('checkbox')),
  ),
  notEquals: binaryOp('!=', ANY, ret(v('checkbox'))),
  greaterThan: binaryOp('>', NUM, ret(v('checkbox'))),
  greaterThanOrEqual: binaryOp('>=', NUM, ret(v('checkbox'))),
  lessThan: binaryOp('<', NUM, ret(v('checkbox'))),
  lessThanOrEqual: binaryOp('<=', NUM, ret(v('checkbox'))),
  negate: {
    category: 'operator',
    operator: '-',
    operatorOnly: true,
    generics: { T: NUM },
    params: [p('operand', 'T')],
    returns: gen('T'),
    help: null,
  },

  avg: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Returns the average of a list of numbers.',
      ['average', 'mean'],
      [['avg([2, 4, 9])', '5']],
    ),
  },
  exp: {
    category: 'math',
    generics: { T: NUM_CUR },
    params: [p('value', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['value'],
      'Returns e raised to the given power.',
      ['power', 'exponent', 'exponentiation'],
      [['round(exp(1), 4)', '2.7183']],
    ),
  },
  log: {
    category: 'math',
    generics: { T: NUM_CUR },
    params: [p('value', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['value'],
      'Returns the natural logarithm of a positive number.',
      ['logarithm', 'ln'],
      [['round(log(10), 3)', '2.303']],
    ),
  },
  abs: {
    category: 'math',
    generics: { T: NUM_CUR },
    params: [p('value', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['value'],
      'Returns the absolute value of a number.',
      ['absolute', 'magnitude'],
      [['abs(-42)', '42']],
    ),
  },
  round: {
    category: 'math',
    generics: { T: NUM_CUR, U: NUM },
    params: [p('value', 'T'), p('num_digits', 'U')],
    returns: gen('T'),
    help: help(
      'function',
      ['value', 'num_digits'],
      'Rounds a number to the given number of decimal places.',
      ['decimal', 'precision', 'rounding'],
      [['round(3.14159, 2)', '3.14']],
    ),
  },
  ceil: {
    category: 'math',
    generics: { T: NUM_CUR },
    params: [p('value', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['value'],
      'Rounds a number up to the nearest integer.',
      ['ceiling', 'round up'],
      [['ceil(4.2)', '5']],
    ),
  },
  floor: {
    category: 'math',
    generics: { T: NUM_CUR },
    params: [p('value', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['value'],
      'Rounds a number down to the nearest integer.',
      ['round down'],
      [['floor(4.8)', '4']],
    ),
  },
  max: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency'), arr('date'), arr('timestamp')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Returns the largest value of a list of numbers or dates.',
      ['maximum', 'largest', 'greatest', 'highest'],
      [
        ['max([3, 11, 7])', '11'],
        ['max([date("2024-01-15"), date("2024-03-01")])', '2024-03-01'],
      ],
    ),
  },
  mean: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency'), arr('date'), arr('timestamp')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Returns the arithmetic mean of a list of numbers or dates.',
      ['average', 'avg', 'arithmetic'],
      [
        ['mean([1, 2, 3, 6])', '3'],
        ['mean([date("2024-01-01"), date("2024-01-03")])', '2024-01-02'],
      ],
    ),
  },
  median: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency'), arr('date'), arr('timestamp')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Returns the middle value of a list of numbers or dates.',
      ['middle', 'midpoint', 'percentile'],
      [
        ['median([5, 1, 9])', '5'],
        ['median([1, 2, 3, 4])', '2.5'],
      ],
    ),
  },
  min: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency'), arr('date'), arr('timestamp')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Returns the smallest value of a list of numbers or dates.',
      ['minimum', 'smallest', 'lowest'],
      [
        ['min([3, 11, 7])', '3'],
        ['min([date("2024-01-15"), date("2024-03-01")])', '2024-01-15'],
      ],
    ),
  },
  sum: {
    category: 'math',
    generics: { T: [arr('number'), arr('currency')] },
    params: [p('values', 'T')],
    returns: gen('T', 'element'),
    help: help(
      'function',
      ['values'],
      'Adds up a list of numbers.',
      ['total', 'add', 'aggregate'],
      [['sum([10, 20, 12.5])', '42.5']],
    ),
  },
  count: {
    category: 'math',
    generics: { T: ANY_ARRAY },
    params: [p('values', 'T')],
    returns: ret(v('number')),
    help: help(
      'function',
      ['values'],
      'Returns the number of items in a list. An empty value counts as an empty list.',
      ['size', 'length', 'items', 'cardinality'],
      [
        ['count(["a", "b", "c"])', '3'],
        ['count([])', '0'],
      ],
    ),
  },
  unique: {
    category: 'math',
    generics: { T: ANY_ARRAY },
    params: [p('values', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['values'],
      'Removes duplicate items from a list.',
      ['distinct', 'deduplicate', 'dedupe'],
      [['count(unique([1, 2, 2, 3]))', '3']],
    ),
  },
  dateAdd: {
    category: 'date',
    generics: { T: [v('date'), v('number'), v('text')], U: NUM, UT: TEXT },
    params: [p('date', 'T'), p('units', 'U'), p('unit_type', 'UT')],
    returns: ret(v('date')),
    help: help(
      'function',
      ['date', 'units', 'unit_type'],
      'Adds a number of days, weeks, months, quarters or years to a date. Use a negative number to subtract.',
      ['date add', 'time add', 'add days', 'add months'],
      [
        ['dateAdd(date("2024-01-15"), 30, "days")', '2024-02-14'],
        ['dateAdd(date("2024-01-31"), 1, "months")', '2024-02-29'],
      ],
    ),
  },
  dateDiff: {
    category: 'date',
    generics: { T: DATE_LIKE, S: DATE_LIKE, UT: TEXT },
    params: [p('start_date', 'T'), p('end_date', 'S'), p('unit_type', 'UT')],
    returns: ret(v('number')),
    help: help(
      'function',
      ['start_date', 'end_date', 'unit_type'],
      'Returns the whole number of seconds, minutes, hours, days, weeks, months, quarters or years between two dates (always positive).',
      ['date difference', 'time difference', 'duration', 'elapsed'],
      [
        ['dateDiff(date("2024-01-01"), date("2024-03-01"), "days")', '60'],
        ['dateDiff(date("2024-05-20"), date("2023-01-10"), "months")', '16'],
      ],
    ),
  },
  formatDate: {
    category: 'date',
    generics: { T: [v('date'), v('number'), v('text')], F: TEXT },
    params: [p('date', 'T'), p('format', 'F')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['date', 'format'],
      'Formats a date as text. Tokens: yyyy (year), MM (month), MMM / MMMM (month name), dd (day), EEE / EEEE (weekday), Q (quarter), HH (hour), mm (minute), ss (second).',
      ['date format', 'date string', 'date to text', 'format date'],
      [
        ['formatDate(date("2024-03-05"), "dd/MM/yyyy")', '05/03/2024'],
        ['formatDate(date("2024-03-05"), "MMMM d, yyyy")', 'March 5, 2024'],
      ],
    ),
  },
  date: {
    category: 'date',
    generics: { T: [v('number'), v('text')] },
    params: [p('raw_date', 'T')],
    returns: ret(v('date')),
    help: help(
      'function',
      ['raw_date'],
      'Converts ISO date text ("2024-01-15") or milliseconds since 1970 into a date.',
      ['parse date', 'to date', 'convert date'],
      [['date("2024-01-15")', '2024-01-15']],
    ),
  },
  timestamp: {
    category: 'date',
    generics: { T: [v('text'), v('number'), v('timestamp'), v('date')] },
    params: [p('value', 'T')],
    returns: ret(v('timestamp')),
    help: help(
      'function',
      ['value'],
      'Converts ISO date-time text or milliseconds since 1970 into a timestamp.',
      ['parse timestamp', 'to timestamp', 'convert timestamp'],
      [
        ['timestamp("2024-01-15T09:30:00Z")', '2024-01-15T09:30:00.000Z'],
        ['timestamp(0)', '1970-01-01T00:00:00.000Z'],
      ],
    ),
  },
  power: {
    category: 'math',
    generics: { T: NUM_CUR, U: NUM },
    params: [p('base', 'T'), p('exponent', 'U')],
    returns: gen('T'),
    help: help(
      'function',
      ['base', 'exponent'],
      'Raises a number to a power.',
      ['pow', 'exponent', 'raise'],
      [['power(2, 10)', '1024']],
    ),
  },
  mod: {
    category: 'math',
    generics: { T: NUM_CUR, U: NUM },
    params: [p('dividend', 'T'), p('divisor', 'U')],
    returns: gen('T'),
    help: help(
      'function',
      ['dividend', 'divisor'],
      'Returns the remainder of a division; the result has the sign of the divisor.',
      ['modulo', 'remainder', 'modulus'],
      [['mod(17, 5)', '2']],
    ),
  },
  random: {
    category: 'math',
    generics: {},
    params: [],
    returns: ret(v('number')),
    help: help(
      'function',
      [],
      'Returns a random number between 0 and 1.',
      ['rand', 'random number'],
      [['random() < 1', 'true']],
    ),
  },
  now: {
    category: 'date',
    generics: {},
    params: [],
    returns: ret(v('timestamp')),
    help: help(
      'function',
      [],
      'Returns the current timestamp. Formulas using it are also recalculated daily.',
      ['current time', 'current timestamp', 'today'],
      [['now() > timestamp("2020-01-01T00:00:00Z")', 'true']],
    ),
  },
  today: {
    category: 'date',
    generics: {},
    params: [],
    returns: ret(v('date')),
    help: help(
      'function',
      [],
      "Returns today's date (UTC). Formulas using it are also recalculated daily.",
      ['current date', 'today'],
      [['today() > date("2020-01-01")', 'true']],
    ),
  },
  if: {
    category: 'logic',
    generics: { T: CHECKBOX, S: ANY },
    params: [p('condition', 'T'), p('trueValue', 'S'), p('falseValue', 'S')],
    returns: gen('S'),
    help: help(
      'function',
      ['condition', 'trueValue', 'falseValue'],
      'Returns the second argument when the condition is true, otherwise the third. An empty condition counts as false.',
      ['conditional', 'ternary', 'branch', 'when'],
      [
        ['if(5 > 3, "big", "small")', 'big'],
        ['if(null, 1, 2)', '2'],
      ],
    ),
  },
  and: {
    category: 'logic',
    operator: 'and',
    generics: { T: CHECKBOX },
    params: [p('left', 'T'), p('right', 'T')],
    returns: ret(v('checkbox')),
    help: help(
      'operator',
      ['left', 'right'],
      'True when both values are true.',
      ['logical', 'boolean', '&&', 'both'],
      [
        ['true and false', 'false'],
        ['and(true, true)', 'true'],
      ],
    ),
  },
  or: {
    category: 'logic',
    operator: 'or',
    generics: { T: CHECKBOX },
    params: [p('left', 'T'), p('right', 'T')],
    returns: ret(v('checkbox')),
    help: help(
      'operator',
      ['left', 'right'],
      'True when at least one of the values is true.',
      ['logical', 'boolean', '||', 'either'],
      [
        ['true or false', 'true'],
        ['or(false, false)', 'false'],
      ],
    ),
  },
  not: {
    category: 'logic',
    operator: '!',
    generics: { T: CHECKBOX },
    params: [p('operand', 'T')],
    returns: ret(v('checkbox')),
    help: help(
      'operator',
      ['value'],
      'Inverts a checkbox value.',
      ['logical', 'boolean', 'negate', 'inverse', '!'],
      [
        ['!true', 'false'],
        ['not(false)', 'true'],
      ],
    ),
  },
  ifNull: {
    category: 'logic',
    operator: '??',
    generics: { T: ANY },
    params: [p('left', 'T'), p('right', 'T')],
    returns: gen('T'),
    help: help(
      'function',
      ['left', 'right'],
      'Returns the first value unless it is empty, otherwise the second.',
      ['null', 'null coalesce', 'default value', 'fallback', 'coalesce', '??'],
      [
        ['ifNull(null, "fallback")', 'fallback'],
        ['null ?? 7', '7'],
      ],
    ),
  },
  day: datePart('day of the month', ['day of month', 'extract day'], ['day(date("2024-03-05"))', '5']),
  month: datePart('month (1–12)', ['month of year', 'extract month'], ['month(date("2024-03-05"))', '3']),
  year: datePart('year', ['extract year'], ['year(date("2024-03-05"))', '2024']),
  quarter: datePart('quarter (1–4)', ['fiscal quarter', 'extract quarter'], ['quarter(date("2024-08-05"))', '3']),
  hour: datePart('hour (0–23, UTC)', ['extract hour', 'time'], ['hour(timestamp("2024-03-05T14:30:00Z"))', '14']),
  minute: datePart('minute', ['extract minute', 'time'], ['minute(timestamp("2024-03-05T14:30:00Z"))', '30']),
  second: datePart('second', ['extract second', 'time'], ['second(timestamp("2024-03-05T14:30:15Z"))', '15']),
  eomonth: {
    category: 'date',
    generics: { T: DATE_LIKE },
    params: [p('date', 'T')],
    returns: ret(v('date')),
    help: help(
      'function',
      ['date'],
      'Returns the last day of the month of a date.',
      ['end of month', 'last day', 'month end'],
      [['eomonth(date("2024-02-10"))', '2024-02-29']],
    ),
  },
  setTimezone: {
    category: 'date',
    generics: { T: DATE_LIKE, TZ: TEXT },
    params: [p('date', 'T'), p('timezone', 'TZ')],
    returns: ret(v('timestamp')),
    help: help(
      'function',
      ['date', 'timezone'],
      'Reads the date and time as a local time in an IANA time zone (e.g. "Europe/London") and returns that moment.',
      ['timezone', 'tz', 'convert timezone'],
      [['setTimezone(timestamp("2024-07-01T09:00:00Z"), "Europe/London")', '2024-07-01T08:00:00.000Z']],
    ),
  },
  contains: {
    category: 'text',
    generics: { T: [v('text'), arr('text')], U: TEXT },
    params: [p('haystack', 'T'), p('needle', 'U')],
    returns: ret(v('checkbox')),
    help: help(
      'function',
      ['haystack', 'needle'],
      'True when the text contains the search text, or when a list contains the value (case-sensitive).',
      ['includes', 'has', 'search', 'find', 'substring'],
      [
        ['contains("Acme Inc", "Inc")', 'true'],
        ['contains(["a", "b"], "c")', 'false'],
      ],
    ),
  },
  length: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('value', 'T')],
    returns: ret(v('number')),
    help: help(
      'function',
      ['value'],
      'Returns the number of characters in a text.',
      ['size', 'count', 'length'],
      [['length("attio")', '5']],
    ),
  },
  replace: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('subject', 'T'), p('search', 'T'), p('replacement', 'T')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['subject', 'search', 'replacement'],
      'Replaces the first occurrence of the search text.',
      ['replace', 'substitute', 'swap', 'change'],
      [
        ['replace("a-b-c", "-", "+")', 'a+b-c'],
        ['replace("hello", "x", "y")', 'hello'],
      ],
    ),
  },
  replaceAll: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('subject', 'T'), p('search', 'T'), p('replacement', 'T')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['subject', 'search', 'replacement'],
      'Replaces every occurrence of the search text.',
      ['replace', 'substitute', 'swap', 'change', 'all'],
      [
        ['replaceAll("a-b-c", "-", "+")', 'a+b+c'],
        ['replaceAll("aaa", "a", "b")', 'bbb'],
      ],
    ),
  },
  startsWith: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('subject', 'T'), p('search', 'T')],
    returns: ret(v('checkbox')),
    help: help(
      'function',
      ['subject', 'search'],
      'True when the text starts with the search text (case-sensitive).',
      ['starts', 'begins', 'prefix', 'prefixed'],
      [
        ['startsWith("attio.com", "attio")', 'true'],
        ['startsWith("attio.com", "Attio")', 'false'],
      ],
    ),
  },
  endsWith: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('subject', 'T'), p('search', 'T')],
    returns: ret(v('checkbox')),
    help: help(
      'function',
      ['subject', 'search'],
      'True when the text ends with the search text (case-sensitive).',
      ['ends', 'suffix', 'extension', 'trailing'],
      [['endsWith("report.pdf", ".pdf")', 'true']],
    ),
  },
  left: {
    category: 'text',
    generics: { T: TEXT, N: NUM },
    params: [p('subject', 'T'), p('count', 'N')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['subject', 'count'],
      'Returns the first characters of a text.',
      ['substring', 'prefix', 'truncate', 'first', 'start'],
      [['left("Attio", 3)', 'Att']],
    ),
  },
  right: {
    category: 'text',
    generics: { T: TEXT, N: NUM },
    params: [p('subject', 'T'), p('count', 'N')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['subject', 'count'],
      'Returns the last characters of a text.',
      ['substring', 'suffix', 'truncate', 'last', 'end'],
      [['right("Attio", 2)', 'io']],
    ),
  },
  lower: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('value', 'T')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['value'],
      'Converts text to lower case.',
      ['lowercase', 'lower case', 'case', 'downcase'],
      [['lower("ACME")', 'acme']],
    ),
  },
  upper: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('value', 'T')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['value'],
      'Converts text to upper case.',
      ['uppercase', 'upper case', 'case', 'capitalise', 'capitalize'],
      [['upper("acme")', 'ACME']],
    ),
  },
  split: {
    category: 'text',
    generics: { T: TEXT },
    params: [p('subject', 'T'), p('delimiter', 'T')],
    returns: ret(arr('text')),
    help: help(
      'function',
      ['subject', 'delimiter'],
      'Splits a text into a list. A formula cannot return a list, so index it or aggregate it.',
      ['split', 'delimiter', 'separator', 'parts', 'explode'],
      [
        ['split("a,b,c", ",")[0]', 'a'],
        ['count(split("a,b,c", ","))', '3'],
      ],
    ),
  },
  splitPart: {
    category: 'text',
    generics: { T: TEXT, N: NUM },
    params: [p('subject', 'T'), p('delimiter', 'T'), p('index', 'N')],
    returns: ret(v('text')),
    help: help(
      'function',
      ['subject', 'delimiter', 'index'],
      'Splits a text and returns the part at a zero-based position (empty when out of range).',
      ['split', 'delimiter', 'separator', 'part', 'nth', 'index'],
      [
        ['splitPart("hello@attio.com", "@", 1)', 'attio.com'],
        ['splitPart("a,b", ",", 0)', 'a'],
      ],
    ),
  },
  valueAt: {
    category: 'history',
    generics: { T: ANY_ATTR, U: [v('timestamp')] },
    params: [p('value', 'T'), p('at', 'U')],
    returns: gen('T', 'value'),
    help: help(
      'function',
      ['attribute', 'timestamp'],
      'Returns the value an attribute had at a moment in time.',
      ['history', 'historical', 'at', 'point in time', 'snapshot'],
      [],
    ),
  },
  hasBeenIn: {
    category: 'history',
    generics: {
      T: HISTORY_ATTR_ORDERED,
      V: [v('select'), v('pipeline'), v('actor-reference'), arr('select'), arr('pipeline'), arr('actor-reference')],
    },
    params: [p('attribute', 'T'), p('values', 'V')],
    returns: ret(v('checkbox')),
    help: help(
      'function',
      ['attribute', 'values'],
      'True when a select, status or user attribute has ever had one of the given values.',
      ['history', 'historical', 'select', 'stage', 'status', 'option'],
      [],
    ),
  },
  valueSetAt: {
    category: 'history',
    generics: {
      T: HISTORY_ATTR_ORDERED,
      V: [v('select'), v('pipeline'), v('actor-reference')],
      P: TEXT,
    },
    params: [
      p('attribute', 'T'),
      p('value', 'V'),
      p('position', 'P', { optional: true, allowedLiterals: ['first', 'last'] }),
    ],
    returns: ret(v('timestamp')),
    help: help(
      'function',
      ['attribute', 'value', 'position'],
      'Returns when an attribute was set to a value: the "first" time (default) or the "last" time.',
      ['history', 'historical', 'select', 'status', 'stage', 'option', 'first', 'last'],
      [],
    ),
  },
  timeSpentIn: {
    category: 'history',
    generics: {
      T: HISTORY_ATTR_ORDERED,
      V: [v('select'), v('pipeline'), v('actor-reference')],
      U: TEXT,
    },
    params: [
      p('attribute', 'T'),
      p('value', 'V'),
      p('unit', 'U', { allowedLiterals: ['hours', 'days', 'weeks', 'months'] }),
    ],
    returns: ret(v('number')),
    help: help(
      'function',
      ['attribute', 'value', 'unit'],
      'Returns how long an attribute has had a value in total, in hours, days, weeks or months (30 days).',
      ['history', 'historical', 'duration', 'select', 'status', 'stage', 'option'],
      [],
    ),
  },
  text: {
    category: 'conversion',
    generics: { T: ANY },
    params: [p('value', 'T')],
    returns: ret(v('text')),
    help: null,
  },
  number: {
    category: 'conversion',
    generics: {
      T: [v('text'), v('number'), v('date'), v('timestamp'), v('currency'), v('rating'), v('checkbox')],
    },
    params: [p('value', 'T')],
    returns: ret(v('number')),
    help: null,
  },
  currency: {
    category: 'conversion',
    generics: { T: [v('text'), v('number'), v('currency')] },
    params: [p('value', 'T')],
    returns: ret(v('currency')),
    help: null,
  },
  checkbox: {
    category: 'conversion',
    generics: { T: ANY },
    params: [p('value', 'T')],
    returns: ret(v('checkbox')),
    help: null,
  },
  rating: {
    category: 'conversion',
    generics: { T: [v('text'), v('number'), v('rating')] },
    params: [p('value', 'T')],
    returns: ret(v('rating')),
    help: null,
  },
  phoneNumber: {
    category: 'conversion',
    generics: { T: [v('text'), v('phone-number'), arr('text'), arr('phone-number')] },
    params: [p('value', 'T')],
    returns: ret(arr('phone-number')),
    help: null,
  },
  previousValue: {
    category: 'history',
    generics: {
      T: [
        ...KINDS.filter((k) => k !== 'interaction').map((k) => attrOf(k)),
        ...KINDS.filter((k) => k !== 'interaction').map((k) => attrOf(arr(k))),
      ],
    },
    params: [p('attribute', 'T')],
    returns: gen('T', 'value'),
    help: help(
      'function',
      ['attribute'],
      'Returns the value an attribute had before its current value (empty when there was none).',
      ['history', 'historical', 'previous', 'prior', 'last'],
      [],
    ),
  },
};

export const FUNCTIONS: Record<FunctionName, FunctionDecl> = Object.fromEntries(
  FUNCTION_NAMES.map((name) => {
    const d = DECLS[name];
    return [
      name,
      { ...d, name, operator: d.operator ?? null, operatorOnly: d.operatorOnly ?? false } satisfies FunctionDecl,
    ];
  }),
) as Record<FunctionName, FunctionDecl>;

/** Lower-case name → canonical name (function names resolve case-insensitively, §1.3). */
const BY_LOWER = new Map<string, FunctionName>(FUNCTION_NAMES.map((n) => [n.toLowerCase(), n]));

export function lookupFunction(name: string): FunctionDecl | null {
  const canonical = BY_LOWER.get(name.toLowerCase());
  return canonical ? FUNCTIONS[canonical] : null;
}

/** Binary operator → function. */
export const BINARY_OPERATORS: Record<string, FunctionName> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '==': 'equals',
  '!=': 'notEquals',
  '>': 'greaterThan',
  '>=': 'greaterThanOrEqual',
  '<': 'lessThan',
  '<=': 'lessThanOrEqual',
  and: 'and',
  or: 'or',
  '??': 'ifNull',
};

export const UNARY_OPERATORS: Record<string, FunctionName> = { '!': 'not', '-': 'negate' };

/** Names offered by autocomplete: every function callable by name, alphabetically (§2.1). */
export const AUTOCOMPLETE_FUNCTIONS: FunctionName[] = FUNCTION_NAMES.filter((n) => !FUNCTIONS[n].operatorOnly).sort(
  (a, b) => a.localeCompare(b),
);

/** Functions listed in the helper panel (those with a help entry), in catalog order. */
export const HELP_FUNCTIONS: FunctionDecl[] = FUNCTION_NAMES.map((n) => FUNCTIONS[n]).filter((d) => d.help !== null);
