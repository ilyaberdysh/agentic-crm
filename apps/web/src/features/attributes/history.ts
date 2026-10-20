// Edit history events from value rows (BACKLOG 2.11): `records.history` returns every value of one
// attribute on one record, current and retired, newest first. Pure; unit-tested.
import type { Actor } from '@agentic-crm/contracts';
import type { AttributeDefinition, AttributeValue } from './types';

export type HistoryKind = 'updated' | 'added' | 'removed' | 'cleared';

export interface HistoryEvent {
  key: string;
  at: string;
  actor: Actor | null;
  kind: HistoryKind;
  /** The value the event is about (absent for "cleared"). */
  value?: AttributeValue;
  /** Values current right after the event (hover card "Resulting value"). */
  resulting: AttributeValue[];
  /** The newest event (timeline ring). */
  isLatest: boolean;
}

const t = (iso: string) => Date.parse(iso);

function activeAt(rows: AttributeValue[], at: number): AttributeValue[] {
  return rows
    .filter((r) => t(r.activeFrom) <= at && (r.activeUntil === null || t(r.activeUntil) > at))
    .sort((a, b) => ((a.sortOrder ?? '') < (b.sortOrder ?? '') ? -1 : 1));
}

/**
 * Single-value attributes: each value is an "Updated" event; a retire not followed by a new value at the same
 * instant is "Cleared". Multi-value attributes: "Added" per value, "Removed" per retire.
 */
export function buildHistory(
  attribute: Pick<AttributeDefinition, 'isMultiselect'>,
  rows: AttributeValue[],
): HistoryEvent[] {
  const events: Omit<HistoryEvent, 'isLatest'>[] = [];
  const starts = new Set(rows.map((r) => t(r.activeFrom)));
  for (const r of rows) {
    const from = t(r.activeFrom);
    events.push({
      key: `${r.id}:from`,
      at: r.activeFrom,
      actor: r.createdBy,
      kind: attribute.isMultiselect ? 'added' : 'updated',
      value: r,
      resulting: activeAt(rows, from),
    });
    if (r.activeUntil) {
      const until = t(r.activeUntil);
      if (attribute.isMultiselect) {
        events.push({
          key: `${r.id}:until`,
          at: r.activeUntil,
          actor: r.deactivatedBy,
          kind: 'removed',
          value: r,
          resulting: activeAt(rows, until),
        });
      } else if (!starts.has(until)) {
        events.push({
          key: `${r.id}:until`,
          at: r.activeUntil,
          actor: r.deactivatedBy,
          kind: 'cleared',
          resulting: [],
        });
      }
    }
  }
  events.sort((a, b) => t(b.at) - t(a.at) || (a.kind === 'removed' || a.kind === 'cleared' ? 1 : -1));
  return events.map((e, i) => ({ ...e, isLatest: i === 0 }));
}
