// An in-memory ViewDraft (features/views) for places that need the filter bar, sort popover or record table but not a
// saved view: the report editor's filter (no columns) and the "Contributing data" table (a regular record table that
// "cannot be saved as a view", builder §3.7). Columns, sorts and the editable part of the filter live in React state;
// the filter model of incomplete conditions lives in the shared draft store under the synthetic view id.
import type { Predicate, Sort, View, ViewColumn } from '@agentic-crm/contracts';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { newId } from '../../../lib/ids';
import { rankForMove, rankForPosition } from '../../views/columns';
import { useSchemaIndex } from '../../views/data';
import { viewDrafts } from '../../views/draftStore';
import {
  buildFilter,
  type FilterModel,
  filterKey,
  filterPaths,
  hasDynamicValues,
  parseFilter,
} from '../../views/filterModel';
import { hourEpoch, viewerTimeZone } from '../../views/relativeDates';
import { definitionsOfPaths } from '../../views/schemaIndex';
import { sortsKey } from '../../views/sortModel';
import type { ViewDraft } from '../../views/useViewDraft';
import { useHourEpoch } from '../../views/useViewDraft';

export interface EphemeralDraftOptions {
  /** Synthetic view id (the draft-store key); keep it stable for the editor's lifetime. */
  id: string;
  title: string;
  entityDefinitionId: string;
  /** Always applied (the report's filter and the clicked group), not editable here. */
  baseFilter?: Predicate | null;
  /** The editable filter: controlled when `userFilter` is given, else internal state starting at `initialUserFilter`. */
  userFilter?: Predicate | null;
  initialUserFilter?: Predicate | null;
  onUserFilterChange?: (filter: Predicate | null) => void;
  initialColumns?: ViewColumn[];
  initialSorts?: Sort[];
}

const and = (a: Predicate | null | undefined, b: Predicate | null | undefined): Predicate | null => {
  if (a && b) return { and: [a, b] };
  return a ?? b ?? null;
};

export function useEphemeralDraft(o: EphemeralDraftOptions): ViewDraft {
  const { id, entityDefinitionId } = o;
  const [internalFilter, setInternalFilter] = useState<Predicate | null>(o.initialUserFilter ?? null);
  const userFilter = o.userFilter !== undefined ? o.userFilter : internalFilter;
  const [columns, setColumns] = useState<ViewColumn[]>(o.initialColumns ?? []);
  const [sorts, setSortsState] = useState<Sort[]>(o.initialSorts ?? []);
  const [recordWidth, setRecordWidth] = useState<number | null>(null);

  const state = useSyncExternalStore(
    (cb) => viewDrafts.subscribe(id, cb),
    () => viewDrafts.get(id),
    () => viewDrafts.get(id),
  );
  const stored = state.filter;
  // The editing model lives in the store; an outside change of the filter (data source switch) drops it.
  useEffect(() => {
    if (stored && filterKey(stored.ast) !== filterKey(userFilter)) viewDrafts.discard(id);
  }, [stored, userFilter, id]);
  useEffect(() => () => viewDrafts.discard(id), [id]);

  const pathDefs = useMemo(
    () =>
      definitionsOfPaths([
        ...filterPaths(userFilter),
        ...filterPaths(o.baseFilter ?? null),
        ...columns.map((c) => c.path),
      ]),
    [userFilter, o.baseFilter, columns],
  );
  const schema = useSchemaIndex(entityDefinitionId, pathDefs);
  const filterModel = useMemo(() => {
    if (stored?.kind === 'model') return stored.model;
    if (!schema) return null;
    return parseFilter(userFilter, schema.resolve);
  }, [stored, schema, userFilter]);

  const filter = useMemo(() => and(o.baseFilter, userFilter), [o.baseFilter, userFilter]);
  const epoch = useHourEpoch(hasDynamicValues(filter));
  const timeZone = useMemo(() => viewerTimeZone(), []);
  void hourEpoch;

  const setUserFilter = (next: Predicate | null) => {
    if (o.userFilter === undefined) setInternalFilter(next);
    o.onUserFilterChange?.(next);
  };

  const view = useMemo<View>(
    () =>
      ({
        id,
        workspaceId: '',
        entityDefinitionId,
        type: 'table',
        title: o.title,
        sortOrder: 'm',
        entityFilterId: id,
        filter,
        sorts: [],
        columns,
        kanbanPivotPath: null,
        kanbanIsNoStatusVisible: null,
        kanbanIsTimeInStatusVisible: null,
        kanban: null,
        tableRecordColumnWidth: recordWidth,
        isArchived: false,
        createdBy: { type: 'system', id: null },
        createdAt: '',
      }) as unknown as View,
    [id, entityDefinitionId, o.title, filter, columns, recordWidth],
  );

  return useMemo<ViewDraft>(
    () => ({
      view,
      filter,
      sorts,
      columns,
      schema,
      filterModel,
      isFilterDirty: false,
      isSortsDirty: false,
      isDirty: false,
      query: { entityDefinitionId, filter, sorts, ...(timeZone ? { timeZone } : {}) },
      queryKey: `${filterKey(filter)}|${sortsKey(sorts)}${epoch === null ? '' : `|h${epoch}`}`,
      setFilter(next) {
        viewDrafts.discard(id);
        setUserFilter(next);
      },
      setFilterModel(model: FilterModel) {
        const resolve = schema?.resolve;
        if (!resolve) return;
        const ast = buildFilter(model, resolve);
        viewDrafts.setFilterModel(id, model, ast);
        setUserFilter(ast);
      },
      setSorts: setSortsState,
      discard() {
        viewDrafts.discard(id);
        setUserFilter(null);
        setSortsState([]);
      },
      async saveForEveryone() {},
      async saveAsNew() {
        throw new Error('A contributing data table cannot be saved as a view');
      },
      async addColumn({ path, field = null, title = null, position = 'end' }) {
        const sortOrder = rankForPosition(columns, position);
        setColumns((prev) => [
          ...prev,
          {
            id: newId(),
            sortOrder: sortOrder ?? '~',
            path,
            field,
            title,
            tableColumnWidth: null,
            tableColumnAggregationType: null,
            displayConfiguration: {},
          },
        ]);
      },
      async updateColumn(columnId, patch) {
        setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, ...patch } : c)));
      },
      async removeColumn(columnId) {
        setColumns((prev) => prev.filter((c) => c.id !== columnId));
      },
      async moveColumn(columnId, target) {
        const sortOrder = rankForMove(columns, columnId, target);
        if (sortOrder) setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, sortOrder } : c)));
      },
      async rename() {},
      async setRecordColumnWidth(width) {
        setRecordWidth(width);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      view,
      filter,
      sorts,
      columns,
      schema,
      filterModel,
      entityDefinitionId,
      timeZone,
      epoch,
      id,
      o.userFilter,
      o.onUserFilterChange,
    ],
  );
}
