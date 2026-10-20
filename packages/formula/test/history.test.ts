import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/index.ts';
import { NOW, RECORD, run } from './helpers.ts';

const DAY = 86_400_000;
const t0 = Date.UTC(2024, 5, 1); // 2024-06-01
const lead = { id: 'stage-Lead', title: 'Lead' };
const won = { id: 'stage-Won', title: 'Won' };

// Lead (10 days) → Won (5 days) → Lead (3 days) → Won (until now = 2024-07-01T12:00Z)
const stageHistory: HistoryEntry[] = [
  { value: lead, activeFrom: t0, activeUntil: t0 + 10 * DAY },
  { value: won, activeFrom: t0 + 10 * DAY, activeUntil: t0 + 15 * DAY },
  { value: lead, activeFrom: t0 + 15 * DAY, activeUntil: t0 + 18 * DAY },
  { value: won, activeFrom: t0 + 18 * DAY, activeUntil: null },
];

const vip = { id: 'opt-VIP', title: 'VIP' };
const eu = { id: 'opt-EU', title: 'EU' };
const tagHistory: HistoryEntry[] = [
  { value: vip, activeFrom: t0, activeUntil: null },
  { value: eu, activeFrom: t0 + 2 * DAY, activeUntil: null },
];

const history = { 'd-stage': stageHistory, 'd-tags': tagHistory };
const iso = (ms: number) => new Date(ms).toISOString();

describe('history functions', () => {
  it.each([
    ['hasBeenIn(_{d-stage}, _{stage-won})', 'true'],
    ['hasBeenIn(_{d-stage}, _{stage-lost})', 'false'],
    ['hasBeenIn(_{d-stage}, [_{stage-lost}, _{stage-won}])', 'true'],
    ['hasBeenIn(_{d-tags}, _{opt-vip})', 'true'],
    ['valueSetAt(_{d-stage}, _{stage-won})', iso(t0 + 10 * DAY)],
    ['valueSetAt(_{d-stage}, _{stage-won}, "first")', iso(t0 + 10 * DAY)],
    ['valueSetAt(_{d-stage}, _{stage-won}, "last")', iso(t0 + 18 * DAY)],
    ['valueSetAt(_{d-stage}, _{stage-lost})', null],
    ['timeSpentIn(_{d-stage}, _{stage-lead}, "days")', '13'],
    ['timeSpentIn(_{d-stage}, _{stage-won}, "hours")', `${5 * 24 + Math.floor((NOW - (t0 + 18 * DAY)) / 3_600_000)}`],
    ['timeSpentIn(_{d-stage}, _{stage-won}, "weeks")', '2'],
    ['timeSpentIn(_{d-stage}, _{stage-won}, "months")', '0'],
    ['valueAt(_{d-stage}, timestamp("2024-06-05T00:00:00Z"))', 'Lead'],
    ['valueAt(_{d-stage}, timestamp("2024-06-12T00:00:00Z"))', 'Won'],
    ['valueAt(_{d-stage}, timestamp("2024-01-01T00:00:00Z"))', null],
    ['text(valueAt(_{d-tags}, timestamp("2024-06-02T00:00:00Z")))', 'VIP'],
    ['text(valueAt(_{d-tags}, now()))', 'VIP, EU'],
    ['previousValue(_{d-stage})', 'Lead'],
    ['text(previousValue(_{d-tags}))', 'VIP'],
    ['previousValue(_{d-name})', null],
  ])('%s → %s', (formula, expected) => {
    expect(run(formula, RECORD, history)).toBe(expected);
  });
});
