// useViewDraft — contract C2 (research/architecture/decisions/slice2-contracts.md), consumed by the record table.
//
// Filter and sort edits are drafts (C1 README §3.1): kept per view for the session (they survive in-app navigation),
// re-queried immediately by the table, cleared by "Discard changes"; "Save for everyone" replaces the whole filter and
// sort arrays; "Save as new view" duplicates the view with the drafts and leaves the source as it was saved. Column
// edits are not drafts: each one is saved at once, shown optimistically until the server answers.
//
// The hook suspends until the view is loaded (wrap the consumer in <Suspense>; the route's pending UI covers it).
import { type Path, rankBetween, type Sort, type View, type ViewColumn } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { api, errorEnvelopeOf, inWorkspace, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { applyColumnOps, type PendingColumnOp, rankForMove, rankForPosition } from './columns';
import {
  duplicateView,
  saveFilterAndSorts,
  serial,
  updateView,
  useSchemaIndex,
  useWorkspaceRef,
  viewQuery,
  writeView,
} from './data';
import { type FilterDraft, viewDrafts } from './draftStore';
import {
  buildFilter,
  type FilterModel,
  filterKey,
  filterPaths,
  hasDynamicValues,
  parseFilter,
  sameFilter,
} from './filterModel';
import { hourEpoch, viewerTimeZone } from './relativeDates';
import { definitionsOfPaths, type SchemaIndex } from './schemaIndex';
import { sameSorts, sortsKey, toSorts } from './sortModel';
import type { AddColumnInput, ColumnMoveTarget, ColumnPatch, FilterAst } from './types';

export interface ViewDraft {
  /** The saved view (server state; columns there exclude in-flight edits — use `columns`). */
  view: View;
  /** Draft filter (or the saved one): what the table queries. */
  filter: FilterAst;
  /** Draft sorts (or the saved ones). */
  sorts: Sort[];
  /** Saved columns with in-flight column edits applied, in rank order. */
  columns: ViewColumn[];

  setFilter(filter: FilterAst): void;
  setSorts(sorts: Sort[]): void;
  isDirty: boolean;
  isFilterDirty: boolean;
  isSortsDirty: boolean;
  /** Full replace of the filter and/or sorts that differ from the saved view; drafts are cleared at once. */
  saveForEveryone(): Promise<void>;
  /** Duplicates the view with the drafts under `title`; the source keeps its saved state; navigate to the result. */
  saveAsNew(title: string): Promise<View>;
  /** "Discard changes": instant, no request. */
  discard(): void;

  addColumn(input: AddColumnInput): Promise<void>;
  updateColumn(columnId: string, patch: ColumnPatch): Promise<void>;
  removeColumn(columnId: string): Promise<void>;
  moveColumn(columnId: string, target: ColumnMoveTarget): Promise<void>;

  // ---- additive (beyond C2) ----
  /** Schema of the view's object and of the definitions its paths reach (null while loading). */
  schema: SchemaIndex | null;
  /** The filter bar's editing model (incomplete conditions included); null until the schema has loaded. */
  filterModel: FilterModel | null;
  setFilterModel(model: FilterModel): void;
  /** View rename (optimistic). */
  rename(title: string): Promise<void>;
  /** Record (first) column width, stored on the view (C1 §3.2 Resize); null resets to the default. */
  setRecordColumnWidth(width: number | null): Promise<void>;
  /**
   * `snapshots.query` input for the current drafts (relative dates resolve in the viewer's time zone) and a key that
   * changes with them (and hourly while the filter has relative dates).
   */
  query: { entityDefinitionId: string; filter: FilterAst; sorts: Sort[]; timeZone?: string };
  queryKey: string;
}

function useDraftState(viewId: string) {
  return useSyncExternalStore(
    (cb) => viewDrafts.subscribe(viewId, cb),
    () => viewDrafts.get(viewId),
    () => viewDrafts.get(viewId),
  );
}

/** Re-renders at the top of every hour while `enabled` (relative filters re-resolve hourly, C1 §4). */
export function useHourEpoch(enabled: boolean): number | null {
  const [epoch, setEpoch] = useState(() => hourEpoch());
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const now = Date.now();
      const next = (hourEpoch(now) + 1) * 3_600_000;
      timer = setTimeout(
        () => {
          setEpoch(hourEpoch());
          schedule();
        },
        next - now + 50,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [enabled]);
  return enabled ? epoch : null;
}

function reportFailure(error: unknown, title = 'Failed to save your changes'): void {
  toast.error({ title, description: errorEnvelopeOf(error).message, durationMs: 8000 });
}

/** Current server view from the cache (never stale inside async callbacks). */
function cachedView(ws: WorkspaceRef, viewId: string, fallback: View): View {
  return queryClient.getQueryData<View>(keys.view(ws.id, viewId)) ?? fallback;
}

function currentColumns(ws: WorkspaceRef, viewId: string, fallback: View): ViewColumn[] {
  return applyColumnOps(cachedView(ws, viewId, fallback).columns, viewDrafts.get(viewId).columnOps);
}

async function runColumnOp(
  ws: WorkspaceRef,
  viewId: string,
  op: PendingColumnOp,
  request: () => Promise<{ view: View; seq: string | null }>,
): Promise<void> {
  viewDrafts.addColumnOp(viewId, op);
  try {
    const { view, seq } = await serial(viewId, request);
    writeView(ws, view, seq);
  } catch (error) {
    reportFailure(error);
  } finally {
    viewDrafts.removeColumnOp(viewId, op.id);
  }
}

export function useViewDraft(viewId: string): ViewDraft {
  const ws = useWorkspaceRef();
  const { data: view } = useSuspenseQuery(viewQuery(ws, viewId));
  const state = useDraftState(viewId);

  const draftAst = state.filter?.ast;
  const filter: FilterAst = state.filter ? state.filter.ast : view.filter;
  const pathDefs = useMemo(
    () =>
      definitionsOfPaths([...filterPaths(view.filter), ...filterPaths(draftAst), ...view.columns.map((c) => c.path)]),
    [view.filter, draftAst, view.columns],
  );
  const schema = useSchemaIndex(view.entityDefinitionId, pathDefs);

  const filterModel = useMemo(() => {
    if (state.filter?.kind === 'model') return state.filter.model;
    if (!schema) return null;
    return parseFilter(filter, schema.resolve);
  }, [state.filter, schema, filter]);

  const sorts = useMemo(() => state.sorts ?? toSorts(view.sorts), [state.sorts, view.sorts]);
  const columns = useMemo(() => applyColumnOps(view.columns, state.columnOps), [view.columns, state.columnOps]);
  const isFilterDirty = state.filter !== undefined && !sameFilter(state.filter.ast, view.filter);
  const isSortsDirty = state.sorts !== undefined && !sameSorts(state.sorts, view.sorts);
  const epoch = useHourEpoch(hasDynamicValues(filter));
  const timeZone = useMemo(() => viewerTimeZone(), []);

  return useMemo<ViewDraft>(() => {
    const viewIdOf = view.id;
    return {
      view,
      filter,
      sorts,
      columns,
      schema,
      filterModel,
      isFilterDirty,
      isSortsDirty,
      isDirty: isFilterDirty || isSortsDirty,
      query: { entityDefinitionId: view.entityDefinitionId, filter, sorts, ...(timeZone ? { timeZone } : {}) },
      queryKey: `${filterKey(filter)}|${sortsKey(sorts)}${epoch === null ? '' : `|h${epoch}`}`,

      setFilter(next) {
        viewDrafts.setFilterAst(viewIdOf, next);
      },
      setFilterModel(model) {
        const resolve = schema?.resolve;
        // The editor only renders with the schema loaded; without it keep the previous AST rather than guess.
        const ast = resolve ? buildFilter(model, resolve) : (viewDrafts.get(viewIdOf).filter?.ast ?? view.filter);
        viewDrafts.setFilterModel(viewIdOf, model, ast);
      },
      setSorts(next) {
        viewDrafts.setSorts(viewIdOf, next);
      },
      discard() {
        viewDrafts.discard(viewIdOf);
      },

      async saveForEveryone() {
        const drafts: { filter?: FilterDraft; sorts?: Sort[] } = {
          filter: viewDrafts.get(viewIdOf).filter,
          sorts: viewDrafts.get(viewIdOf).sorts,
        };
        const saved = cachedView(ws, viewIdOf, view);
        const parts: { filter?: FilterAst; sorts?: Sort[] } = {};
        if (drafts.filter && !sameFilter(drafts.filter.ast, saved.filter)) parts.filter = drafts.filter.ast;
        if (drafts.sorts && !sameSorts(drafts.sorts, saved.sorts)) parts.sorts = drafts.sorts;
        // Optimistic: the saved view takes the drafts and the bar disappears at once.
        writeView(ws, {
          ...saved,
          filter: parts.filter !== undefined ? parts.filter : saved.filter,
          sorts: parts.sorts
            ? parts.sorts.map((s, i) => ({ ...s, id: `pending-sort-${i}`, sortOrder: String(i + 1) }))
            : saved.sorts,
        });
        viewDrafts.clearSaved(viewIdOf, drafts);
        if (parts.filter === undefined && parts.sorts === undefined) return;
        try {
          await saveFilterAndSorts(ws, viewIdOf, parts);
        } catch (error) {
          writeView(ws, saved);
          viewDrafts.restore(viewIdOf, drafts);
          reportFailure(error, 'Failed to save view');
        }
      },

      async saveAsNew(title) {
        const source = cachedView(ws, viewIdOf, view);
        try {
          const created = await duplicateView(ws, source, { title, filter, sorts });
          viewDrafts.discard(viewIdOf);
          return created;
        } catch (error) {
          reportFailure(error, 'Failed to create view');
          throw error;
        }
      },

      async addColumn({ path, field = null, title = null, position = 'end' }) {
        const id = newId();
        const sortOrder = rankForPosition(currentColumns(ws, viewIdOf, view), position);
        const column: ViewColumn = {
          id,
          // '~' sorts after every rank: the server appends when we could not compute one.
          sortOrder: sortOrder ?? '~',
          path,
          field,
          title,
          tableColumnWidth: null,
          tableColumnAggregationType: null,
          displayConfiguration: {},
        };
        await runColumnOp(ws, viewIdOf, { id: newId(), kind: 'add', column }, () =>
          api.views.addColumn.mutate(
            { viewId: viewIdOf, id, path, field, title, ...(sortOrder ? { sortOrder } : {}) },
            inWorkspace(ws),
          ),
        );
      },

      async updateColumn(columnId, patch) {
        await runColumnOp(ws, viewIdOf, { id: newId(), kind: 'update', columnId, patch }, () =>
          api.views.updateColumn.mutate({ viewId: viewIdOf, columnId, ...patch }, inWorkspace(ws)),
        );
      },

      async removeColumn(columnId) {
        await runColumnOp(ws, viewIdOf, { id: newId(), kind: 'remove', columnId }, () =>
          api.views.removeColumn.mutate({ viewId: viewIdOf, columnId }, inWorkspace(ws)),
        );
      },

      async moveColumn(columnId, target) {
        const sortOrder = rankForMove(currentColumns(ws, viewIdOf, view), columnId, target);
        if (!sortOrder) return;
        await runColumnOp(ws, viewIdOf, { id: newId(), kind: 'update', columnId, patch: { sortOrder } }, () =>
          api.views.updateColumn.mutate({ viewId: viewIdOf, columnId, sortOrder }, inWorkspace(ws)),
        );
      },

      async rename(title) {
        try {
          await updateView(ws, cachedView(ws, viewIdOf, view), { title: title.trim() });
        } catch (error) {
          reportFailure(error);
        }
      },

      async setRecordColumnWidth(width) {
        try {
          await updateView(ws, cachedView(ws, viewIdOf, view), { tableRecordColumnWidth: width });
        } catch (error) {
          reportFailure(error);
        }
      },
    };
  }, [ws, view, filter, sorts, columns, schema, filterModel, isFilterDirty, isSortsDirty, epoch, timeZone]);
}

/** Rank between two views (switcher drag reorder). */
export function rankBetweenViews(before: View | undefined, after: View | undefined): string | undefined {
  try {
    return rankBetween(before?.sortOrder ?? null, after?.sortOrder ?? null, { jitter: true });
  } catch {
    return undefined;
  }
}

/** Header "Filter" item and other entry points: open a new condition on `path` in the filter bar. */
export function requestFilterOn(draft: ViewDraft, path: Path, field: string | null): void {
  if (!draft.filterModel) return;
  const id = newId();
  const model: FilterModel = {
    ...draft.filterModel,
    children: [...draft.filterModel.children, { kind: 'condition', id, path, field, operator: null, value: undefined }],
  };
  draft.setFilterModel(model);
  viewDrafts.setFocus(draft.view.id, id);
}
