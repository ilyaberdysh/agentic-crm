// Column (view attribute) edits: optimistic pending operations applied on top of the server view, fractional ranks
// for inserts and moves (CROSS-DOMAIN B.4), and the per-column formatting overrides (C1 §3.2 "Formatting", B.25).
import { rankBetween, type ViewColumn } from '@agentic-crm/contracts';
import type { ColumnMoveTarget, ColumnPatch, ColumnPosition } from './types';

export type PendingColumnOp =
  | { id: string; kind: 'add'; column: ViewColumn }
  | { id: string; kind: 'update'; columnId: string; patch: ColumnPatch & { sortOrder?: string } }
  | { id: string; kind: 'remove'; columnId: string };

const byRank = (a: ViewColumn, b: ViewColumn) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0);

export function sortColumns(columns: readonly ViewColumn[]): ViewColumn[] {
  return [...columns].sort(byRank);
}

/** Server columns with the pending optimistic operations applied (oldest first), in rank order. */
export function applyColumnOps(columns: readonly ViewColumn[], ops: readonly PendingColumnOp[]): ViewColumn[] {
  if (ops.length === 0) return sortColumns(columns);
  let out = [...columns];
  for (const op of ops) {
    if (op.kind === 'add') {
      if (!out.some((c) => c.id === op.column.id)) out.push(op.column);
    } else if (op.kind === 'update') {
      out = out.map((c) => (c.id === op.columnId ? { ...c, ...op.patch } : c));
    } else {
      out = out.filter((c) => c.id !== op.columnId);
    }
  }
  return sortColumns(out);
}

function between(before: string | null, after: string | null): string | undefined {
  try {
    return rankBetween(before, after, { jitter: true });
  } catch {
    return undefined; // malformed or equal neighbours: let the server append
  }
}

/** Rank for a new column at `position` (undefined = let the server append). */
export function rankForPosition(columns: readonly ViewColumn[], position: ColumnPosition = 'end'): string | undefined {
  const sorted = sortColumns(columns);
  if (position === 'end') return between(sorted[sorted.length - 1]?.sortOrder ?? null, null);
  const anchorId = 'leftOf' in position ? position.leftOf : position.rightOf;
  const i = sorted.findIndex((c) => c.id === anchorId);
  if (i === -1) return between(sorted[sorted.length - 1]?.sortOrder ?? null, null);
  if ('leftOf' in position) return between(sorted[i - 1]?.sortOrder ?? null, (sorted[i] as ViewColumn).sortOrder);
  return between((sorted[i] as ViewColumn).sortOrder, sorted[i + 1]?.sortOrder ?? null);
}

/** Rank that moves `columnId` to `target`; undefined when it would not move. */
export function rankForMove(
  columns: readonly ViewColumn[],
  columnId: string,
  target: ColumnMoveTarget,
): string | undefined {
  const sorted = sortColumns(columns);
  const from = sorted.findIndex((c) => c.id === columnId);
  if (from === -1) return undefined;
  const rest = sorted.filter((c) => c.id !== columnId);
  let index: number;
  if ('index' in target) index = Math.max(0, Math.min(target.index, rest.length));
  else {
    const anchor = rest.findIndex((c) => c.id === ('before' in target ? target.before : target.after));
    if (anchor === -1) return undefined;
    index = 'before' in target ? anchor : anchor + 1;
  }
  if (index === from) return undefined;
  return between(rest[index - 1]?.sortOrder ?? null, rest[index]?.sortOrder ?? null);
}

// ---- formatting overrides ------------------------------------------------------------------------------------------
// Stored in `ViewColumn.displayConfiguration` (free-form JSON in the contract). Shape owned here; the B.25 value
// formatter (features/attributes) reads it through `readColumnFormat`. null / missing = the attribute's default.

export type DatetimeDisplay = 'absolute' | 'relative';
export type CurrencyDisplay = 'symbol' | 'code' | 'name';
export type Grouping = 'default' | 'no-groups';
export type CurrencyDecimals = 'two-decimals' | 'no-decimals';

export interface ColumnFormat {
  datetime?: { displayType: DatetimeDisplay };
  currency?: {
    displayType?: CurrencyDisplay | null;
    groups?: Grouping | null;
    decimalPlaces?: CurrencyDecimals | null;
  };
  number?: { groups?: Grouping | null; decimalPlaces?: 0 | 1 | 2 | 3 | 4 | null };
}

const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Validated formatting overrides of a column (unknown keys and bad values are ignored). */
export function readColumnFormat(displayConfiguration: Record<string, unknown> | null | undefined): ColumnFormat {
  const cfg = obj(displayConfiguration) ?? {};
  const out: ColumnFormat = {};
  const dt = obj(cfg.datetime);
  const dtType = oneOf(dt?.displayType, ['absolute', 'relative'] as const);
  if (dtType) out.datetime = { displayType: dtType };
  const cur = obj(cfg.currency);
  if (cur) {
    out.currency = {
      displayType: oneOf(cur.displayType, ['symbol', 'code', 'name'] as const),
      groups: oneOf(cur.groups, ['default', 'no-groups'] as const),
      decimalPlaces: oneOf(cur.decimalPlaces, ['two-decimals', 'no-decimals'] as const),
    };
  }
  const num = obj(cfg.number);
  if (num) {
    const dp = num.decimalPlaces;
    out.number = {
      groups: oneOf(num.groups, ['default', 'no-groups'] as const),
      decimalPlaces:
        typeof dp === 'number' && Number.isInteger(dp) && dp >= 0 && dp <= 4 ? (dp as 0 | 1 | 2 | 3 | 4) : null,
    };
  }
  return out;
}

/** Display configuration with one formatting section patched (other sections and keys kept). */
export function patchColumnFormat<K extends keyof ColumnFormat>(
  displayConfiguration: Record<string, unknown> | null | undefined,
  section: K,
  patch: Partial<NonNullable<ColumnFormat[K]>>,
): Record<string, unknown> {
  const cfg = { ...(obj(displayConfiguration) ?? {}) };
  cfg[section] = { ...(obj(cfg[section]) ?? {}), ...patch };
  return cfg;
}
