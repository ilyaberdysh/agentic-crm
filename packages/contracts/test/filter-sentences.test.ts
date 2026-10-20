// The filter sentence table (C1 filters-sorts-calcs §3–4, §7–8): every type has sentences, leaves round-trip,
// relative-date values parse back to presets, and the calculation menus match the spec.
import { describe, expect, it } from 'vitest';
import {
  attributeTypes,
  columnAggregationsFor,
  daysAgo,
  daysFromNow,
  filterFieldsByType,
  filterFieldsFor,
  leafToSentence,
  parseRelativeDate,
  predicateSchema,
  relativeDatePresets,
  sentenceLabel,
  sentenceToLeaf,
  sortFieldsByType,
} from '../src/index.ts';

const path = [
  {
    entityDefinitionId: '0199c4a0-0000-7000-8000-000000000001',
    attributeDefinitionId: '0199c4a0-0000-7000-8000-000000000002',
  },
];

describe('filter sentences', () => {
  it('covers all 17 types, and every leaf is a valid predicate that reads back as its sentence', () => {
    for (const type of attributeTypes) {
      const fields = filterFieldsByType[type];
      expect(fields.length, type).toBeGreaterThan(0);
      for (const field of fields) {
        for (const sentence of field.sentences) {
          const leaf = sentenceToLeaf({ path, field, sentence, value: 'x' });
          expect(() => predicateSchema.parse(leaf)).not.toThrow();
          const attribute = { type, systemAttributeType: sentence.onlySystemTypes?.[0] ?? null };
          const back = leafToSentence(attribute, leaf);
          expect(back?.sentence.id, `${type} ${field.field} ${sentence.id}`).toBe(sentence.id);
          expect(back?.field.field).toBe(field.field);
        }
      }
    }
  });

  it('encodes Attio’s special sentences', () => {
    const [rating] = filterFieldsByType.rating;
    const empty = rating?.sentences.find((s) => s.id === 'empty');
    expect(sentenceToLeaf({ path, field: rating as never, sentence: empty as never })).toEqual({
      path,
      mode: 'must-not',
      constraints: [{ field: 'value', operator: 'gt', value: 0, valueType: 'static' }],
    });
    const [status] = filterFieldsByType.pipeline;
    const was = status?.sentences.find((s) => s.id === 'was');
    const leaf = sentenceToLeaf({
      path,
      field: status as never,
      sentence: was as never,
      value: 'stage-id',
      extra: [{ field: 'active_from', operator: 'lt', value: '-P7D', valueType: 'dynamic' }],
    });
    expect(leaf).toMatchObject({
      mode: 'must',
      history: true,
      constraints: [{ field: 'pipeline_stage_id' }, { field: 'active_from' }],
    });
    expect(leafToSentence({ type: 'pipeline' }, leaf)).toMatchObject({ sentence: { id: 'was' }, value: 'stage-id' });
    const [checkbox] = filterFieldsByType.checkbox;
    const isFalse = checkbox?.sentences.find((s) => s.id === 'false');
    expect(sentenceToLeaf({ path, field: checkbox as never, sentence: isFalse as never })).toMatchObject({
      mode: 'must-not',
      constraints: [{ operator: 'eq', value: true }],
    });
    // Attio's stored leaves (field 'value', implicit active_until) read back too.
    expect(
      leafToSentence(
        { type: 'select', isMultiselect: true },
        {
          path,
          mode: 'must',
          constraints: [
            { field: 'value', operator: 'eq', value: 'opt' },
            { field: 'active_until', operator: 'empty', value: 'null' },
          ],
        },
      ),
    ).toMatchObject({ sentence: { id: 'contains' }, value: 'opt' });
    expect(leafToSentence({ type: 'text' }, { path, mode: 'must-not', constraints: [] })?.sentence.id).toBe('empty');
    expect(
      leafToSentence(
        { type: 'text' },
        { path, mode: 'must', constraints: [{ field: 'value', operator: 'gt', value: 1 }] },
      ),
    ).toBeNull();
  });

  it('labels multi-value attributes with contains / does not contain, and restricts system-only sentences', () => {
    const [select] = filterFieldsByType.select;
    const is = select?.sentences.find((s) => s.id === 'contains');
    expect(sentenceLabel(is as never, { type: 'select', isMultiselect: true })).toBe('contains');
    expect(sentenceLabel(is as never, { type: 'select', isMultiselect: false })).toBe('is');
    const ids = (a: Parameters<typeof filterFieldsFor>[0]) =>
      filterFieldsFor(a).flatMap((f) => f.sentences.map((s) => s.id));
    expect(ids({ type: 'select' })).not.toContain('less-than');
    expect(ids({ type: 'select', systemAttributeType: 'employee-range' })).toContain('less-than');
    expect(ids({ type: 'entity-reference', systemAttributeType: 'list-entries' })).toEqual(
      expect.arrayContaining(['is-type', 'is-not-type']),
    );
    expect(ids({ type: 'entity-reference', systemAttributeType: 'list-entries' })).not.toContain('empty');
  });

  it('parses relative dates back to presets and day counts', () => {
    for (const preset of relativeDatePresets) expect(parseRelativeDate(preset.value)).toEqual({ preset: preset.id });
    expect(parseRelativeDate('-P0Y0M30DT0H0M0S')).toEqual({ daysAgo: 30 });
    expect(parseRelativeDate('P0Y0M0DT0H0M0S')).toEqual({ preset: 'today' });
    expect(parseRelativeDate('-P1W')).toEqual({ preset: 'one-week-ago' });
    expect(parseRelativeDate(daysAgo(12))).toEqual({ daysAgo: 12 });
    expect(parseRelativeDate(daysFromNow(3))).toEqual({ daysFromNow: 3 });
    expect(parseRelativeDate('PT5H')).toBeNull();
    expect(parseRelativeDate('2026-01-01')).toBeNull();
  });

  it('lists sort fields and calculations per type as the spec does', () => {
    expect(sortFieldsByType.pipeline.map((f) => f.field)).toEqual(['stage_sort_order', 'active_from']);
    expect(sortFieldsByType['entity-reference']).toEqual([]);
    expect(sortFieldsByType['personal-name'].map((f) => f.field)).toEqual(['first_name', 'last_name', 'full_name']);
    expect(columnAggregationsFor('text').map((o) => o.value)).toEqual([
      'count_empty',
      'count_not_empty',
      'percent_empty',
      'percent_not_empty',
    ]);
    expect(columnAggregationsFor('currency').map((o) => o.suffix)).toEqual([
      'empty',
      'filled',
      'empty',
      'filled',
      'sum',
      'avg',
      'min',
      'max',
    ]);
    expect(columnAggregationsFor('checkbox').map((o) => o.label)).toEqual([
      'Count not checked',
      'Count checked',
      'Percent not checked',
      'Percent checked',
    ]);
  });
});
