// Formula editor glue (BACKLOG 10.06): chip ⇄ text serialization and clipboard payloads, autocomplete ranking and
// the editor-driven helper query, diagnostics → editor ranges, helper groups, client-side checking against cached
// attribute lists, drafts ⇄ the attribute write shape, preview text.
import type { FormulaSnapshot } from '@agentic-crm/contracts';
import type { FormulaAnnotation } from '@agentic-crm/formula';
import { describe, expect, it } from 'vitest';
import { attr, OBJ_ID } from '../attributes/test/fixtures';
import { editorQuery, functionMatches, rankByTitle } from './model/complete';
import { chipError, errorRanges, lineLabel, messageAt } from './model/diagnostics';
import { formulaConfigurationInput, formulaDraftOf, sameDraft } from './model/draft';
import {
  COLLAPSED_ATTRIBUTE_COUNT,
  flatItems,
  functionMatchesQuery,
  helperGroups,
  referenceableAttributes,
} from './model/helper';
import { outputButtonLabel, outputLabel } from './model/output';
import { previewDisplay } from './model/preview';
import { compileDraft, createFormulaSchema, definitionsOf } from './model/schema';
import {
  clipboardText,
  fieldFor,
  loadSource,
  parseClipboard,
  plainOffset,
  sameSource,
  storedSource,
  tokensIn,
  variableAnnotation,
  wireSource,
} from './model/source';

const budget = attr('currency', { title: 'Budget', id: '10000000-0000-4000-8000-0000000000b0' });
const headcount = attr('number', { title: 'Headcount', id: '10000000-0000-4000-8000-0000000000b2' });
const name = attr('text', { title: 'Name', id: '10000000-0000-4000-8000-0000000000b3' });
const hop = (a: { id: string }) => ({ entityDefinitionId: OBJ_ID, attributeDefinitionId: a.id });

const stored = {
  plaintext: '_ / _',
  annotations: [
    { ...variableAnnotation([hop(budget)], 'raw_value'), startPosition: 0 },
    { ...variableAnnotation([hop(headcount)]), startPosition: 4 },
  ] as FormulaAnnotation[],
};

let n = 0;
const mint = () => `00000000-0000-4000-8000-${(++n).toString().padStart(12, '0')}`;

describe('chip ⇄ text serialization', () => {
  it('loads stored formulas with fresh token ids and stores them back unchanged', () => {
    const doc = loadSource(stored, mint);
    expect(tokensIn(doc.text)).toHaveLength(2);
    expect(doc.text).toMatch(/^_\{[0-9a-f-]{36}\} \/ _\{[0-9a-f-]{36}\}$/);
    expect(doc.tokens.size).toBe(2);
    const back = storedSource(doc.text, doc.tokens);
    expect(back.plaintext).toBe('_ / _');
    expect(sameSource(back, stored)).toBe(true);
    // A second load mints new ids for the same formula.
    const again = loadSource(stored, mint);
    expect(again.text).not.toBe(doc.text);
    expect(sameSource(storedSource(again.text, again.tokens), stored)).toBe(true);
  });

  it('keeps tokens missing from the map as literal text and handles empty formulas', () => {
    const doc = loadSource(stored, mint);
    const first = [...doc.tokens.keys()][0] as string;
    const partial = new Map([[first, doc.tokens.get(first) as FormulaAnnotation]]);
    const back = storedSource(doc.text, partial);
    expect(back.annotations).toHaveLength(1);
    expect(back.plaintext.startsWith('_ / _{')).toBe(true);
    expect(loadSource(null)).toEqual({ text: '', tokens: new Map() });
  });

  it('maps editor offsets to plaintext offsets (a chip is one character)', () => {
    const doc = loadSource(stored, mint);
    const [a, b] = tokensIn(doc.text);
    expect(plainOffset(doc.text, 0)).toBe(0);
    expect(plainOffset(doc.text, a?.to ?? 0)).toBe(1);
    expect(plainOffset(doc.text, (a?.to ?? 0) + 3)).toBe(4);
    expect(plainOffset(doc.text, b?.to ?? 0)).toBe(5);
    // Inside a token: after its placeholder.
    expect(plainOffset(doc.text, (a?.from ?? 0) + 3)).toBe(1);
  });

  it('copies chips as {version, plaintext, annotations} and pastes them back', () => {
    const doc = loadSource(stored, mint);
    const clip = clipboardText(doc.text, doc.tokens);
    const parsed = parseClipboard(clip);
    expect(parsed && sameSource(parsed, stored)).toBe(true);
    expect(JSON.parse(clip).version).toBe(1);
    // Plain text stays plain.
    expect(clipboardText('1 + 2', doc.tokens)).toBe('1 + 2');
    expect(parseClipboard('1 + 2')).toBeNull();
    expect(parseClipboard('{"version":2,"plaintext":"x","annotations":[]}')).toBeNull();
  });

  it('wire shape: annotations have length 1; currency references use raw_value', () => {
    const wire = wireSource({
      plaintext: '_',
      annotations: [{ ...stored.annotations[0], length: 3 } as FormulaAnnotation],
    });
    expect(wire.annotations[0]?.length).toBe(1);
    expect(fieldFor('currency')).toBe('raw_value');
    expect(fieldFor('number')).toBeNull();
  });
});

describe('autocomplete and the editor-driven helper query', () => {
  it('functions: prefix match, alphabetical, callable by name only', () => {
    expect(functionMatches('ro')).toEqual(['round']);
    expect(functionMatches('rep')).toEqual(['replace', 'replaceAll']);
    expect(functionMatches('ADD')).toEqual([]); // operator-only (`+`)
    expect(functionMatches('date')).toEqual(['date', 'dateAdd', 'dateDiff']);
    expect(functionMatches('')).toEqual([]);
  });

  it('attributes: exact, prefix, word start, substring; stable within a rank', () => {
    const items = ['Next due task', 'Budget per head', 'Budget', 'Annual budget', 'Rebudgeted', 'Owner'];
    expect(rankByTitle(items, 'budget', (x) => x)).toEqual([
      'Budget',
      'Budget per head',
      'Annual budget',
      'Rebudgeted',
    ]);
    expect(rankByTitle(items, '', (x) => x)).toEqual(items);
  });

  it('editor query: `{…` searches attributes, words search everything, strings / comments / keywords do not', () => {
    expect(editorQuery('{Bud', 4)).toEqual({ kind: 'attribute', query: 'Bud', from: 0, to: 4 });
    expect(editorQuery('1 + {Next due', 13)).toEqual({ kind: 'attribute', query: 'Next due', from: 4, to: 13 });
    expect(editorQuery('rou', 3)).toEqual({ kind: 'word', query: 'rou', from: 0, to: 3 });
    expect(editorQuery('round(1, 2)', 2)).toEqual({ kind: 'word', query: 'round', from: 0, to: 5 });
    expect(editorQuery('"rou', 4)).toBeNull();
    expect(editorQuery('1 // rou', 8)).toBeNull();
    expect(editorQuery('x and', 5)).toBeNull();
    expect(editorQuery('TRUE', 4)).toBeNull();
    expect(editorQuery('12', 2)).toBeNull();
    expect(editorQuery('', 0)).toBeNull();
  });
});

describe('diagnostics → editor marks', () => {
  const d = (from: number, to: number, message = 'x', line = 1, endLine = 1) => ({
    code: 'UNEXPECTED_TOKEN' as const,
    message,
    severity: 'error' as const,
    from,
    to,
    line,
    column: 1,
    endLine,
    endColumn: 1,
  });

  it('marks non-empty ranges; zero-width ones take the previous (or first) character', () => {
    expect(errorRanges([d(2, 5)], 10)).toEqual([{ from: 2, to: 5, message: 'x' }]);
    expect(errorRanges([d(10, 10)], 10)).toEqual([{ from: 9, to: 10, message: 'x' }]);
    expect(errorRanges([d(0, 0)], 10)).toEqual([{ from: 0, to: 1, message: 'x' }]);
    expect(errorRanges([d(4, 99)], 6)).toEqual([{ from: 4, to: 6, message: 'x' }]);
    expect(errorRanges([d(0, 1)], 0)).toEqual([]);
  });

  it('hover finds the innermost range; chips take the covering message', () => {
    const ranges = errorRanges([d(0, 10, 'outer'), d(3, 5, 'inner')], 12);
    expect(messageAt(ranges, 4)?.message).toBe('inner');
    expect(messageAt(ranges, 8)?.message).toBe('outer');
    expect(messageAt(ranges, 11)).toBeNull();
    expect(chipError(ranges, 3, 5)).toBe('outer');
    expect(chipError(ranges, 10, 11)).toBeNull();
    expect(lineLabel({ line: 2, endLine: 2 })).toBe('Line 2');
    expect(lineLabel({ line: 2, endLine: 4 })).toBe('Lines 2-4');
  });
});

describe('client-side checking against cached attribute lists', () => {
  const lookup = (id: string) => (id === OBJ_ID ? [budget, headcount, name] : undefined);

  it('checks a draft with chips: number output, no diagnostics', () => {
    const doc = loadSource(stored, mint);
    const compiled = compileDraft(doc.text, doc.tokens, OBJ_ID, lookup, null);
    expect(compiled.ok).toBe(true);
    expect(compiled.inferredOutputType).toBe('number');
    expect(compiled.outputType).toBe('number');
  });

  it('reports unknown functions and unknown attributes; overrides change the stored type', () => {
    const bad = compileDraft('1 + unknownFn(1)', new Map(), OBJ_ID, lookup, null);
    expect(bad.ok).toBe(false);
    expect(bad.diagnostics.map((x) => x.message)).toEqual(['Invalid function name unknownFn']);
    const doc = loadSource(
      {
        plaintext: '_',
        annotations: [
          { ...variableAnnotation([hop({ id: '10000000-0000-4000-8000-0000000000ff' })]), startPosition: 0 },
        ],
      },
      mint,
    );
    expect(compileDraft(doc.text, doc.tokens, OBJ_ID, lookup, null).diagnostics[0]?.code).toBe('UNKNOWN_VARIABLE');
    const text = compileDraft('1 + 2', new Map(), OBJ_ID, lookup, 'text');
    expect(text.outputType).toBe('text');
    expect(text.inferredOutputType).toBe('number');
    expect(createFormulaSchema(lookup).attribute(OBJ_ID, budget.id)?.type).toBe('currency');
    expect(definitionsOf(stored.annotations)).toEqual([OBJ_ID]);
  });
});

describe('helper panel', () => {
  const many = Array.from({ length: 8 }, (_, i) => attr('text', { title: `Field ${i}` }));

  it('lists the first 5 attributes + Show more, then the functions', () => {
    const groups = helperGroups({ attributes: many, drill: [], query: '', queryKind: 'search', expanded: false });
    expect(groups.map((g) => g.id)).toEqual(['attributes', 'functions']);
    const attrs = groups[0]?.items ?? [];
    expect(attrs.filter((i) => i.kind === 'attribute')).toHaveLength(COLLAPSED_ATTRIBUTE_COUNT);
    expect(attrs.at(-1)).toMatchObject({ kind: 'toggle', expanded: false });
    const expanded = helperGroups({ attributes: many, drill: [], query: '', queryKind: 'search', expanded: true });
    expect(expanded[0]?.items.filter((i) => i.kind === 'attribute')).toHaveLength(8);
  });

  it('filters by query; an attribute query lists attributes only; drilled levels have Back', () => {
    const q = helperGroups({
      attributes: [budget, headcount],
      drill: [],
      query: 'bud',
      queryKind: 'attribute',
      expanded: false,
    });
    expect(q.map((g) => g.id)).toEqual(['attributes']);
    expect(flatItems(q).map((i) => (i.kind === 'attribute' ? i.attribute.title : i.kind))).toEqual(['Budget']);
    const fn = helperGroups({ attributes: [budget], drill: [], query: 'avera', queryKind: 'word', expanded: false });
    expect(flatItems(fn).map((i) => (i.kind === 'function' ? i.decl.name : i.kind))).toEqual(['avg', 'mean']);
    const drilled = helperGroups({
      attributes: [name],
      drill: [{ hop: hop(budget), title: 'Company', entityDefinitionId: 'x' }],
      query: '',
      queryKind: 'search',
      expanded: false,
    });
    const items = flatItems(drilled);
    expect(items[0]?.kind).toBe('back');
    expect(items[1]).toMatchObject({ kind: 'attribute', breadcrumb: ['Company', 'Name'] });
    expect(drilled.map((g) => g.id)).toEqual(['attributes']);
  });

  it('referenceable attributes skip archived, hidden, list entries and the formula itself', () => {
    const archived = attr('text', { isArchived: true });
    const hidden = attr('text', { isHidden: true });
    const entries = attr('entity-reference', { systemAttributeType: 'list-entries' });
    expect(referenceableAttributes([budget, archived, hidden, entries, headcount], headcount.id)).toEqual([budget]);
    const avg = flatItems(helperGroups({ attributes: [], drill: [], query: '', queryKind: 'search', expanded: false }))
      .filter((i) => i.kind === 'function')
      .find((i) => i.kind === 'function' && i.decl.name === 'avg');
    expect(avg && avg.kind === 'function' && functionMatchesQuery(avg.decl, 'mean')).toBe(true);
  });
});

describe('drafts, output labels, preview text', () => {
  const snapshot: Pick<FormulaSnapshot, 'plaintext' | 'annotations' | 'outputTypeOverride'> = {
    plaintext: stored.plaintext,
    annotations: stored.annotations,
    outputTypeOverride: null,
  };

  it('turns an active snapshot into a draft and a draft into formulaConfiguration', () => {
    const draft = formulaDraftOf({ type: 'number' }, snapshot);
    expect(draft.outputType).toBe('number');
    expect(draft.outputTypeOverride).toBeNull();
    const input = formulaConfigurationInput(draft, 'snap-1');
    expect(input).toMatchObject({ snapshotId: 'snap-1', plaintext: '_ / _', outputTypeOverride: null });
    expect(input.annotations?.every((a) => a.length === 1)).toBe(true);
    expect(sameDraft(draft, formulaDraftOf({ type: 'number' }, snapshot))).toBe(true);
    expect(sameDraft(draft, { ...draft, outputTypeOverride: 'text' })).toBe(false);
    expect(
      formulaDraftOf({ type: 'text' }, { ...snapshot, outputTypeOverride: 'bogus' }).outputTypeOverride,
    ).toBeNull();
  });

  it('labels output types', () => {
    expect(outputButtonLabel(null)).toBe('Output: Auto');
    expect(outputButtonLabel('phone-number')).toBe('Output: Phone number');
    expect(outputLabel('actor-reference')).toBe('User');
    expect(outputLabel('weird')).toBe('Text');
  });

  it('preview text: value, no value, syntax / evaluation errors, failure, truncation', () => {
    const at = '2026-10-15T00:00:00Z';
    expect(
      previewDisplay({ type: 'complete', value: 12500, outputType: 'number', display: '12500', accurateAt: at }, false),
    ).toEqual({ text: '12500', muted: false });
    expect(
      previewDisplay({ type: 'complete', value: null, outputType: 'number', display: null, accurateAt: at }, false)
        ?.text,
    ).toBe('No value');
    expect(previewDisplay({ type: 'syntax_error', diagnostics: [], accurateAt: at }, false)?.text).toBe(
      "Can't preview: syntax error",
    );
    expect(
      previewDisplay({ type: 'evaluation_error', code: 'division-by-zero', message: '', accurateAt: at }, false)?.text,
    ).toBe("Can't preview: division-by-zero");
    expect(previewDisplay(undefined, true)?.text).toBe('Preview failed');
    expect(previewDisplay(undefined, false)).toBeNull();
    const long = previewDisplay(
      { type: 'complete', value: 'x'.repeat(600), outputType: 'text', display: null, accurateAt: at },
      false,
    );
    expect(long?.text).toHaveLength(501);
    expect(
      previewDisplay(
        { type: 'complete', value: { a: 1 }, outputType: 'location', display: null, accurateAt: at },
        false,
      )?.text,
    ).toBe('{"a":1}');
  });
});
