import { defaultGrouping, defaultReportSettings, type Report } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { type DraftState, draftFromReport, emptyDraft, isDirty, reduceDraft, toServerDraft } from './draft';

const hop = { entityDefinitionId: 'e1', attributeDefinitionId: 'a-phase' };
const dateHop = { entityDefinitionId: 'e1', attributeDefinitionId: 'a-start' };
const types: Record<string, { type: 'pipeline' | 'date' | 'text'; isMultiselect: boolean }> = {
  'a-phase': { type: 'pipeline', isMultiselect: false },
  'a-start': { type: 'date', isMultiselect: false },
};
const leaf = (path: { attributeDefinitionId: string }[]) => types[path[path.length - 1]?.attributeDefinitionId ?? ''];
const run = (state: DraftState, ...actions: Parameters<typeof reduceDraft>[1][]) =>
  actions.reduce((s, a) => reduceDraft(s, a, leaf), state);

describe('reduceDraft', () => {
  it('starts with the type picker and the default title', () => {
    const d = emptyDraft();
    expect(d.reportType).toBeNull();
    expect(d.title).toBe('New report');
    expect(toServerDraft(d)).toBeNull();
  });

  it('choosing a type applies its defaults and a single metric for a new insight', () => {
    const d = run(emptyDraft(), { type: 'choose-type', reportType: 'insights' });
    expect(d.settings).toEqual(defaultReportSettings('insights'));
    expect(d.visualisationType).toBe('single_metric');
    const funnel = run(emptyDraft(), { type: 'choose-type', reportType: 'funnel' });
    expect(funnel.visualisationType).toBe('funnel');
  });

  it('a grouping switches the single metric to a bar; removing it switches back', () => {
    let d = run(
      emptyDraft(),
      { type: 'choose-type', reportType: 'insights' },
      { type: 'source', entityDefinitionId: 'e1' },
    );
    d = run(d, { type: 'settings', patch: { primaryGrouping: defaultGrouping([hop], 'pipeline_stage_id') } });
    expect(d.visualisationType).toBe('bar');
    d = run(d, { type: 'settings', patch: { primaryGrouping: null, secondaryGrouping: null } });
    expect(d.visualisationType).toBe('single_metric');
  });

  it('keeps a chosen line while it stays valid and falls back to bar otherwise', () => {
    let d = run(
      emptyDraft(),
      { type: 'choose-type', reportType: 'insights' },
      { type: 'source', entityDefinitionId: 'e1' },
      { type: 'settings', patch: { primaryGrouping: defaultGrouping([dateHop], 'value') } },
      { type: 'visualisation', value: 'line' },
    );
    expect(d.visualisationType).toBe('line');
    d = run(d, { type: 'settings', patch: { secondaryGrouping: defaultGrouping([hop], 'pipeline_stage_id') } });
    expect(d.visualisationType).toBe('line');
    // Pie is invalid with a segment.
    d = run(d, { type: 'visualisation', value: 'pie' });
    d = run(d, { type: 'settings', patch: { primaryGrouping: defaultGrouping([hop], 'pipeline_stage_id') } });
    expect(['bar', 'line', 'pie']).toContain(d.visualisationType);
  });

  it('changing the data source clears the filter and the settings but keeps title and type', () => {
    let d = run(
      emptyDraft(),
      { type: 'title', value: 'Mine' },
      { type: 'choose-type', reportType: 'insights' },
      { type: 'source', entityDefinitionId: 'e1' },
      { type: 'filter', filter: { path: [hop], mode: 'must', constraints: [] } },
      { type: 'settings', patch: { primaryGrouping: defaultGrouping([hop], 'pipeline_stage_id') } },
    );
    d = run(d, { type: 'source', entityDefinitionId: 'e2' });
    expect(d.filter).toBeNull();
    expect(d.settings).toEqual(defaultReportSettings('insights'));
    expect(d.title).toBe('Mine');
    expect(d.reportType).toBe('insights');
    // The same source again changes nothing.
    expect(run(d, { type: 'source', entityDefinitionId: 'e2' })).toBe(d);
  });

  it('switching the type resets the settings and keeps the source and the filter', () => {
    const filter = { path: [hop], mode: 'must' as const, constraints: [] };
    let d = run(
      emptyDraft(),
      { type: 'choose-type', reportType: 'insights' },
      { type: 'source', entityDefinitionId: 'e1' },
      { type: 'filter', filter },
    );
    d = run(d, { type: 'choose-type', reportType: 'historical' });
    expect(d.entityDefinitionId).toBe('e1');
    expect(d.filter).toEqual(filter);
    expect(d.settings).toEqual(defaultReportSettings('historical'));
  });
});

describe('isDirty', () => {
  const report = {
    id: 'r1',
    title: 'Saved',
    description: null,
    entityDefinitionId: 'e1',
    filter: null,
    reportType: 'insights',
    visualisationType: 'single_metric',
    settings: defaultReportSettings('insights'),
  } as unknown as Report;

  it('compares with the saved report, ignoring surrounding whitespace in text', () => {
    const d = draftFromReport(report);
    expect(isDirty(d, report)).toBe(false);
    expect(isDirty({ ...d, title: '  Saved ' }, report)).toBe(false);
    expect(isDirty({ ...d, title: 'Other' }, report)).toBe(true);
    expect(isDirty({ ...d, settings: { ...defaultReportSettings('insights'), targetValue: 5 } }, report)).toBe(true);
  });

  it('a new report is dirty once anything differs from the empty draft', () => {
    expect(isDirty(emptyDraft(), null)).toBe(false);
    expect(isDirty({ ...emptyDraft(), entityDefinitionId: 'e1' }, null)).toBe(true);
  });
});
