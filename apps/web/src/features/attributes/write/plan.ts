// Commit planning (pure): an editor's commit (`ValueInput[]` set or `ValueOp[]`) applied to the values the user sees
// → the desired set the `values.set` mutation sends, and the optimistic rows shown until the server answers.

import type { Actor } from '@agentic-crm/contracts';
import { rankBetween } from '@agentic-crm/contracts';
import type { DesiredValue } from '../../../data/mutations';
import { type AttributeDefinition, type AttributeValue, type CommitInput, isValueOps, type RecordRef } from '../types';
import { currentValues, isBlankValue, toReadForm, valueIdentity } from '../values/shapes';

export interface CommitPlan {
  desired: DesiredValue[];
  /** What the cell shows while the write is pending. */
  optimistic: AttributeValue[];
  /** False when the commit leaves the values as they are (no write is sent). */
  changed: boolean;
}

interface Entry {
  id: string;
  /** Read form (current) or write form (new). */
  value: unknown;
  sortOrder: string | null;
  row?: AttributeValue;
}

export interface PlanContext {
  recordRef: Pick<RecordRef, 'entityDefinitionId' | 'entityInstanceId'> & { workspace: { id: string } };
  newId: () => string;
  now?: () => Date;
  actor?: Actor | null;
}

/** Ranks for a list in order, keeping existing ranks while they stay ascending. */
export function assignRanks(entries: Array<{ sortOrder: string | null }>): Array<string> {
  const out: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const own = entries[i]?.sortOrder ?? null;
    if (own && (prev === null || own > prev)) {
      // Keep it only if a later kept rank does not force a smaller value (cheap check against the next one).
      const next = entries[i + 1]?.sortOrder ?? null;
      if (next === null || own < next || i === entries.length - 1) {
        out.push(own);
        prev = own;
        continue;
      }
    }
    let upper: string | null = null;
    for (let j = i + 1; j < entries.length; j++) {
      const r = entries[j]?.sortOrder ?? null;
      if (r && (prev === null || r > prev)) {
        upper = r;
        break;
      }
    }
    const rank = rankBetween(prev, upper);
    out.push(rank);
    prev = rank;
  }
  return out;
}

/** A write value that clears the attribute (rating 0, blank text/name/location). */
function clears(attribute: AttributeDefinition, writeValue: unknown): boolean {
  if (writeValue === null || writeValue === undefined) return true;
  if (attribute.type === 'rating' && writeValue === 0) return true;
  if (attribute.type === 'text' && typeof writeValue === 'string') return writeValue.length === 0;
  return isBlankValue(attribute.type, toReadForm(attribute.type, writeValue, attribute));
}

export function planCommit(
  attribute: AttributeDefinition,
  shown: readonly AttributeValue[],
  next: CommitInput,
  ctx: PlanContext,
): CommitPlan {
  const type = attribute.type;
  const multi = attribute.isMultiselect;
  const current = currentValues(shown);
  const identity = (e: { value: unknown }) => valueIdentity(type, toReadForm(type, e.value, attribute));
  let entries: Entry[];

  if (isValueOps(next)) {
    entries = current.map((row) => ({ id: row.id, value: row.value, sortOrder: row.sortOrder, row }));
    for (const op of next) {
      if (op.op === 'retire') entries = entries.filter((e) => e.id !== op.id);
      else if (op.op === 'reorder')
        entries = entries.map((e) => (e.id === op.id ? { ...e, sortOrder: op.sortOrder } : e));
      else if (!multi) {
        entries = clears(attribute, op.value) ? [] : [{ id: op.id ?? ctx.newId(), value: op.value, sortOrder: null }];
      } else if (!clears(attribute, op.value)) {
        const key = identity(op);
        if (!entries.some((e) => identity(e) === key)) {
          const last = [...entries].sort((a, b) => ((a.sortOrder ?? '') < (b.sortOrder ?? '') ? -1 : 1)).pop();
          entries.push({
            id: op.id ?? ctx.newId(),
            value: op.value,
            sortOrder: op.sortOrder ?? rankBetween(last?.sortOrder ?? null, null),
          });
        }
      }
    }
    if (multi)
      entries.sort((a, b) => ((a.sortOrder ?? '') < (b.sortOrder ?? '') ? -1 : a.sortOrder === b.sortOrder ? 0 : 1));
  } else if (!multi) {
    const first = next.find((v) => !clears(attribute, v.value));
    if (!first) entries = [];
    else {
      const same = current[0] && identity(first) === valueIdentity(type, current[0].value);
      entries = same
        ? [{ id: current[0]!.id, value: current[0]!.value, sortOrder: current[0]!.sortOrder, row: current[0] }]
        : [{ id: first.id ?? ctx.newId(), value: first.value, sortOrder: null }];
    }
  } else {
    const unused = new Map(current.map((row) => [row.id, row]));
    const seen = new Set<string>();
    entries = [];
    for (const input of next) {
      if (clears(attribute, input.value)) continue;
      const key = identity(input);
      if (seen.has(key)) continue; // no duplicates in a multiselect (409 DUPLICATE_VALUE_IN_MULTISELECT)
      seen.add(key);
      let row = input.id ? unused.get(input.id) : undefined;
      if (row && valueIdentity(type, row.value) !== key) row = undefined; // same id, new value → replace
      row ??= [...unused.values()].find((r) => valueIdentity(type, r.value) === key);
      if (row) {
        unused.delete(row.id);
        entries.push({ id: row.id, value: row.value, sortOrder: input.sortOrder ?? row.sortOrder, row });
      } else {
        entries.push({
          id: input.id && !current.some((c) => c.id === input.id) ? input.id : ctx.newId(),
          value: input.value,
          sortOrder: input.sortOrder ?? null,
        });
      }
    }
    const ranks = assignRanks(entries);
    entries = entries.map((e, i) => ({ ...e, sortOrder: ranks[i] ?? e.sortOrder }));
  }

  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const optimistic: AttributeValue[] = entries.map(
    (e) =>
      (e.row ? { ...e.row, sortOrder: e.sortOrder } : null) ?? {
        id: e.id,
        workspaceId: ctx.recordRef.workspace.id,
        entityDefinitionId: ctx.recordRef.entityDefinitionId,
        entityInstanceId: ctx.recordRef.entityInstanceId,
        attributeDefinitionId: attribute.id,
        attributeType: type,
        value: toReadForm(type, e.value, attribute),
        activeFrom: now,
        activeUntil: null,
        sortOrder: e.sortOrder,
        createdBy: ctx.actor ?? { type: 'workspace-member', id: null },
        deactivatedBy: null,
      },
  );
  const changed =
    entries.length !== current.length ||
    entries.some((e, i) => e.id !== current[i]?.id || (multi && e.sortOrder !== current[i]?.sortOrder));
  return {
    desired: entries.map((e) => ({ id: e.id, value: e.value, sortOrder: e.sortOrder })),
    optimistic,
    changed,
  };
}
