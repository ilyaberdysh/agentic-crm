import { describe, expect, it } from 'vitest';
import { AUTOCOMPLETE_FUNCTIONS, FUNCTION_NAMES, FUNCTIONS, HELP_FUNCTIONS } from '../src/index.ts';
import { run } from './helpers.ts';

describe('catalog', () => {
  it('has 72 declarations: 61 callable, 11 operator-only, 55 help entries', () => {
    expect(FUNCTION_NAMES).toHaveLength(72);
    const operatorOnly = FUNCTION_NAMES.filter((n) => FUNCTIONS[n].operatorOnly);
    expect(operatorOnly.sort()).toEqual(
      [
        'add',
        'subtract',
        'multiply',
        'divide',
        'equals',
        'notEquals',
        'greaterThan',
        'lessThan',
        'greaterThanOrEqual',
        'lessThanOrEqual',
        'negate',
      ].sort(),
    );
    expect(AUTOCOMPLETE_FUNCTIONS).toHaveLength(61);
    expect(HELP_FUNCTIONS).toHaveLength(55);
    expect(HELP_FUNCTIONS.filter((f) => f.help?.kind === 'operator').map((f) => f.name)).toEqual(['and', 'or', 'not']);
    const hidden = FUNCTION_NAMES.filter((n) => !FUNCTIONS[n].help && !FUNCTIONS[n].operatorOnly);
    expect(hidden.sort()).toEqual(['checkbox', 'currency', 'number', 'phoneNumber', 'rating', 'text']);
  });

  it('autocomplete is alphabetical', () => {
    expect([...AUTOCOMPLETE_FUNCTIONS].sort((a, b) => a.localeCompare(b))).toEqual(AUTOCOMPLETE_FUNCTIONS);
  });

  describe('every help example evaluates to its output', () => {
    const examples = HELP_FUNCTIONS.flatMap((f) => (f.help?.examples ?? []).map((ex) => ({ fn: f.name, ...ex })));
    it.each(examples)('$fn: $code → $output', ({ code, output }) => {
      expect(run(code)).toBe(output);
    });
  });
});

// Table-driven semantics of every function and operator: [formula, expected preview text].
const CASES: [string, string | null][] = [
  // arithmetic and text concatenation (§2.4)
  ['1 + 2 * 3', '7'],
  ['(1 + 2) * 3', '9'],
  ['10 - 4 - 3', '3'],
  ['7 / 2', '3.5'],
  ['0.1 + 0.2', '0.3'],
  ['-5 + 2', '-3'],
  ['--5', '5'],
  ['"a" + "b"', 'ab'],
  ['1 + "a"', '1a'],
  ['"n=" + 2.5', 'n=2.5'],
  ['_{d-value} * 2', '3000'],
  ['_{d-headcount} / 4', '5'],
  ['1 / 0', 'ERR:division-by-zero'],
  ['null + 1', null],
  // comparison
  ['3 > 2', 'true'],
  ['3 >= 3', 'true'],
  ['2 < 1', 'false'],
  ['2 <= 2', 'true'],
  ['"a" == "a"', 'true'],
  ['"a" != "b"', 'true'],
  ['1 == 1', 'true'],
  ['1 == "1"', 'true'],
  ['_{d-stage} == "Won"', 'true'],
  ['_{d-stage} == _{stage-won}', 'true'],
  ['_{d-stage} == _{stage-lost}', 'false'],
  ['_{d-stage} != _{stage-lost}', 'true'],
  ['_{d-owner} == _{m-ann}', 'true'],
  ['_{d-name} == null', 'false'],
  ['null == null', 'true'],
  ['"" == null', 'true'],
  ['_{d-close} > date("2024-01-01")', 'true'],
  ['_{d-close} < today()', 'true'],
  ['1 < 2 == true', 'true'],
  // logic
  ['true and true', 'true'],
  ['true AND false', 'false'],
  ['false Or true', 'true'],
  ['!false', 'true'],
  ['not(true)', 'false'],
  ['and(null, true)', 'false'],
  ['or(null, false)', 'false'],
  ['!null', 'true'],
  ['if(true, "y", "n")', 'y'],
  ['IF(false, "y", "n")', 'n'],
  ['if(1 > 2, 1, "two")', 'two'],
  ['if(null, "y", "n")', 'n'],
  ['ifNull(null, 3)', '3'],
  ['ifNull(5, 3)', '5'],
  ['null ?? null ?? 9', '9'],
  ['"" ?? "x"', 'x'],
  ['IfNull(null, 1)', '1'],
  // math
  ['avg([1, 2, 3])', '2'],
  ['avg([])', null],
  ['exp(0)', '1'],
  ['log(1)', '0'],
  ['log(0)', 'ERR:math-domain-error'],
  ['abs(-3.5)', '3.5'],
  ['round(2.5, 0)', '3'],
  ['round(-2.5, 0)', '-3'],
  ['round(1.005, 2)', '1.01'],
  ['round(1234.5, -2)', '1200'],
  ['ceil(-1.5)', '-1'],
  ['floor(-1.5)', '-2'],
  ['max([1, 5, 3])', '5'],
  ['min([4, 2, 8])', '2'],
  ['mean([2, 4])', '3'],
  ['median([3, 1, 2])', '2'],
  ['sum([])', '0'],
  ['sum([1, null, 2])', '3'],
  ['count([1, 2, 3])', '3'],
  ['count(null)', '0'],
  ['count(_{d-tags})', '2'],
  ['count(unique(["a", "b", "a"]))', '2'],
  ['power(3, 2)', '9'],
  ['power(-8, 0.5)', 'ERR:math-domain-error'],
  ['mod(-7, 3)', '2'],
  ['mod(7, -3)', '-2'],
  ['mod(1, 0)', 'ERR:division-by-zero'],
  ['random()', '0.42'],
  ['sum(_{p-age})', '70'],
  ['avg(_{p-age})', '35'],
  ['max(_{p-age})', '40'],
  ['count(_{d-people})', '2'],
  // dates
  ['dateAdd(date("2024-01-15"), 1, "years")', '2025-01-15'],
  ['dateAdd(date("2024-02-29"), 1, "year")', '2025-02-28'],
  ['dateAdd(date("2024-03-31"), -1, "months")', '2024-02-29'],
  ['dateAdd(date("2024-01-01"), 2, "weeks")', '2024-01-15'],
  ['dateAdd(date("2024-01-01"), 1, "quarters")', '2024-04-01'],
  ['dateAdd("2024-01-01", 1, "days")', '2024-01-02'],
  ['dateAdd(date("2024-01-01"), 1, "fortnights")', 'ERR:invalid-argument'],
  ['dateDiff(date("2024-03-01"), date("2024-01-01"), "days")', '60'],
  ['dateDiff(date("2024-01-31"), date("2024-02-29"), "months")', '1'],
  ['dateDiff(date("2024-01-31"), date("2024-03-01"), "months")', '1'],
  ['dateDiff(date("2020-02-29"), date("2024-02-28"), "years")', '3'],
  ['dateDiff(timestamp("2024-01-01T00:00:00Z"), timestamp("2024-01-01T05:59:00Z"), "hours")', '5'],
  ['dateDiff("2024-01-01", "2024-01-08", "weeks")', '1'],
  ['dateDiff(_{d-created}, now(), "days")', '168'],
  ['formatDate(date("2024-03-05"), "yyyy-MM-dd")', '2024-03-05'],
  ['formatDate(date("2024-03-05"), "DD/MM/YYYY")', '05/03/2024'],
  ['formatDate(date("2024-03-05"), "EEEE, do MMM")', 'Tuesday, 5th Mar'],
  ['formatDate(date("2024-08-05"), "[Q]Q YYYY")', 'Q3 2024'],
  ['formatDate(timestamp("2024-03-05T15:04:00Z"), "h:mm a \'UTC\'")', '3:04 PM UTC'],
  ['date("2024-02-30")', 'ERR:invalid-argument'],
  ['date("2024-03-05T10:00:00Z")', '2024-03-05'],
  ['date(86400000)', '1970-01-02'],
  ['timestamp("2024-01-15 09:30")', '2024-01-15T09:30:00.000Z'],
  ['timestamp("2024-01-15T09:30:00+02:00")', '2024-01-15T07:30:00.000Z'],
  ['timestamp(date("2024-01-15"))', '2024-01-15T00:00:00.000Z'],
  ['timestamp("nope")', 'ERR:invalid-argument'],
  ['now()', '2024-07-01T12:00:00.000Z'],
  ['today()', '2024-07-01'],
  ['day("2024-03-05")', '5'],
  ['month(_{d-close})', '6'],
  ['year(_{d-created})', '2024'],
  ['quarter(date("2024-12-31"))', '4'],
  ['hour(_{d-created})', '9'],
  ['minute(_{d-created})', '30'],
  ['second(timestamp("2024-01-01T00:00:59Z"))', '59'],
  ['eomonth(date("2023-02-10"))', '2023-02-28'],
  ['eomonth(_{d-created})', '2024-01-31'],
  ['setTimezone(timestamp("2024-01-15T09:00:00Z"), "America/New_York")', '2024-01-15T14:00:00.000Z'],
  ['setTimezone(timestamp("2024-01-15T09:00:00Z"), "Mars/Base")', 'ERR:invalid-argument'],
  ['_{d-created} > now()', 'false'],
  ['_{d-close} - date("2024-06-29")', '86400000'],
  // text
  ['contains("Acme", "cme")', 'true'],
  ['contains("Acme", "CME")', 'false'],
  ['contains(_{d-tags}, "VIP")', 'true'],
  ['contains(null, "x")', 'false'],
  ['contains(_{c-domains}, "acme.io")', 'true'],
  ['length("héllo")', '5'],
  ['length(_{d-name})', '12'],
  ['replace("aaa", "a", "b")', 'baa'],
  ['replace("$1", "$", "€")', '€1'],
  ['replaceAll("a.b.c", ".", "")', 'abc'],
  ['startsWith(_{d-name}, "Acme")', 'true'],
  ['endsWith(_{d-name}, "renewal")', 'true'],
  ['left("abc", 10)', 'abc'],
  ['left("abc", 0)', ''],
  ['right("abc", -1)', ''],
  ['right("abc", 2)', 'bc'],
  ['lower(_{c-name})', 'acme inc'],
  ['upper("ß")', 'SS'],
  ['split("a,b,c", ",")[2]', 'c'],
  ['split("a,b", ",")[5]', 'ERR:array-index-out-of-bounds'],
  ['split("a,b", ",")[1.5]', 'ERR:invalid-array-index'],
  ['split("a,b", ",")[-1]', 'ERR:invalid-array-index'],
  ['splitPart("a,b,c", ",", 1)', 'b'],
  ['splitPart("a,b,c", ",", 7)', ''],
  ['"x" + null', null],
  // conversions
  ['text(12.5)', '12.5'],
  ['text(true)', 'true'],
  ['text(_{d-stage})', 'Won'],
  ['text(_{d-tags})', 'VIP, EU'],
  ['text(_{d-company})', 'c-1'],
  ['text(_{d-owner})', 'Member ann'],
  ['text(_{c-hq})', '1 Main St, London, N1, GB'],
  ['text(_{d-close})', '2024-06-30'],
  ['number("1,234.5")', '1234.5'],
  ['number("abc")', 'ERR:invalid-argument'],
  ['number(true)', '1'],
  ['number(date("1970-01-02"))', '86400000'],
  ['number(_{d-value})', '1500'],
  ['currency("$1,200.50")', '1200.5'],
  ['currency(12)', '12'],
  ['checkbox("")', 'false'],
  ['checkbox("x")', 'true'],
  ['checkbox(0)', 'false'],
  ['checkbox(null)', 'false'],
  ['checkbox(_{d-tags})', 'true'],
  ['rating(7)', '5'],
  ['rating("2.6")', '3'],
  ['rating(-1)', '0'],
  ['count(phoneNumber("+44 20 7946 0958"))', '1'],
  ['text(phoneNumber("+44 (20) 7946-0958"))', '+442079460958'],
  ['phoneNumber("12345")[0]', 'ERR:invalid-argument'],
  // references, paths, sub-fields
  ['_{c-name}', 'Acme Inc'],
  ['_{c-employees} / _{d-headcount}', '12.5'],
  ['_{c-hq}.locality', 'London'],
  ['_{c-hq}.country_code', 'GB'],
  ['_{d-owner}.email_address', 'm-ann@x.io'],
  ['_{d-owner}.text', 'Member ann'],
  ['_{p-first}[1]', 'Bob'],
  ['_{p-email}.email_domain[0]', 'acme.com'],
  ['_{d-tags}[0]', 'VIP'],
  ['_{d-touchat}', '2024-05-01T00:00:00.000Z'],
  ['_{d-old} + 1', 'ERR:referenced-attribute-missing-or-archived'],
  ['// a comment\n_{d-headcount} // trailing\n  + 1', '21'],
];

describe('function semantics', () => {
  it.each(CASES)('%s → %s', (formula, expected) => {
    expect(run(formula)).toBe(expected);
  });

  it('covers every callable function and operator', () => {
    const text = CASES.map(([f]) => f).join(' ');
    const missing = FUNCTION_NAMES.filter((name) => {
      const decl = FUNCTIONS[name];
      if (decl.category === 'history') return false; // history.test.ts
      if (decl.operatorOnly) {
        const op = decl.operator as string;
        return !text.includes(` ${op} `) && !text.includes(op);
      }
      return !new RegExp(`\\b${name}\\(`, 'i').test(text);
    });
    expect(missing).toEqual([]);
  });

  it('null propagates through most functions', () => {
    for (const f of ['abs(null)', 'upper(null)', 'dateAdd(null, 1, "days")', 'round(null, 2)', 'year(null)']) {
      expect(run(f)).toBeNull();
    }
  });
});
