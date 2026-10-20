// Kanban view configuration (slice4-contracts.md "Kanban"; C2 kanban.md K1, K3–K7). Shared settings live on the view
// (`view.kanban`: groupBy, hiddenStageIds, cardAttributePaths = the view's columns, showLabels, showNoStage,
// showTimeInStage, calculation) and are saved with `views.update({viewId, kanban: {...partial}})`. Per-browser settings
// (K3, K4, K6) stay local and never reach the server: collapsed columns, card display mode, "Hide empty attributes".
import type { KanbanConfigInput, Path, View } from '@agentic-crm/contracts';
import type { KanbanCalculation } from './model';

export interface KanbanConfig {
  groupBy: Path | null;
  noStatusVisible: boolean;
  hiddenStageIds: string[];
  showLabels: boolean;
  /** The time-in-stage chip on cards (`kanban.showTimeInStage`, no UI toggle in Attio — U-C2-3). */
  showTimeInStage: boolean;
  calculation: KanbanCalculation | null;
}

/** The settings the board edits (View settings, Visible columns, stage menu "Hide stage", calculation footer). */
export type ConfigPatch = Partial<
  Pick<KanbanConfig, 'groupBy' | 'noStatusVisible' | 'hiddenStageIds' | 'showLabels' | 'calculation'>
>;

type ServerCalculation = NonNullable<NonNullable<View['kanban']>['calculation']>;

const toCalculation = (c: ServerCalculation | null | undefined): KanbanCalculation | null =>
  c ? { path: c.path, field: c.field && c.field !== 'raw_value' ? c.field : null, kind: c.aggregation } : null;

const toServerCalculation = (c: KanbanCalculation | null): ServerCalculation | null =>
  c ? { path: c.path, field: c.field, aggregation: c.kind } : null;

/** The view's kanban settings; defaults on create (K1): label display "icon", "No stage" and the chip visible. */
export function readKanbanConfig(view: View): KanbanConfig {
  const k = view.kanban;
  return {
    groupBy: k?.groupBy ?? view.kanbanPivotPath ?? null,
    noStatusVisible: k ? k.showNoStage : view.kanbanIsNoStatusVisible !== false,
    hiddenStageIds: k?.hiddenStageIds ?? [],
    showLabels: k?.showLabels ?? false,
    showTimeInStage: k ? k.showTimeInStage : view.kanbanIsTimeInStatusVisible !== false,
    calculation: toCalculation(k?.calculation),
  };
}

/** `views.update` input for a change of kanban settings (`kanban.groupBy` also moves the view's pivot path). */
export function updatePatch(patch: ConfigPatch): { kanban: KanbanConfigInput } {
  const kanban: KanbanConfigInput = {};
  if (patch.groupBy) kanban.groupBy = patch.groupBy;
  if (patch.noStatusVisible !== undefined) kanban.showNoStage = patch.noStatusVisible;
  if (patch.hiddenStageIds !== undefined) kanban.hiddenStageIds = [...new Set(patch.hiddenStageIds)];
  if (patch.showLabels !== undefined) kanban.showLabels = patch.showLabels;
  if (patch.calculation !== undefined) kanban.calculation = toServerCalculation(patch.calculation);
  return { kanban };
}

/** The view as it looks after `patch` (optimistic cache write). */
export function patchedView(view: View, patch: ConfigPatch): View {
  const current = readKanbanConfig(view);
  const next = { ...current, ...patch, groupBy: patch.groupBy ?? current.groupBy };
  return {
    ...view,
    kanbanPivotPath: next.groupBy,
    kanbanIsNoStatusVisible: next.noStatusVisible,
    kanban: {
      groupBy: next.groupBy,
      hiddenStageIds: next.hiddenStageIds,
      cardAttributePaths: view.kanban?.cardAttributePaths ?? view.columns.map((c) => c.path),
      showLabels: next.showLabels,
      showNoStage: next.noStatusVisible,
      showTimeInStage: next.showTimeInStage,
      calculation: toServerCalculation(next.calculation),
    },
  };
}

// ---- per-browser preferences (K3, K4, K6) ---------------------------------------------------------------------------

/** Collapsed columns: `"no-stage"` + stage ids (K3, K6). */
export const collapsedColumnsKey = (viewId: string) => `kanban-collapsed-columns:${viewId}`;
/** `"collapsed"` | `"expanded"` (K6). */
export const cardDisplayModeKey = (workspaceId: string, viewId: string) =>
  `${workspaceId}:${viewId}:kanban-card-display-mode`;
/** `true` hides empty attribute rows on cards (K4). */
export const hideEmptyFieldsKey = (workspaceId: string, viewId: string) =>
  `${workspaceId}:${viewId}:kanban-card-hide-empty-fields`;
