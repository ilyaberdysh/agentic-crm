// Pure model of the kanban board: stage keys and visible columns, the
// optimistic move overlay (removed from the source, prepended to the destination until the next refetch — in-column
// order is not persisted), stage target times as fully expanded ISO-8601 durations, time in stage, and the calculation
// menu's eligible attributes. No React, no network: unit-tested.
import type { AttributeDefinition, AttributeType, Path, PipelineStage, SelectOption } from '@agentic-crm/contracts';

/** Key of the "No stage" column and its token in the collapsed-columns list. */
export const NO_STAGE = 'no-stage';
export type StageKey = string;

/** A board column: a status stage / select option, or "No stage". */
export interface BoardStage {
  key: StageKey;
  /** Option / stage id; null for "No stage". */
  id: string | null;
  title: string;
  /** `block_*` (stages) / `pastel_*` (options); '' for "No stage". */
  color: string;
  sortOrder: string;
  /** Pipeline stages only. */
  celebrationEnabled: boolean;
  targetTimeInStatus: string | null;
  isArchived: boolean;
}

export type GroupKind = 'pipeline' | 'select';

export function isGroupable(attribute: Pick<AttributeDefinition, 'type' | 'isMultiselect' | 'isArchived'>): boolean {
  return (
    !attribute.isArchived &&
    (attribute.type === 'pipeline' || (attribute.type === 'select' && !attribute.isMultiselect))
  );
}

const byRank = <T extends { sortOrder: string }>(a: T, b: T) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0;

/** Live stages / options of the grouping attribute in option order (archived stages leave the board, X-08). */
export function boardStages(options: readonly (PipelineStage | SelectOption)[]): BoardStage[] {
  return options
    .filter((o) => !o.isArchived)
    .slice()
    .sort(byRank)
    .map((o) => ({
      key: o.id,
      id: o.id,
      title: o.title,
      color: o.color,
      sortOrder: o.sortOrder,
      celebrationEnabled: 'celebrationEnabled' in o ? o.celebrationEnabled : false,
      targetTimeInStatus: 'targetTimeInStatus' in o ? o.targetTimeInStatus : null,
      isArchived: o.isArchived,
    }));
}

export const NO_STAGE_COLUMN: BoardStage = {
  key: NO_STAGE,
  id: null,
  title: 'No stage',
  color: '',
  sortOrder: '',
  celebrationEnabled: false,
  targetTimeInStatus: null,
  isArchived: false,
};

/** Columns on the board: "No stage" first (when visible), then every stage that is not hidden on the view. */
export function visibleColumns(
  stages: readonly BoardStage[],
  opts: { noStatusVisible: boolean; hiddenStageIds: readonly string[] },
): BoardStage[] {
  const hidden = new Set(opts.hiddenStageIds);
  return [...(opts.noStatusVisible ? [NO_STAGE_COLUMN] : []), ...stages.filter((s) => !hidden.has(s.key))];
}

// ---- column data and the optimistic move overlay ----------------------------------------------------------------------

export interface ColumnIds {
  /** Loaded ids in server order (sparse beyond the loaded chunks: only a prefix is kept here). */
  ids: string[];
  total: number;
}

export interface PendingMove {
  /** Monotonic id (moves apply in order). */
  seq: number;
  cardId: string;
  from: StageKey;
  to: StageKey;
  /** `Date.now` when the server acknowledged the write; null while in flight. */
  settledAt: number | null;
}

/**
 * Applies in-flight and just-settled moves to server columns: the card leaves wherever it is and is shown first in its
 * destination column; counts follow. A move is dropped once the columns were refetched after it settled
 * (`dropSettled`), so the server order wins and the card may jump to its sorted place.
 */
export function applyMoves<T extends ColumnIds>(
  columns: Readonly<Record<StageKey, T>>,
  moves: readonly PendingMove[],
): Record<StageKey, ColumnIds> {
  const out: Record<StageKey, ColumnIds> = {};
  for (const [key, col] of Object.entries(columns)) out[key] = { ids: col.ids, total: col.total };
  for (const move of [...moves].sort((a, b) => a.seq - b.seq)) {
    for (const [key, col] of Object.entries(out)) {
      const i = col.ids.indexOf(move.cardId);
      if (i < 0) continue;
      out[key] = { ids: [...col.ids.slice(0, i), ...col.ids.slice(i + 1)], total: Math.max(0, col.total - 1) };
    }
    const dest = out[move.to];
    if (dest) out[move.to] = { ids: [move.cardId, ...dest.ids], total: dest.total + 1 };
  }
  return out;
}

/** Moves still to overlay once the columns were fetched at `fetchedAt`. */
export function dropSettled(moves: readonly PendingMove[], fetchedAt: number): PendingMove[] {
  const next = moves.filter((m) => m.settledAt === null || m.settledAt > fetchedAt);
  return next.length === moves.length ? (moves as PendingMove[]) : next;
}

/** Stage key a card currently sits in (after the overlay), or null when it is not loaded on the board. */
export function stageOfCard(columns: Readonly<Record<StageKey, ColumnIds>>, cardId: string): StageKey | null {
  for (const [key, col] of Object.entries(columns)) if (col.ids.includes(cardId)) return key;
  return null;
}

// ---- stage target time (K3: ISO-8601, always fully expanded) -------------------------------------------------------------

export type TargetUnit = 'days' | 'months' | 'years';

export interface TargetTime {
  value: number;
  unit: TargetUnit;
}

/** `{7, days}` → "P0Y0M7DT0H0M0S" (all fields are always sent). */
export function formatTargetTime({ value, unit }: TargetTime): string {
  const n = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const y = unit === 'years' ? n : 0;
  const m = unit === 'months' ? n : 0;
  const d = unit === 'days' ? n : 0;
  return `P${y}Y${m}M${d}DT0H0M0S`;
}

const DURATION = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** "P0Y0M7DT0H0M0S" → `{7, days}`; the largest non-zero unit wins; "P0Y0M0DT0H0M0S" → `{0, days}`. */
export function parseTargetTime(iso: string | null | undefined): TargetTime | null {
  if (!iso) return null;
  const m = DURATION.exec(iso);
  if (!m) return null;
  const [y, mo, w, d] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0)) as [number, number, number, number];
  if (y > 0 && mo === 0 && w === 0 && d === 0) return { value: y, unit: 'years' };
  if (mo > 0 && w === 0 && d === 0) return { value: y * 12 + mo, unit: 'months' };
  return { value: y * 365 + mo * 30 + w * 7 + d, unit: 'days' };
}

/** The instant `from` + the target duration (calendar months / years). */
export function targetDeadline(from: Date, target: TargetTime): Date {
  const out = new Date(from.getTime());
  if (target.unit === 'years') out.setFullYear(out.getFullYear() + target.value);
  else if (target.unit === 'months') out.setMonth(out.getMonth() + target.value);
  else out.setDate(out.getDate() + target.value);
  return out;
}

// ---- time in stage (BACKLOG 4.06) --------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** Whole days since the current stage value became active ("0d" the same day). */
export function daysInStage(activeFrom: string | Date, now: Date = new Date()): number {
  const from = typeof activeFrom === 'string' ? new Date(activeFrom) : activeFrom;
  const ms = now.getTime() - from.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / DAY_MS)) : 0;
}

export function formatDaysInStage(days: number): string {
  return `${days}d`;
}

/** The card has been in the stage longer than the stage's target time ("Track time in stage" on). */
export function isOverTarget(activeFrom: string | Date, target: string | null | undefined, now = new Date()): boolean {
  const parsed = parseTargetTime(target);
  if (!parsed) return false;
  const from = typeof activeFrom === 'string' ? new Date(activeFrom) : activeFrom;
  return now.getTime() > targetDeadline(from, parsed).getTime();
}

// ---- calculations (K7; X-23: the table's kinds and rule) ------------------------------------------------------------

export type CalculationKind =
  | 'count_empty'
  | 'count_not_empty'
  | 'percent_empty'
  | 'percent_not_empty'
  | 'sum'
  | 'mean'
  | 'max'
  | 'min';

export interface KanbanCalculation {
  path: Path;
  field: string | null;
  kind: CalculationKind;
}

export const CALCULATION_KINDS: readonly { kind: CalculationKind; label: string; numeric: boolean }[] = [
  { kind: 'count_empty', label: 'Count empty', numeric: false },
  { kind: 'count_not_empty', label: 'Count filled', numeric: false },
  { kind: 'percent_empty', label: 'Percent empty', numeric: false },
  { kind: 'percent_not_empty', label: 'Percent filled', numeric: false },
  { kind: 'sum', label: 'Sum', numeric: true },
  { kind: 'mean', label: 'Average', numeric: true },
  { kind: 'max', label: 'Max', numeric: true },
  { kind: 'min', label: 'Min', numeric: true },
];

const NUMERIC: ReadonlySet<AttributeType> = new Set(['number', 'currency', 'rating']);
/** Types the snapshot aggregation cannot count (computed / virtual values). */
const NOT_COUNTABLE: ReadonlySet<AttributeType> = new Set(['interaction']);

/** Attributes a calculation kind can use (live, readable). */
export function eligibleForCalculation(attribute: AttributeDefinition, kind: CalculationKind): boolean {
  if (attribute.isArchived || attribute.isHidden) return false;
  const numeric = CALCULATION_KINDS.find((k) => k.kind === kind)?.numeric ?? false;
  if (numeric) return NUMERIC.has(attribute.type);
  return !NOT_COUNTABLE.has(attribute.type);
}

export function calculationLabel(kind: CalculationKind): string {
  return CALCULATION_KINDS.find((k) => k.kind === kind)?.label ?? kind;
}

// ---- keyboard drag between columns ------------------------------------------------------------------------------------------

/** Next column for an arrow key while a card is picked up (left/right only; up/down stay in the column). */
export function adjacentColumn(order: readonly StageKey[], current: StageKey, key: string): StageKey | null {
  const i = order.indexOf(current);
  if (i < 0) return null;
  if (key === 'ArrowRight') return order[i + 1] ?? null;
  if (key === 'ArrowLeft') return order[i - 1] ?? null;
  return null;
}

/** New position of a dragged column among the visible ones (stage reorder). */
export function reorderTarget(
  order: readonly StageKey[],
  dragged: StageKey,
  over: StageKey,
): { before: StageKey | null; after: StageKey | null } | null {
  if (dragged === over || dragged === NO_STAGE || over === NO_STAGE) return null;
  const without = order.filter((k) => k !== dragged && k !== NO_STAGE);
  const from = order.indexOf(dragged);
  const to = order.indexOf(over);
  const overIndex = without.indexOf(over);
  // Moving right lands after the column under the pointer, moving left before it (sortable semantics).
  const insertAt = to > from ? overIndex + 1 : overIndex;
  return { before: without[insertAt - 1] ?? null, after: without[insertAt] ?? null };
}
