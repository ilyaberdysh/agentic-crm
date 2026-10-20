// The board state behind <KanbanBoard>: view config (shared + local), the grouping attribute
// and its stages, the visible columns, one board read for every column (count + first ids), column chunks for long
// columns, the optimistic move overlay with rollback, selection, and the realtime safety net (a card whose stage
// value no longer matches its column triggers a refetch — covers 2-hop boards whose parent records change).
import type { AttributeDefinition, Path, PipelineStage, SelectOption, Sort, View } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorEnvelopeOf, type WorkspaceRef } from '../../data/trpc';
import { optionsQuery, stagesQuery } from '../attributes';
import { useWorkspace } from '../shell/workspaceContext';
import { useSchemaIndex, type ViewDraft } from '../views';
import { definitionsOfPaths, type SchemaIndex } from '../views/schemaIndex';
import { fireConfetti } from './confetti';
import { type ConfigPatch, type KanbanConfig, readKanbanConfig } from './config';
import {
  type BoardParams,
  boardColumnsQuery,
  type ColumnPage,
  fetchColumnChunk,
  type MoveInput,
  moveCard,
  optimisticStage,
  resolveLeaf,
  updateKanbanView,
} from './data';
import {
  applyMoves,
  type BoardStage,
  boardStages,
  type ColumnIds,
  dropSettled,
  type GroupKind,
  NO_STAGE,
  type PendingMove,
  type StageKey,
  stageOfCard,
  visibleColumns,
} from './model';

/** The object (or list's entry definition) the board shows. */
export interface BoardDefinition {
  id: string;
  entityType: string;
  apiSlug: string;
  singularNoun: string;
  pluralNoun: string;
  standardObjectType?: string | null;
  icon?: string | null;
  epithetPath?: Path | null;
}

export interface ColumnData extends ColumnIds {
  page: ColumnPage | undefined;
  /** More ids exist beyond the loaded ones. */
  hasMore: boolean;
}

export interface Board {
  workspace: WorkspaceRef;
  memberId: string | null;
  definition: BoardDefinition;
  draft: ViewDraft;
  view: View;
  config: KanbanConfig;
  showTimeInStage: boolean;
  schema: SchemaIndex | null;
  groupBy: Path | null;
  groupAttribute: AttributeDefinition | undefined;
  groupKind: GroupKind | null;
  /** Every live stage of the grouping attribute (Visible columns lists them all). */
  stages: BoardStage[];
  /** Columns on the board, in order. */
  columns: BoardStage[];
  stageByKey: ReadonlyMap<StageKey, BoardStage>;
  /** Column ids after the move overlay. */
  data: Record<StageKey, ColumnData>;
  isLoading: boolean;
  error: unknown;
  isEmpty: boolean;
  /** The list's `parent_record` attribute when the board shows list entries. */
  parentAttribute: AttributeDefinition | undefined;
  loadMore(key: StageKey): void;
  move(cardIds: readonly string[], to: StageKey): void;
  pendingCards: ReadonlySet<string>;
  /** A card's stage value disagrees with its column (another user moved it): refetch soon. */
  reportStale(cardId: string, valueKey: string): void;
  refresh(): void;
  saveConfig(patch: ConfigPatch): Promise<void>;
  selection: ReadonlySet<string>;
  toggleSelected(cardId: string, column: StageKey, range: boolean): void;
  clearSelection(): void;
}

const pathKey = (p: Path | null) => (p ? p.map((h) => h.attributeDefinitionId).join('>') : '');

function defaultSorts(schema: SchemaIndex | null, definitionId: string): Sort[] {
  const createdAt = schema
    ?.attributes(definitionId)
    ?.find((a) => a.systemAttributeType === 'created_at' || a.apiSlug === 'created_at');
  return createdAt
    ? [{ path: [{ entityDefinitionId: definitionId, attributeDefinitionId: createdAt.id }], direction: 'desc' }]
    : [];
}

export function useBoard(definition: BoardDefinition, draft: ViewDraft): Board {
  const { workspace: ws } = useWorkspace();
  const workspace = useMemo(() => ({ id: ws.id, slug: ws.slug }), [ws.id, ws.slug]);
  const memberId = ws.membership.id ?? null;
  const queryClient = useQueryClient();
  const view = draft.view;

  // ---- config (view.kanban; collapsed columns and card display stay per browser, prefs.ts) ------------------------------
  const config = useMemo(() => readKanbanConfig(view), [view]);
  const groupBy = config.groupBy;

  const pathDefs = useMemo(
    () => definitionsOfPaths([...(groupBy ? [groupBy] : []), ...draft.columns.map((c) => c.path)]),
    [groupBy, draft.columns],
  );
  const schema = useSchemaIndex(view.entityDefinitionId, pathDefs);
  const groupAttribute = groupBy ? schema?.leaf(groupBy) : undefined;
  const groupKind: GroupKind | null =
    groupAttribute?.type === 'pipeline' ? 'pipeline' : groupAttribute?.type === 'select' ? 'select' : null;
  const parentAttribute = useMemo(
    () =>
      definition.entityType === 'collection-entry'
        ? schema
            ?.attributes(definition.id)
            ?.find((a) => a.apiSlug === 'parent_record' || a.systemAttributeType === 'parent_record')
        : undefined,
    [schema, definition.entityType, definition.id],
  );

  // ---- stages -------------------------------------------------------------------------------------------------------
  const stagesQ = useQuery({
    ...stagesQuery(workspace, {
      entityDefinitionId: groupAttribute?.entityDefinitionId ?? '',
      id: groupAttribute?.id ?? '',
    }),
    enabled: groupKind === 'pipeline',
  });
  const optionsQ = useQuery({
    ...optionsQuery(workspace, {
      entityDefinitionId: groupAttribute?.entityDefinitionId ?? '',
      id: groupAttribute?.id ?? '',
    }),
    enabled: groupKind === 'select',
  });
  const rawOptions = (groupKind === 'pipeline' ? stagesQ.data : optionsQ.data) as
    | (PipelineStage | SelectOption)[]
    | undefined;
  const stages = useMemo(() => boardStages(rawOptions ?? []), [rawOptions]);
  const columns = useMemo(() => visibleColumns(stages, config), [stages, config]);
  const stageByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);

  // ---- columns read -------------------------------------------------------------------------------------------------
  const sorts = useMemo(
    () => (draft.sorts.length > 0 ? draft.sorts : defaultSorts(schema, view.entityDefinitionId)),
    [draft.sorts, schema, view.entityDefinitionId],
  );
  const params = useMemo<BoardParams | null>(() => {
    if (!groupBy || !groupKind || columns.length === 0 || !schema) return null;
    return {
      workspace,
      entityDefinitionId: view.entityDefinitionId,
      viewId: view.id,
      filter: draft.query.filter,
      sorts,
      ...(draft.query.timeZone ? { timeZone: draft.query.timeZone } : {}),
      groupBy,
      groupKind,
      columns: columns.map((c) => c.key),
      calculation: config.calculation,
      hiddenStageIds: config.hiddenStageIds,
    };
  }, [workspace, view.entityDefinitionId, view.id, draft.query, sorts, groupBy, groupKind, columns, schema, config]);
  const boardKey = params
    ? [
        view.id,
        draft.queryKey,
        JSON.stringify(sorts),
        pathKey(groupBy),
        params.columns.join(','),
        config.calculation ? `${pathKey(config.calculation.path)}:${config.calculation.kind}` : '',
      ].join('|')
    : 'idle';
  const query = boardColumnsQuery(
    params ?? {
      workspace,
      entityDefinitionId: view.entityDefinitionId,
      viewId: view.id,
      filter: null,
      sorts: [],
      groupBy: [],
      groupKind: 'pipeline',
      columns: [],
      calculation: null,
      hiddenStageIds: [],
    },
    boardKey,
  );
  const columnsQ = useQuery({ ...query, enabled: params !== null, placeholderData: (prev) => prev });
  // The key's content changes with `boardKey` only; keep one array so callbacks below stay stable.
  const boardQueryKey = useMemo(() => query.queryKey, [workspace.id, view.entityDefinitionId, boardKey]);

  // ---- chunks past the first page -------------------------------------------------------------------------------------
  const [chunks, setChunks] = useState<Record<string, string[]>>({});
  const loading = useRef(new Set<string>());
  const loadMore = useCallback(
    (key: StageKey) => {
      const page = columnsQ.data?.[key];
      if (!page?.snapshotId || !params) return;
      const loaded = page.ids.length + (chunks[page.snapshotId]?.length ?? 0);
      if (loaded >= page.total || loading.current.has(page.snapshotId)) return;
      const snapshotId = page.snapshotId;
      loading.current.add(snapshotId);
      fetchColumnChunk(params, page, loaded)
        .then((ids) => setChunks((prev) => ({ ...prev, [snapshotId]: [...(prev[snapshotId] ?? []), ...ids] })))
        .catch(() => void queryClient.invalidateQueries({ queryKey: boardQueryKey }))
        .finally(() => loading.current.delete(snapshotId));
    },
    [columnsQ.data, chunks, params, queryClient, boardQueryKey],
  );

  // ---- optimistic moves -----------------------------------------------------------------------------------------------
  const [moves, setMoves] = useState<PendingMove[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    if (columnsQ.dataUpdatedAt) setMoves((prev) => dropSettled(prev, columnsQ.dataUpdatedAt));
  }, [columnsQ.dataUpdatedAt]);

  const server = useMemo(() => {
    const out: Record<StageKey, ColumnIds & { page: ColumnPage | undefined }> = {};
    for (const col of columns) {
      const page = columnsQ.data?.[col.key];
      const extra = page?.snapshotId ? (chunks[page.snapshotId] ?? []) : [];
      out[col.key] = { ids: page ? [...page.ids, ...extra] : [], total: page?.total ?? 0, page };
    }
    return out;
  }, [columns, columnsQ.data, chunks]);

  const data = useMemo(() => {
    const overlaid = applyMoves(server, moves);
    const out: Record<StageKey, ColumnData> = {};
    for (const [key, col] of Object.entries(overlaid)) {
      const page = server[key]?.page;
      const serverLoaded = server[key]?.ids.length ?? 0;
      out[key] = { ...col, page, hasMore: Boolean(page && serverLoaded < page.total) };
    }
    return out;
  }, [server, moves]);
  const dataRef = useRef(data);
  dataRef.current = data;

  const pendingCards = useMemo(() => new Set(moves.map((m) => m.cardId)), [moves]);

  const refresh = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: boardQueryKey }),
    [queryClient, boardQueryKey],
  );

  const live = useRef({ params, groupKind, groupBy, stageByKey, memberId, workspace, definition });
  live.current = { params, groupKind, groupBy, stageByKey, memberId, workspace, definition };

  const move = useCallback(
    (cardIds: readonly string[], to: StageKey) => {
      const l = live.current;
      if (!l.groupBy || !l.groupKind) return;
      const toStage = l.stageByKey.get(to);
      let celebrate = false;
      for (const cardId of cardIds) {
        const from = stageOfCard(dataRef.current, cardId);
        if (from === null || from === to) continue;
        const id = ++seq.current;
        setMoves((prev) => [...prev, { seq: id, cardId, from, to, settledAt: null }]);
        if (toStage?.celebrationEnabled) celebrate = true;
        const input: MoveInput = {
          workspace: l.workspace,
          entityDefinitionId: l.definition.id,
          cardId,
          groupBy: l.groupBy,
          groupKind: l.groupKind,
          toStageId: to === NO_STAGE ? null : to,
          actorMemberId: l.memberId,
        };
        let rollbackValue: (() => void) | null = null;
        void (async () => {
          try {
            // Optimistic stage value where the card can resolve its leaf (a parent record not loaded yet: skip it).
            const leaf = await resolveLeaf(l.workspace, l.definition.id, cardId, input.groupBy).catch(() => null);
            rollbackValue = leaf ? optimisticStage(l.workspace, leaf, input) : null;
            await moveCard(input);
            setMoves((prev) => prev.map((m) => (m.seq === id ? { ...m, settledAt: Date.now() } : m)));
            void queryClient.invalidateQueries({ queryKey: boardQueryKey });
          } catch (error) {
            rollbackValue?.();
            setMoves((prev) => prev.filter((m) => m.seq !== id));
            toast.error({
              title: 'Failed to move card',
              description: errorEnvelopeOf(error).message,
              durationMs: 8000,
            });
          }
        })();
      }
      if (celebrate) fireConfetti();
    },
    [queryClient, boardQueryKey],
  );

  // ---- realtime safety net ------------------------------------------------------------------------------------------------
  const reported = useRef(new Set<string>());
  const staleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportStale = useCallback(
    (cardId: string, valueKey: string) => {
      const k = `${cardId}:${valueKey}`;
      if (reported.current.has(k) || pendingCards.has(cardId)) return;
      reported.current.add(k);
      if (staleTimer.current) clearTimeout(staleTimer.current);
      staleTimer.current = setTimeout(refresh, 400);
    },
    [pendingCards, refresh],
  );
  useEffect(() => () => void (staleTimer.current && clearTimeout(staleTimer.current)), []);

  // ---- config writes --------------------------------------------------------------------------------------------------------
  const saveConfig = useCallback(
    async (patch: ConfigPatch) => {
      try {
        await updateKanbanView(workspace, view, patch);
      } catch (error) {
        toast.error({ title: 'Failed to save view', description: errorEnvelopeOf(error).message, durationMs: 8000 });
      }
    },
    [workspace, view],
  );

  // ---- selection --------------------------------------------------------------------------------------------------------------
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<{ id: string; column: StageKey } | null>(null);
  const toggleSelected = useCallback((cardId: string, column: StageKey, range: boolean) => {
    setSelection((prev) => {
      const next = new Set(prev);
      const a = anchor.current;
      if (range && a && a.column === column) {
        const ids = dataRef.current[column]?.ids ?? [];
        const [i, j] = [ids.indexOf(a.id), ids.indexOf(cardId)].sort((x, y) => x - y) as [number, number];
        if (i >= 0) for (const id of ids.slice(i, j + 1)) next.add(id);
      } else if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      anchor.current = { id: cardId, column };
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelection(new Set()), []);

  const isEmpty =
    columnsQ.data !== undefined && columns.every((c) => (data[c.key]?.total ?? 0) === 0) && moves.length === 0;

  const isLoading = params !== null && columnsQ.isPending;
  const error = columnsQ.error;
  // One object per change, so memoised columns and cards skip renders the board does not need.
  return useMemo(
    () => ({
      workspace,
      memberId,
      definition,
      draft,
      view,
      config,
      showTimeInStage: config.showTimeInStage,
      schema,
      groupBy,
      groupAttribute,
      groupKind,
      stages,
      columns,
      stageByKey,
      data,
      isLoading,
      error,
      isEmpty,
      parentAttribute,
      loadMore,
      move,
      pendingCards,
      reportStale,
      refresh,
      saveConfig,
      selection,
      toggleSelected,
      clearSelection,
    }),
    [
      workspace,
      memberId,
      definition,
      draft,
      view,
      config,
      schema,
      groupBy,
      groupAttribute,
      groupKind,
      stages,
      columns,
      stageByKey,
      data,
      isLoading,
      error,
      isEmpty,
      parentAttribute,
      loadMore,
      move,
      pendingCards,
      reportStale,
      refresh,
      saveConfig,
      selection,
      toggleSelected,
      clearSelection,
    ],
  );
}
