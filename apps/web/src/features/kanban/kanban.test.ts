import type { AttributeDefinition, PipelineStage, View } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { BURST_SECONDS, particleAlpha, spawnBurst, stepParticles } from './confetti';
import { patchedView, readKanbanConfig, updatePatch } from './config';
import { toColumnPages } from './data';
import {
  adjacentColumn,
  applyMoves,
  boardStages,
  daysInStage,
  dropSettled,
  eligibleForCalculation,
  formatTargetTime,
  isOverTarget,
  NO_STAGE,
  type PendingMove,
  parseTargetTime,
  reorderTarget,
  visibleColumns,
} from './model';

const stage = (id: string, sortOrder: string, extra: Partial<PipelineStage> = {}): PipelineStage => ({
  id,
  workspaceId: 'w',
  entityDefinitionId: 'd',
  attributeDefinitionId: 'a',
  title: id.toUpperCase(),
  color: 'block_blue',
  sortOrder,
  isArchived: false,
  createdAt: '2026-01-01T00:00:00Z',
  lifecyclePhase: 'ACTIVE',
  targetTimeInStatus: null,
  celebrationEnabled: false,
  ...extra,
});

describe('stages and columns', () => {
  it('orders live stages by rank and drops archived ones (X-08)', () => {
    const stages = boardStages([stage('b', 'm'), stage('a', 'c'), stage('x', 'a', { isArchived: true })]);
    expect(stages.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('puts "No stage" first when visible and skips hidden stages', () => {
    const stages = boardStages([stage('a', 'a'), stage('b', 'b'), stage('c', 'c')]);
    expect(visibleColumns(stages, { noStatusVisible: true, hiddenStageIds: ['b'] }).map((s) => s.key)).toEqual([
      NO_STAGE,
      'a',
      'c',
    ]);
    expect(visibleColumns(stages, { noStatusVisible: false, hiddenStageIds: [] }).map((s) => s.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('optimistic moves', () => {
  const server = {
    lead: { ids: ['1', '2'], total: 2 },
    won: { ids: ['3'], total: 1 },
  };
  const move = (
    seq: number,
    cardId: string,
    from: string,
    to: string,
    settledAt: number | null = null,
  ): PendingMove => ({
    seq,
    cardId,
    from,
    to,
    settledAt,
  });

  it('removes the card from its column and prepends it to the destination', () => {
    const out = applyMoves(server, [move(1, '2', 'lead', 'won')]);
    expect(out.lead).toEqual({ ids: ['1'], total: 1 });
    expect(out.won).toEqual({ ids: ['2', '3'], total: 2 });
  });

  it('is idempotent once the server already reflects the move (no double counting)', () => {
    const refetched = { lead: { ids: ['1'], total: 1 }, won: { ids: ['3', '2'], total: 2 } };
    const out = applyMoves(refetched, [move(1, '2', 'lead', 'won')]);
    expect(out.won).toEqual({ ids: ['2', '3'], total: 2 });
    expect(out.lead).toEqual({ ids: ['1'], total: 1 });
  });

  it('applies chained moves in order', () => {
    const out = applyMoves(server, [move(2, '1', 'won', 'lead'), move(1, '1', 'lead', 'won')]);
    expect(out.lead?.ids).toEqual(['1', '2']);
    expect(out.won?.ids).toEqual(['3']);
  });

  it('drops settled moves once the columns were fetched after them', () => {
    const moves = [move(1, '1', 'lead', 'won', 100), move(2, '2', 'lead', 'won', null)];
    expect(dropSettled(moves, 50)).toBe(moves);
    expect(dropSettled(moves, 150).map((m) => m.seq)).toEqual([2]);
  });
});

describe('target time and time in stage', () => {
  it('writes fully expanded ISO-8601 durations (K3)', () => {
    expect(formatTargetTime({ value: 7, unit: 'days' })).toBe('P0Y0M7DT0H0M0S');
    expect(formatTargetTime({ value: 3, unit: 'months' })).toBe('P0Y3M0DT0H0M0S');
    expect(formatTargetTime({ value: 1, unit: 'years' })).toBe('P1Y0M0DT0H0M0S');
    expect(formatTargetTime({ value: 0, unit: 'days' })).toBe('P0Y0M0DT0H0M0S');
  });

  it('reads durations back into a value and unit', () => {
    expect(parseTargetTime('P0Y0M7DT0H0M0S')).toEqual({ value: 7, unit: 'days' });
    expect(parseTargetTime('P0Y3M0DT0H0M0S')).toEqual({ value: 3, unit: 'months' });
    expect(parseTargetTime('P2Y0M0DT0H0M0S')).toEqual({ value: 2, unit: 'years' });
    expect(parseTargetTime('P14D')).toEqual({ value: 14, unit: 'days' });
    expect(parseTargetTime(null)).toBeNull();
  });

  it('counts whole days in the stage and flags cards over the target', () => {
    const now = new Date('2026-10-13T12:00:00Z');
    expect(daysInStage('2026-10-13T08:00:00Z', now)).toBe(0);
    expect(daysInStage('2026-10-10T11:00:00Z', now)).toBe(3);
    expect(isOverTarget('2026-10-01T00:00:00Z', 'P0Y0M7DT0H0M0S', now)).toBe(true);
    expect(isOverTarget('2026-10-10T00:00:00Z', 'P0Y0M7DT0H0M0S', now)).toBe(false);
    expect(isOverTarget('2026-10-01T00:00:00Z', null, now)).toBe(false);
  });
});

describe('calculations', () => {
  const attr = (type: AttributeDefinition['type']) =>
    ({ type, isArchived: false, isHidden: false }) as AttributeDefinition;
  it('offers sums only on numeric attributes and counts on every readable one', () => {
    expect(eligibleForCalculation(attr('currency'), 'sum')).toBe(true);
    expect(eligibleForCalculation(attr('text'), 'sum')).toBe(false);
    expect(eligibleForCalculation(attr('text'), 'count_empty')).toBe(true);
    expect(eligibleForCalculation(attr('interaction'), 'count_empty')).toBe(false);
  });
});

describe('keyboard and column reorder', () => {
  it('moves between adjacent columns with the arrow keys', () => {
    const order = [NO_STAGE, 'a', 'b'];
    expect(adjacentColumn(order, 'a', 'ArrowRight')).toBe('b');
    expect(adjacentColumn(order, 'a', 'ArrowLeft')).toBe(NO_STAGE);
    expect(adjacentColumn(order, 'b', 'ArrowRight')).toBeNull();
    expect(adjacentColumn(order, 'a', 'ArrowDown')).toBeNull();
  });

  it('lands after the column when moving right and before it when moving left', () => {
    const order = [NO_STAGE, 'a', 'b', 'c'];
    expect(reorderTarget(order, 'a', 'c')).toEqual({ before: 'c', after: null });
    expect(reorderTarget(order, 'c', 'a')).toEqual({ before: null, after: 'a' });
    expect(reorderTarget(order, 'a', 'b')).toEqual({ before: 'b', after: 'c' });
    expect(reorderTarget(order, 'a', NO_STAGE)).toBeNull();
  });
});

describe('view config', () => {
  const view = (extra: Record<string, unknown> = {}) =>
    ({
      id: 'v',
      columns: [],
      kanbanPivotPath: [{ entityDefinitionId: 'd', attributeDefinitionId: 'a' }],
      kanbanIsNoStatusVisible: null,
      kanbanIsTimeInStatusVisible: null,
      kanban: null,
      ...extra,
    }) as unknown as View;

  it('defaults to labels off, "No stage" and the time chip visible, nothing hidden, no calculation (K1)', () => {
    expect(readKanbanConfig(view())).toMatchObject({
      noStatusVisible: true,
      hiddenStageIds: [],
      showLabels: false,
      showTimeInStage: true,
      calculation: null,
    });
  });

  it('reads the server `view.kanban` settings, including showTimeInStage', () => {
    const path = [{ entityDefinitionId: 'd', attributeDefinitionId: 'b' }];
    const v = view({
      kanban: {
        groupBy: path,
        hiddenStageIds: ['x'],
        cardAttributePaths: [],
        showLabels: true,
        showNoStage: false,
        showTimeInStage: false,
        calculation: { path, field: null, aggregation: 'count_not_empty' },
      },
    });
    expect(readKanbanConfig(v)).toEqual({
      groupBy: path,
      hiddenStageIds: ['x'],
      showLabels: true,
      noStatusVisible: false,
      showTimeInStage: false,
      calculation: { path, field: null, kind: 'count_not_empty' },
    });
  });

  it('writes `views.update({kanban})` and patches the cached view optimistically', () => {
    const path = [{ entityDefinitionId: 'd', attributeDefinitionId: 'b' }];
    expect(
      updatePatch({ showLabels: true, noStatusVisible: false, calculation: { path, field: null, kind: 'sum' } }),
    ).toEqual({
      kanban: { showLabels: true, showNoStage: false, calculation: { path, field: null, aggregation: 'sum' } },
    });
    expect(updatePatch({ groupBy: path, hiddenStageIds: ['s', 's'] })).toEqual({
      kanban: { groupBy: path, hiddenStageIds: ['s'] },
    });
    const patched = patchedView(view(), { groupBy: path, hiddenStageIds: ['s'] });
    expect(patched.kanbanPivotPath).toEqual(path);
    expect(readKanbanConfig(patched)).toMatchObject({ groupBy: path, hiddenStageIds: ['s'], showTimeInStage: true });
  });
});

describe('board columns', () => {
  it('maps kanban.columns to pages per visible column ("No stage" = null stage); missing columns are empty', () => {
    const pages = toColumnPages(
      {
        columns: [
          { stageId: null, snapshotId: 'n', total: 0, firstIds: [], aggregate: null },
          { stageId: 's1', snapshotId: 'p', total: 2, firstIds: ['a', 'b'], aggregate: null },
        ],
      },
      [NO_STAGE, 's1', 's2'],
    );
    expect(pages[NO_STAGE]).toMatchObject({ total: 0, snapshotId: 'n' });
    expect(pages.s1).toMatchObject({ ids: ['a', 'b'], total: 2, snapshotId: 'p' });
    expect(pages.s2).toEqual({ key: 's2', snapshotId: null, total: 0, ids: [], aggregate: null });
  });
});

describe('confetti', () => {
  it('falls from above the viewport and fades out within the burst', () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let particles = spawnBurst(800, 600, 50, random);
    expect(particles.every((p) => p.y < 0)).toBe(true);
    for (let t = 0; t < 2; t += 0.05) particles = stepParticles(particles, 0.05, 600);
    expect(particles.length).toBeGreaterThan(0);
    for (let t = 2; t < BURST_SECONDS + 0.1; t += 0.05) particles = stepParticles(particles, 0.05, 600);
    expect(particles).toEqual([]);
    expect(particleAlpha({ ...spawnBurst(10, 10, 1, random)[0]!, age: BURST_SECONDS - 0.1 })).toBeLessThan(1);
  });
});
