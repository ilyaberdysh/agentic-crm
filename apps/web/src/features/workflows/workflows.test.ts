// Workflows client model: index buckets / grouping / sorting, config and rich-text helpers, the variable
// picker levels with isAssignable greying and chip labels, palette groups, card geometry, run overlays.
import { cfg, T, type VariableExpr } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { CATALOG } from './data';
import { cardHeight, handleY, loosePosition, nextPosition } from './editor/canvas/geometry';
import { blockLook, paletteGroups, workflowHue } from './model/blocks';
import {
  defaultExpr,
  isEmptyExpr,
  isVisible,
  richTextSegments,
  segmentsToRichText,
  soleVariable,
  withEntry,
} from './model/config';
import { dateBucket, filterWorkflows, groupWorkflows, publishedAt, sortWorkflows } from './model/list';
import { blockRows, chipLabel, levelItems, type PickerData, typeOfOperations } from './model/variables';
import { attemptsOf, failedExecution, overlayFor, runtimeLabel } from './runs/model';
import type { Workflow } from './types';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');

function wf(over: Partial<Workflow>): Workflow {
  return {
    id: 'w',
    workspaceId: 'ws',
    title: null,
    displayTitle: 'Untitled Workflow',
    description: null,
    aiTitle: null,
    aiDescription: null,
    status: 'draft',
    isTransient: false,
    isArchived: false,
    draftVersionId: 'd',
    activeVersionId: null,
    latestPublishedVersionId: null,
    firstSetLiveAt: null,
    lastPublishedAt: null,
    lastStatusChangeAt: null,
    lastRunFailedAt: null,
    timezone: null,
    maxCreditsPerRun: 50,
    dismissedCycleWarning: false,
    runCount: 0,
    isFavorite: false,
    triggerSlugs: [],
    hasUnpublishedChanges: false,
    access: { level: 'full-access', flags: {} },
    failureNotifications: true,
    createdBy: { type: 'workspace-member', id: 'm1' },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

describe('index model', () => {
  it('buckets dates like the "Last published" grouping', () => {
    expect(dateBucket('2026-10-14T08:00:00.000Z', NOW, 'UTC')).toBe('today');
    expect(dateBucket('2026-10-13T08:00:00.000Z', NOW, 'UTC')).toBe('yesterday');
    expect(dateBucket('2026-10-09T08:00:00.000Z', NOW, 'UTC')).toBe('last-7-days');
    expect(dateBucket('2026-10-02T08:00:00.000Z', NOW, 'UTC')).toBe('this-month');
    expect(dateBucket('2026-03-02T08:00:00.000Z', NOW, 'UTC')).toBe('this-year');
    expect(dateBucket('2025-03-02T08:00:00.000Z', NOW, 'UTC')).toBe('last-year');
    expect(dateBucket('2023-03-02T08:00:00.000Z', NOW, 'UTC')).toBe('older');
    expect(dateBucket(null, NOW, 'UTC')).toBe('never');
  });

  it('paused workflows have no "Last published" and fall into Unpublished', () => {
    const live = wf({ id: 'a', status: 'live', lastPublishedAt: '2026-10-14T08:00:00.000Z' });
    const paused = wf({ id: 'b', status: 'paused', lastPublishedAt: '2026-10-14T08:00:00.000Z' });
    expect(publishedAt(paused)).toBeNull();
    const groups = groupWorkflows([live, paused], 'last-published', { now: NOW, timeZone: 'UTC' });
    expect(groups.map((g) => [g.label, g.workflows.map((w) => w.id)])).toEqual([
      ['Today', ['a']],
      ['Unpublished', ['b']],
    ]);
  });

  it('sorts with empty values last and filters by creator, title and archive', () => {
    const a = wf({ id: 'a', displayTitle: 'Beta', runCount: 3 });
    const b = wf({ id: 'b', displayTitle: 'alpha', runCount: 1, isArchived: true });
    const c = wf({
      id: 'c',
      displayTitle: 'Gamma',
      lastRunFailedAt: '2026-10-10T00:00:00.000Z',
      createdBy: { type: 'workspace-member', id: 'm2' },
    });
    expect(sortWorkflows([a, b, c], 'name', 'asc').map((w) => w.id)).toEqual(['b', 'a', 'c']);
    expect(sortWorkflows([a, b, c], 'runs', 'desc').map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(sortWorkflows([a, c], 'last-failed-run', 'asc').map((w) => w.id)).toEqual(['c', 'a']);
    expect(filterWorkflows([a, b, c], { showArchived: false, createdBy: [] }, '').map((w) => w.id)).toEqual(['a', 'c']);
    expect(filterWorkflows([a, b, c], { showArchived: true, createdBy: ['m2'] }, '').map((w) => w.id)).toEqual(['c']);
    expect(filterWorkflows([a, b, c], { showArchived: true, createdBy: [] }, 'ALP').map((w) => w.id)).toEqual(['b']);
  });

  it('groups by status in Live, Paused, Draft, Archived order', () => {
    const groups = groupWorkflows(
      [
        wf({ id: 'd' }),
        wf({ id: 'x', isArchived: true }),
        wf({ id: 'l', status: 'live' }),
        wf({ id: 'p', status: 'paused' }),
      ],
      'status',
    );
    expect(groups.map((g) => g.label)).toEqual(['Live', 'Paused', 'Draft', 'Archived']);
  });
});

describe('config helpers', () => {
  it('rich text ⇄ segments with one "_" placeholder per variable', () => {
    const v = cfg.variable('01a13c00-0000-7000-8000-000000000001', 'done', [{ type: 'field', name: 'result' }]);
    const rich = segmentsToRichText(['Total ', v, ' items\nnext']);
    expect(rich.blocks).toEqual([
      { plaintext: 'Total _ items', variables: [{ start: 6, variable: v }] },
      { plaintext: 'next', variables: [] },
    ]);
    expect(richTextSegments(rich)).toEqual(['Total ', v, ' items\nnext']);
    expect(soleVariable(segmentsToRichText([v]))).toEqual(v);
    expect(soleVariable(rich)).toBeNull();
  });

  it('empty checks match the server and defaults come from the catalogue', () => {
    expect(isEmptyExpr({ type: 'rich-text', blocks: [{ plaintext: '  ', variables: [] }] })).toBe(true);
    expect(isEmptyExpr({ type: 'array', items: [] })).toBe(true);
    expect(isEmptyExpr({ type: 'number', value: 0 })).toBe(false);
    const delay = CATALOG.steps.find((s) => s.slug === 'delay')?.inputs[0];
    expect(delay && defaultExpr(delay)).toEqual({
      type: 'duration',
      value: { type: 'number', value: 60 },
      unit: 'seconds',
    });
  });

  it('visibleWhen follows the sibling value or its default', () => {
    const http = CATALOG.steps.find((s) => s.slug === 'send-http-request');
    if (!http) throw new Error('no http block');
    const body = http.inputs.find((i) => i.key === 'body');
    if (!body) throw new Error('no body input');
    const empty = { type: 'object' as const, entries: {} };
    expect(isVisible(body, empty, http.inputs)).toBe(false);
    expect(isVisible(body, withEntry(empty, 'method', { type: 'string', value: 'POST' }), http.inputs)).toBe(true);
  });
});

const T1 = '01a13c00-0000-7000-8000-0000000000aa';
const F1 = '01a13c00-0000-7000-8000-0000000000bb';
const IF1 = '01a13c00-0000-7000-8000-0000000000cc';
const OBJ = '01a13c00-0000-7000-8000-0000000000dd';
const HEAD = '01a13c00-0000-7000-8000-0000000000ee';
const OWNER = '01a13c00-0000-7000-8000-0000000000ff';

const picker: PickerData = {
  blocks: [
    {
      blockId: IF1,
      slug: 'branch',
      title: 'If',
      distance: 1,
      outcomes: [{ slug: 'true', label: 'True', outputs: null }],
    },
    {
      blockId: F1,
      slug: 'formula',
      title: 'Formula',
      distance: 2,
      outcomes: [{ slug: 'done', label: 'Next step', outputs: [{ key: 'result', label: 'Result', type: T.number }] }],
    },
    {
      blockId: T1,
      slug: 'on-record-action',
      title: 'Record action',
      distance: 3,
      outcomes: [
        {
          slug: 'done',
          label: 'Next step',
          outputs: [
            { key: 'entity_instance', label: 'Record', type: T.record(OBJ) },
            { key: 'actor', label: 'Triggered by', type: T.actor },
            { key: 'at', label: 'Triggered at', type: T.timestamp },
          ],
        },
      ],
    },
  ],
  definitions: [
    {
      id: OBJ,
      kind: 'object',
      title: '[seed] Project',
      attributes: [
        {
          id: HEAD,
          apiSlug: 'headcount',
          title: 'Headcount',
          attributeType: 'number',
          isMultiselect: false,
          type: T.number,
        },
        {
          id: OWNER,
          apiSlug: 'owner',
          title: 'Owner',
          attributeType: 'actor-reference',
          isMultiselect: false,
          type: T.actor,
        },
      ],
    },
  ],
};

describe('variable picker', () => {
  it('lists accessible blocks nearest first; outcomes without outputs are "no data"', () => {
    const rows = blockRows(picker);
    expect(rows.map((r) => [r.title, r.outcomeLabel, r.noData, r.outputCount])).toEqual([
      ['If', 'True', true, 0],
      ['Formula', null, false, 1],
      ['Record action', null, false, 3],
    ]);
  });

  it('labels a record output with the object noun and greys incompatible leaves', () => {
    const outputs = levelItems(picker, { level: 'outputs', blockId: T1, outcome: 'done' }, T.number);
    expect(outputs.items.map((i) => [i.label, i.state, i.childCount])).toEqual([
      ['[seed] Project', 'warning', 2],
      ['Triggered by', 'warning', 4],
      ['Triggered at', 'disabled', 0],
    ]);
  });

  it('drills into a record: the record row, attributes, actor sub-fields; types follow the operations', () => {
    const level = levelItems(
      picker,
      { level: 'value', blockId: T1, outcome: 'done', operations: [{ type: 'field', name: 'entity_instance' }] },
      T.string,
    );
    expect(level.self?.label).toBe('[seed] Project');
    expect(level.items.map((i) => [i.label, i.state])).toEqual([
      ['Headcount', 'ok'],
      ['Owner', 'warning'],
    ]);
    expect(
      typeOfOperations(picker, T1, 'done', [
        { type: 'field', name: 'entity_instance' },
        { type: 'attribute', entityDefinitionId: OBJ, attributeDefinitionId: OWNER },
        { type: 'property', name: 'name' },
      ]),
    ).toEqual(T.string);
  });

  it('chip labels collapse middle segments and flag deleted sources', () => {
    const v: VariableExpr = cfg.variable(T1, 'done', [
      { type: 'field', name: 'entity_instance' },
      { type: 'attribute', entityDefinitionId: OBJ, attributeDefinitionId: HEAD },
    ]);
    expect(chipLabel(picker, v, () => null)).toEqual({
      segments: ['Record action', '[seed] Project', 'Headcount'],
      shown: ['Record action', '⋯', 'Headcount'],
      broken: false,
    });
    const gone = cfg.variable('01a13c00-0000-7000-8000-000000000999', 'done', [{ type: 'field', name: 'x' }]);
    expect(chipLabel(picker, gone, () => null).broken).toBe(true);
  });
});

describe('palette, look and geometry', () => {
  it('groups by category in catalogue order, triggers first; hides flag-gated blocks', () => {
    const all = paletteGroups(CATALOG, 'all');
    expect(all[0]?.label).toBe('Agents');
    const records = all.find((g) => g.category === 'records');
    expect(records?.blocks.slice(0, 3).map((b) => b.blockType)).toEqual(['trigger', 'trigger', 'trigger']);
    expect(all.flatMap((g) => g.blocks).some((b) => b.slug === 'internal-noop')).toBe(false);
    expect(paletteGroups(CATALOG, 'triggers').every((g) => g.blocks.every((b) => b.blockType === 'trigger'))).toBe(
      true,
    );
    expect(paletteGroups(CATALOG, 'steps', 'if').flatMap((g) => g.blocks.map((b) => b.slug))).toContain('branch');
  });

  it('block look and workflow hue are stable', () => {
    expect(blockLook('branch')).toMatchObject({ title: 'If', categoryLabel: 'Conditions' });
    expect(workflowHue('abc')).toBe(workflowHue('abc'));
  });

  it('cards grow with outcome rows; next blocks go one column right, past occupied slots', () => {
    const ifBlock = { outcomes: [{ slug: 'true' }, { slug: 'false' }], position: { x: 0, y: 0 } } as never;
    expect(cardHeight(ifBlock)).toBe(116);
    expect(handleY(ifBlock, 'false')).toBe(100);
    expect(nextPosition(ifBlock, 'false', [])).toEqual({ x: 270, y: 150 });
    expect(nextPosition(ifBlock, 'true', [{ position: { x: 270, y: 0 } }] as never)).toEqual({ x: 270, y: 150 });
    expect(loosePosition([{ position: { x: 10, y: 20 }, createdAt: 'a' }] as never)).toEqual({ x: 80, y: 90 });
  });
});

describe('run overlay', () => {
  const exec = (
    id: string,
    blockId: string,
    attempt: number,
    status: string,
    outcome: string | null,
    parent: string | null,
  ) =>
    ({
      id,
      blockId,
      attempt,
      status,
      outcome,
      parentExecutionId: parent,
      createdAt: `2026-10-14T00:00:0${id.length}.000Z`,
      startedAt: '2026-10-14T00:00:00.000Z',
      completedAt: status === 'completed' ? '2026-10-14T00:00:00.400Z' : null,
      failedAt: status === 'failed' ? '2026-10-14T00:00:03.000Z' : null,
    }) as never;

  it('combines attempts up to the shown one; taken paths come from parent executions', () => {
    const detail = {
      frames: [
        { attempt: 1, type: 'root' },
        { attempt: 2, type: 'retry' },
      ],
      executions: [
        exec('e1', 'T', 1, 'completed', 'done', null),
        exec('e2', 'H', 1, 'failed', null, 'e1'),
        exec('e3', 'H', 2, 'completed', 'done', 'e1'),
      ],
    } as never;
    expect(attemptsOf(detail)).toEqual([1, 2]);
    const first = overlayFor(detail, 1);
    expect(first.statusByBlock.get('H')).toBe('failed');
    const second = overlayFor(detail, 2);
    expect(second.statusByBlock.get('H')).toBe('completed');
    expect([...second.taken]).toEqual(['T:done:H']);
    expect(failedExecution(detail)).toMatchObject({ id: 'e2' });
    expect(runtimeLabel(exec('e1', 'T', 1, 'completed', 'done', null))).toBe('<1s');
    expect(runtimeLabel(exec('e2', 'H', 1, 'failed', null, null))).toBe('3s');
  });
});
