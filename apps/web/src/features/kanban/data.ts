// The kanban data module (slice4-contracts.md "Kanban"; C2 kanban.md K2 data loading, K3 stage edits, K7, K8 moves).
// Every server call of the board goes through here, on the `kanban.*` procedures:
//   kanban.columns      one snapshot per visible column (the view's filter AND the column's stage — "No stage" = no
//                       current value), its total, first ids and the board calculation per column (X-23);
//   kanban.columnChunk  more ids of a long column;
//   kanban.move         writes the stage value — on the card, or on its parent record for `[parent_record, stage]`
//                       boards (history and Activity, retire + insert);
//   kanban.timeInStage  the "0d" chip (now − active_from of the current grouping value, overdue vs target time);
//   views.update        the view's kanban settings (`{kanban: {...partial}}`).
import type {
  AttributeDefinition,
  Path,
  PipelineStage,
  Predicate,
  SelectOption,
  Sort,
  View,
} from '@agentic-crm/contracts';
import { queryOptions } from '@tanstack/react-query';
import { BatchLoader } from '../../data/batchLoader';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { markCovered } from '../../data/realtime/invalidation';
import type { AttributeValue } from '../../data/records';
import { api, inWorkspace, noteAcceptAfter, type RouterOutputs, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { recordKeys } from '../record/data';
import { writeView } from '../views/data';
import { fireConfetti } from './confetti';
import { type ConfigPatch, patchedView, updatePatch } from './config';
import { type GroupKind, type KanbanCalculation, NO_STAGE, type StageKey } from './model';

export type AggregateResult = RouterOutputs['snapshots']['aggregate'];
type ColumnsOutput = RouterOutputs['kanban']['columns'];
type ValuesResult = RouterOutputs['values']['put'];

export const CHUNK_SIZE = 1000;

// ---- columns ----------------------------------------------------------------------------------------------------------

export interface ColumnPage {
  key: StageKey;
  /** Snapshot of the column (chunks and aggregates read it). */
  snapshotId: string | null;
  total: number;
  /** First chunk of ids in the view's order. */
  ids: string[];
  /** Board calculation for this column (computed with the columns). */
  aggregate: AggregateResult | null;
}

export interface BoardParams {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  viewId: string;
  filter: Predicate | null;
  sorts: Sort[];
  timeZone?: string;
  groupBy: Path;
  groupKind: GroupKind;
  /** Stage keys of the visible columns (NO_STAGE for "No stage"). */
  columns: StageKey[];
  calculation: KanbanCalculation | null;
  /** Stages hidden on the view (the server leaves their columns out). */
  hiddenStageIds: string[];
}

/** Ids per column in the first read; more come in chunks as a column scrolls. */
export const FIRST_PAGE = 200;

function collectPaths(p: Predicate | null, out: Path[]): Path[] {
  if (!p) return out;
  if ('and' in p) for (const c of p.and) collectPaths(c, out);
  else if ('or' in p) for (const c of p.or) collectPaths(c, out);
  else out.push(p.path);
  return out;
}

/** Attribute ids whose changes can move cards between columns or reorder them (realtime `snapshot-selection`). */
export function boardDependencies(params: Pick<BoardParams, 'filter' | 'sorts' | 'groupBy'>): string[] {
  const ids = new Set<string>();
  for (const path of [...collectPaths(params.filter, []), ...params.sorts.map((s) => s.path), params.groupBy])
    for (const hop of path) ids.add(hop.attributeDefinitionId);
  return [...ids];
}

/** `kanban.columns` → the board's pages per visible column (a column the server did not return is empty). */
export function toColumnPages(out: Pick<ColumnsOutput, 'columns'>, wanted: readonly StageKey[]) {
  const pages: Record<StageKey, ColumnPage> = {};
  for (const c of out.columns) {
    const key = c.stageId ?? NO_STAGE;
    pages[key] = { key, snapshotId: c.snapshotId, total: c.total, ids: c.firstIds, aggregate: c.aggregate };
  }
  for (const key of wanted) pages[key] ??= { key, snapshotId: null, total: 0, ids: [], aggregate: null };
  return pages;
}

/** Every visible column's count and first ids (one board-level read, refetched as a whole). */
export async function fetchBoardColumns(params: BoardParams): Promise<Record<StageKey, ColumnPage>> {
  const out = await api.kanban.columns.query(
    {
      entityDefinitionId: params.entityDefinitionId,
      viewId: params.viewId,
      groupBy: params.groupBy,
      filter: params.filter,
      sorts: params.sorts,
      hiddenStageIds: params.hiddenStageIds,
      showNoStage: params.columns.includes(NO_STAGE),
      calculation: params.calculation
        ? { path: params.calculation.path, field: params.calculation.field, aggregation: params.calculation.kind }
        : null,
      ...(params.timeZone ? { timeZone: params.timeZone } : {}),
      cardsPerColumn: FIRST_PAGE,
    },
    inWorkspace(params.workspace),
  );
  return toColumnPages(out, params.columns);
}

/** Board query, under the definition's snapshot prefix so `snapshot-selection` invalidations refresh it. */
export function boardColumnsQuery(params: BoardParams, key: string) {
  return queryOptions({
    queryKey: keys.snapshot(params.workspace.id, params.entityDefinitionId, `kanban|${key}`),
    queryFn: () => fetchBoardColumns(params),
    meta: { snapshotDeps: boardDependencies(params) },
    staleTime: 10 * 60_000,
    gcTime: 15 * 60_000,
  });
}

/** Ids [start, start + CHUNK_SIZE) of a column (virtualised columns past the first page). */
export async function fetchColumnChunk(params: BoardParams, page: ColumnPage, start: number): Promise<string[]> {
  if (!page.snapshotId) return [];
  const chunk = await api.kanban.columnChunk.query(
    { entityDefinitionId: params.entityDefinitionId, snapshotId: page.snapshotId, start, size: CHUNK_SIZE },
    inWorkspace(params.workspace),
  );
  return chunk.ids;
}

// ---- moves (K8) -------------------------------------------------------------------------------------------------------

export interface MoveInput {
  workspace: WorkspaceRef;
  /** The board's definition (object or list) and the card (record or entry). */
  entityDefinitionId: string;
  cardId: string;
  groupBy: Path;
  groupKind: GroupKind;
  /** Destination stage / option id; null = "No stage" (clears the value). */
  toStageId: string | null;
  actorMemberId: string | null;
}

/** The record and attribute that hold the stage value: the card itself, or its parent record for 2-hop paths. */
export interface LeafRef {
  entityDefinitionId: string;
  entityInstanceId: string;
  attributeDefinitionId: string;
}

function valuesKey(ws: WorkspaceRef, leaf: LeafRef) {
  return keys.values(ws.id, leaf.entityDefinitionId, leaf.attributeDefinitionId, leaf.entityInstanceId);
}

async function readValues(ws: WorkspaceRef, ref: LeafRef): Promise<AttributeValue[]> {
  const cached = queryClient.getQueryData<{ values: AttributeValue[] }>(valuesKey(ws, ref));
  if (cached) return cached.values;
  const { values } = await api.values.list.query(
    {
      entityDefinitionId: ref.entityDefinitionId,
      attributeDefinitionId: ref.attributeDefinitionId,
      entityInstanceIds: [ref.entityInstanceId],
    },
    inWorkspace(ws),
  );
  const entry = values[ref.entityInstanceId];
  return entry?.state === 'complete' ? (entry.value.values as AttributeValue[]) : [];
}

const current = (values: readonly AttributeValue[]) => values.filter((v) => !v.activeUntil);

/**
 * The record × attribute a move writes (`[stage]` → the card; `[parent_record, stage]` → the parent), for the
 * optimistic value; the server resolves it again in `kanban.move`.
 */
export async function resolveLeaf(
  ws: WorkspaceRef,
  entityDefinitionId: string,
  cardId: string,
  groupBy: Path,
): Promise<LeafRef> {
  const [first, second] = groupBy;
  if (!first) throw new Error('The view has no group-by attribute');
  if (!second)
    return { entityDefinitionId, entityInstanceId: cardId, attributeDefinitionId: first.attributeDefinitionId };
  if (groupBy.length > 2) throw new Error('Kanban grouping supports one record hop');
  const refs = current(
    await readValues(ws, {
      entityDefinitionId,
      entityInstanceId: cardId,
      attributeDefinitionId: first.attributeDefinitionId,
    }),
  );
  const target = refs[0]?.value as { entityInstanceId?: string } | undefined;
  if (!target?.entityInstanceId) throw new Error('The entry has no parent record');
  return {
    entityDefinitionId: second.entityDefinitionId,
    entityInstanceId: target.entityInstanceId,
    attributeDefinitionId: second.attributeDefinitionId,
  };
}

function reconcile(ws: WorkspaceRef, leaf: LeafRef, result: Pick<ValuesResult, 'values' | 'accurateAt' | 'seq'>) {
  const key = valuesKey(ws, leaf);
  queryClient.setQueryData(key, { values: result.values, accurateAt: result.accurateAt });
  markCovered(key, result.seq);
  noteAcceptAfter(ws.id, result.seq);
}

/** Optimistic stage value on the leaf (time in stage restarts at 0d; a stage card row shows the new stage). */
export function optimisticStage(ws: WorkspaceRef, leaf: LeafRef, input: MoveInput): () => void {
  const key = valuesKey(ws, leaf);
  const before = queryClient.getQueryData<{ values: AttributeValue[]; accurateAt: string | null }>(key);
  const kept = (before?.values ?? []).filter((v) => v.activeUntil);
  const now = new Date().toISOString();
  const next: AttributeValue[] =
    input.toStageId === null
      ? kept
      : [
          ...kept,
          {
            id: `optimistic:${leaf.entityInstanceId}:${leaf.attributeDefinitionId}`,
            workspaceId: ws.id,
            entityDefinitionId: leaf.entityDefinitionId,
            entityInstanceId: leaf.entityInstanceId,
            attributeDefinitionId: leaf.attributeDefinitionId,
            attributeType: input.groupKind,
            value: stageValueInput(input.groupKind, input.toStageId),
            activeFrom: now,
            activeUntil: null,
            sortOrder: null,
            createdBy: { type: 'workspace-member', id: input.actorMemberId },
            deactivatedBy: null,
          } as AttributeValue,
        ];
  queryClient.setQueryData(key, { values: next, accurateAt: before?.accurateAt ?? null });
  return () => {
    if (before) queryClient.setQueryData(key, before);
    else queryClient.removeQueries({ queryKey: key, exact: true });
  };
}

/**
 * Writes the card's new stage with `kanban.move` (client-minted value id: a retried move writes once, I3) and puts the
 * target's current values into the cache. The caller has already moved the card optimistically; errors propagate for
 * its rollback. Returns whether the destination stage celebrates (Confetti).
 */
export async function moveCard(input: MoveInput): Promise<{ celebrate: boolean; changed: boolean }> {
  const res = await api.kanban.move.mutate(
    {
      entityDefinitionId: input.entityDefinitionId,
      entityInstanceId: input.cardId,
      groupBy: input.groupBy,
      toStageId: input.toStageId,
      attributeValueId: newId(),
    },
    inWorkspace(input.workspace),
  );
  reconcile(input.workspace, res.target, {
    values: res.values as ValuesResult['values'],
    accurateAt: new Date().toISOString(),
    seq: res.seq,
  });
  return { celebrate: res.celebrate, changed: res.changed };
}

// ---- time in stage (K2 footer chip, C2 README §4) ----------------------------------------------------------------------

export type TimeInStage = RouterOutputs['kanban']['timeInStage']['items'][string];

interface TimeKey {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  groupBy: Path;
  cardId: string;
}

const groupKey = (groupBy: Path) => groupBy.map((h) => h.attributeDefinitionId).join('>');

const timeLoader = new BatchLoader<TimeKey, TimeInStage>({
  windowMs: 25,
  maxBatchSize: 500,
  groupOf: (k) => `${k.workspace.id}:${k.entityDefinitionId}:${groupKey(k.groupBy)}`,
  idOf: (k) => k.cardId,
  fetchBatch: async (batch) => {
    const first = batch[0] as TimeKey;
    const { items } = await api.kanban.timeInStage.query(
      {
        entityDefinitionId: first.entityDefinitionId,
        groupBy: first.groupBy,
        entityInstanceIds: batch.map((k) => k.cardId),
      },
      inWorkspace(first.workspace),
    );
    const out = new Map<string, TimeInStage | Error>();
    for (const k of batch) out.set(k.cardId, items[k.cardId] ?? new Error('No time in stage'));
    return out;
  },
});

/**
 * Days in the current stage from the value history, batched per board frame. `valueId` (the card's current stage
 * value) is part of the key, so a move — a new value — asks again.
 */
export const timeInStageQuery = (key: TimeKey & { valueId: string }) =>
  queryOptions({
    queryKey: [
      'ws',
      key.workspace.id,
      'kanban-time-in-stage',
      key.entityDefinitionId,
      groupKey(key.groupBy),
      key.cardId,
      key.valueId,
    ] as const,
    queryFn: () => timeLoader.load(key),
    staleTime: 60 * 60_000,
  });

// ---- view settings (K4) ---------------------------------------------------------------------------------------------------

/** Saves a change of the view's kanban settings: optimistic on the cached view, then `views.update({kanban})`. */
export async function updateKanbanView(ws: WorkspaceRef, view: View, patch: ConfigPatch): Promise<void> {
  const before = queryClient.getQueryData<View>(keys.view(ws.id, view.id)) ?? view;
  writeView(ws, patchedView(before, patch));
  try {
    const { view: next, seq } = await api.views.update.mutate(
      { viewId: view.id, ...updatePatch(patch) },
      inWorkspace(ws),
    );
    writeView(ws, next, seq);
  } catch (error) {
    writeView(ws, before);
    throw error;
  }
}

// ---- stages and options (K3) -----------------------------------------------------------------------------------------

type OptionLike = PipelineStage | SelectOption;

/** Cache keys holding the attribute's options/stages (the attributes feature's and the views feature's lists). */
function optionListKeys(ws: WorkspaceRef, attribute: AttributeDefinition) {
  return [keys.options(ws.id, attribute.entityDefinitionId, attribute.id)];
}

function patchCachedOptions(
  ws: WorkspaceRef,
  attribute: AttributeDefinition,
  fn: (list: OptionLike[]) => OptionLike[],
) {
  const snapshots: [readonly unknown[], unknown][] = [];
  for (const prefix of optionListKeys(ws, attribute)) {
    for (const [key, data] of queryClient.getQueriesData<OptionLike[]>({ queryKey: prefix })) {
      if (!Array.isArray(data)) continue;
      snapshots.push([key, data]);
      queryClient.setQueryData(key, fn(data));
    }
  }
  return () => {
    for (const [key, data] of snapshots) queryClient.setQueryData(key, data);
  };
}

function settleOptions(ws: WorkspaceRef, attribute: AttributeDefinition, seq: string | null | undefined) {
  noteAcceptAfter(ws.id, seq ?? null);
  void queryClient.invalidateQueries({ queryKey: keys.options(ws.id, attribute.entityDefinitionId, attribute.id) });
}

export interface StagePatch {
  title?: string;
  color?: string;
  targetTimeInStatus?: string | null;
  celebrationEnabled?: boolean;
  sortOrder?: string;
  isArchived?: boolean;
}

/** One stage/option edit (PATCH with the changed fields only), optimistic in every cached option list. */
export async function updateStage(
  ws: WorkspaceRef,
  attribute: AttributeDefinition,
  stageId: string,
  patch: StagePatch,
): Promise<void> {
  const rollback = patchCachedOptions(ws, attribute, (list) =>
    list.map((o) => (o.id === stageId ? ({ ...o, ...patch } as OptionLike) : o)),
  );
  const ref = { entityDefinitionId: attribute.entityDefinitionId, attributeDefinitionId: attribute.id };
  try {
    if (attribute.type === 'pipeline') {
      const { seq } = await api.schema.statuses.update.mutate(
        { ...ref, pipelineStageId: stageId, ...(patch as Record<string, never>) },
        inWorkspace(ws),
      );
      settleOptions(ws, attribute, seq);
    } else {
      const { targetTimeInStatus: _t, celebrationEnabled: _c, ...optionPatch } = patch;
      const { seq } = await api.schema.options.update.mutate(
        { ...ref, selectOptionId: stageId, ...(optionPatch as Record<string, never>) },
        inWorkspace(ws),
      );
      settleOptions(ws, attribute, seq);
    }
  } catch (error) {
    rollback();
    throw error;
  }
}

export async function createStage(
  ws: WorkspaceRef,
  attribute: AttributeDefinition,
  stage: { id: string; title: string; color: string; sortOrder?: string },
): Promise<void> {
  const ref = { entityDefinitionId: attribute.entityDefinitionId, attributeDefinitionId: attribute.id };
  const optimistic = {
    id: stage.id,
    workspaceId: ws.id,
    ...ref,
    title: stage.title,
    color: stage.color,
    sortOrder: stage.sortOrder ?? '~',
    isArchived: false,
    createdAt: new Date().toISOString(),
    lifecyclePhase: 'ACTIVE',
    targetTimeInStatus: null,
    celebrationEnabled: false,
  } as OptionLike;
  const rollback = patchCachedOptions(ws, attribute, (list) => [...list, optimistic]);
  try {
    if (attribute.type === 'pipeline') {
      const { seq } = await api.schema.statuses.create.mutate(
        {
          ...ref,
          id: stage.id,
          title: stage.title,
          color: stage.color as never,
          ...(stage.sortOrder ? { sortOrder: stage.sortOrder } : {}),
          lifecyclePhase: 'ACTIVE',
          targetTimeInStatus: null,
          celebrationEnabled: false,
        },
        inWorkspace(ws),
      );
      settleOptions(ws, attribute, seq);
    } else {
      const { seq } = await api.schema.options.create.mutate(
        {
          ...ref,
          id: stage.id,
          title: stage.title,
          color: stage.color as never,
          ...(stage.sortOrder ? { sortOrder: stage.sortOrder } : {}),
        },
        inWorkspace(ws),
      );
      settleOptions(ws, attribute, seq);
    }
  } catch (error) {
    rollback();
    throw error;
  }
}

// ---- card counters (K2 footer) ---------------------------------------------------------------------------------------

export type RelatedCounts = RouterOutputs['recordPage']['relatedCounts']['counts'][string];

interface CountsKey {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  entityInstanceId: string;
}

const countsLoader = new BatchLoader<CountsKey, RelatedCounts>({
  windowMs: 25,
  maxBatchSize: 200,
  groupOf: (k) => `${k.workspace.id}:${k.entityDefinitionId}`,
  idOf: (k) => k.entityInstanceId,
  fetchBatch: async (batch) => {
    const first = batch[0] as CountsKey;
    const { counts } = await api.recordPage.relatedCounts.query(
      { entityDefinitionId: first.entityDefinitionId, entityInstanceIds: batch.map((k) => k.entityInstanceId) },
      inWorkspace(first.workspace),
    );
    const out = new Map<string, RelatedCounts | Error>();
    for (const k of batch) {
      const c = counts[k.entityInstanceId];
      out.set(k.entityInstanceId, c ?? new Error('No counts'));
    }
    return out;
  },
});

/** Notes / open tasks / comments of a record, batched per board frame; the record page shares the key. */
export const countsQuery = (key: CountsKey) =>
  queryOptions({
    queryKey: recordKeys.counts(key.workspace.id, key.entityDefinitionId, key.entityInstanceId),
    queryFn: async (): Promise<RelatedCounts | null> => countsLoader.load(key).catch(() => null),
    staleTime: 30_000,
  });

export { newId };

// ---- add a card (K3 "+" in a stage header) -------------------------------------------------------------------------

/** Write form of a stage value. */
export function stageValueInput(kind: GroupKind, stageId: string) {
  return kind === 'pipeline' ? { pipelineStageId: stageId } : { selectOptionId: stageId };
}

/**
 * Adds a record to a list board in a stage (`entries.add`; the list page passes its own add-to-list flow as
 * `onAddCard`). A list stage is written with the entry; a parent-record stage on the parent record.
 */
export async function addListEntry(
  ws: WorkspaceRef,
  listId: string,
  record: { entityDefinitionId: string; entityInstanceId: string },
  stage: { groupBy: Path; kind: GroupKind; stageId: string | null },
): Promise<void> {
  const [first, second] = stage.groupBy;
  const values =
    stage.stageId && first && !second
      ? { [first.attributeDefinitionId]: [{ value: stageValueInput(stage.kind, stage.stageId) }] }
      : undefined;
  const result = await api.entries.add.mutate(
    // Client-minted entry id: a retried add creates one entry (I3).
    { listId, parentRecords: [record], entryIds: [newId()], ...(values ? { values } : {}), onDuplicate: 'keep' },
    inWorkspace(ws),
  );
  noteAcceptAfter(ws.id, result.seq);
  // A new entry entering a stage with Confetti on celebrates too (C2 §2.5).
  if (result.celebrate) fireConfetti();
  if (stage.stageId && second) {
    const leaf = {
      entityDefinitionId: second.entityDefinitionId,
      entityInstanceId: record.entityInstanceId,
      attributeDefinitionId: second.attributeDefinitionId,
    };
    const put = await api.values.put.mutate(
      { ...leaf, attributeValueId: newId(), value: stageValueInput(stage.kind, stage.stageId) },
      inWorkspace(ws),
    );
    reconcile(ws, leaf, put);
  }
}
