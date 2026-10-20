// Server state of the views feature: views of an object, the schema the pickers and pills read (definitions,
// attributes, options, statuses, members) and the view writes (A §4.10, C1 README §3.1–3.2, §5). Views are normalised:
// the list query writes each view into its own key, every write answers the whole view and replaces both.
import {
  type AttributeDefinition,
  type ColumnInput,
  type EntityDefinition,
  type Path,
  type PipelineStage,
  rankAfter,
  rankBetween,
  type SelectOption,
  type Sort,
  type View,
  type WorkspaceMember,
} from '@agentic-crm/contracts';
import { queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import { useContext, useMemo } from 'react';
import { keys } from '../../data/keys';
import { queryClient } from '../../data/queryClient';
import { markCovered } from '../../data/realtime/invalidation';
import { api, getCurrentWorkspace, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { WorkspaceContext } from '../shell/workspaceContext';
import { SchemaIndex } from './schemaIndex';
import type { FilterAst } from './types';

/** The workspace of the current route (views always live inside one). */
export function useWorkspaceRef(): WorkspaceRef {
  const ctx = useContext(WorkspaceContext);
  const ws = ctx?.workspace ?? getCurrentWorkspace();
  if (!ws) throw new Error('Views need a workspace route');
  return useMemo(() => ({ id: ws.id, slug: ws.slug }), [ws.id, ws.slug]);
}

// ---- views --------------------------------------------------------------------------------------------------------

const byRank = (a: View, b: View) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0);

export const viewsQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: keys.views(ws.id, entityDefinitionId),
    queryFn: async () => {
      const views = await api.views.list.query({ entityDefinitionId }, inWorkspace(ws));
      for (const v of views) queryClient.setQueryData(keys.view(ws.id, v.id), v);
      return [...views].sort(byRank);
    },
  });

export const viewQuery = (ws: WorkspaceRef, viewId: string) =>
  queryOptions({
    queryKey: keys.view(ws.id, viewId),
    queryFn: () => api.views.get.query({ viewId }, inWorkspace(ws)),
  });

/** Views of an object in switcher order (lowest rank first; the bare object URL opens the first one). */
export function useViews(entityDefinitionId: string | null | undefined) {
  const ws = useWorkspaceRef();
  return useQuery({ ...viewsQuery(ws, entityDefinitionId ?? ''), enabled: Boolean(entityDefinitionId) });
}

/** Writes a canonical view (mutation response) into its key and the object's list. */
export function writeView(ws: WorkspaceRef, view: View, seq?: string | null): void {
  queryClient.setQueryData(keys.view(ws.id, view.id), view);
  queryClient.setQueryData<View[]>(keys.views(ws.id, view.entityDefinitionId), (list) => {
    if (!list) return list;
    const next = list.some((v) => v.id === view.id) ? list.map((v) => (v.id === view.id ? view : v)) : [...list, view];
    return next.filter((v) => !v.isArchived).sort(byRank);
  });
  if (seq) {
    markCovered(keys.view(ws.id, view.id), seq);
    noteAcceptAfter(ws.id, seq);
  }
}

function dropView(ws: WorkspaceRef, view: View): void {
  queryClient.setQueryData<View[]>(keys.views(ws.id, view.entityDefinitionId), (list) =>
    list?.filter((v) => v.id !== view.id),
  );
  queryClient.removeQueries({ queryKey: keys.view(ws.id, view.id), exact: true });
}

/** Writes of one view run one after another so responses never overtake each other. */
const chains = new Map<string, Promise<unknown>>();
export function serial<T>(viewId: string, run: () => Promise<T>): Promise<T> {
  const prev = chains.get(viewId) ?? Promise.resolve();
  const next = prev.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  chains.set(viewId, settled);
  void settled.then(() => {
    if (chains.get(viewId) === settled) chains.delete(viewId);
  });
  return next;
}

/** "{title} (2)", "(3)", … — the first title not used by another view of the object (C1 §3.1 duplicate). */
export function dedupeTitle(title: string, existing: readonly string[]): string {
  const base = title.replace(/ \(\d+\)$/, '');
  const taken = new Set(existing);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

function rankAfterView(ws: WorkspaceRef, source: View | null, entityDefinitionId: string): string | undefined {
  const list = (queryClient.getQueryData<View[]>(keys.views(ws.id, entityDefinitionId)) ?? []).slice().sort(byRank);
  try {
    if (!source) return rankAfter(list[list.length - 1]?.sortOrder ?? null, { jitter: true });
    const i = list.findIndex((v) => v.id === source.id);
    return rankBetween(source.sortOrder, list[i + 1]?.sortOrder ?? null, { jitter: true });
  } catch {
    return undefined;
  }
}

export interface CreateViewParams {
  entityDefinitionId: string;
  type: View['type'];
  title: string;
  kanbanPivotPath?: Path | null;
  filter?: FilterAst;
  sorts?: Sort[];
  columns?: ColumnInput[];
  /** Insert right after this view in the switcher (duplicate / save as new); default: at the end. */
  after?: View | null;
  tableRecordColumnWidth?: number | null;
}

/** Creates a view (PUT with a client UUID, idempotent) with its filter, sorts and columns in one call. */
export async function createView(ws: WorkspaceRef, params: CreateViewParams): Promise<View> {
  const id = newId();
  const sortOrder = rankAfterView(ws, params.after ?? null, params.entityDefinitionId);
  const { view, seq } = await api.views.create.mutate(
    {
      id,
      entityDefinitionId: params.entityDefinitionId,
      type: params.type,
      title: params.title.trim(),
      ...(sortOrder ? { sortOrder } : {}),
      filter: params.filter ?? null,
      sorts: params.sorts ?? [],
      columns: params.columns ?? [],
      kanbanPivotPath: params.kanbanPivotPath ?? null,
      tableRecordColumnWidth: params.tableRecordColumnWidth ?? null,
    },
    inWorkspace(ws),
  );
  writeView(ws, view, seq);
  return view;
}

/** Copies of a view's columns for a duplicate (new ids; labels, widths, calculations and formats kept). */
export function copyColumns(view: View): ColumnInput[] {
  return view.columns.map((c) => ({
    id: newId(),
    path: c.path,
    field: c.field,
    title: c.title,
    tableColumnWidth: c.tableColumnWidth,
    tableColumnAggregationType: c.tableColumnAggregationType,
    displayConfiguration: c.displayConfiguration,
    sortOrder: c.sortOrder,
  }));
}

/** Duplicate (switcher ⋮ → Duplicate) and "Save as new view": a new view right after the source. */
export function duplicateView(
  ws: WorkspaceRef,
  source: View,
  overrides: { title: string; filter?: FilterAst; sorts?: Sort[] },
): Promise<View> {
  return createView(ws, {
    entityDefinitionId: source.entityDefinitionId,
    type: source.type,
    title: overrides.title,
    kanbanPivotPath: source.kanbanPivotPath,
    filter: overrides.filter !== undefined ? overrides.filter : source.filter,
    sorts: overrides.sorts ?? source.sorts.map(({ path, field, direction }) => ({ path, field, direction })),
    columns: copyColumns(source),
    after: source,
    tableRecordColumnWidth: source.tableRecordColumnWidth,
  });
}

/** Title, rank, record column width… optimistic with rollback. */
export async function updateView(
  ws: WorkspaceRef,
  view: View,
  patch: { title?: string; sortOrder?: string; tableRecordColumnWidth?: number | null },
): Promise<View> {
  const before = queryClient.getQueryData<View>(keys.view(ws.id, view.id)) ?? view;
  writeView(ws, { ...before, ...patch } as View);
  try {
    const { view: next, seq } = await serial(view.id, () =>
      api.views.update.mutate({ viewId: view.id, ...patch }, inWorkspace(ws)),
    );
    writeView(ws, next, seq);
    return next;
  } catch (err) {
    writeView(ws, before);
    throw err;
  }
}

export async function deleteView(ws: WorkspaceRef, view: View): Promise<void> {
  const list = queryClient.getQueryData<View[]>(keys.views(ws.id, view.entityDefinitionId));
  dropView(ws, view);
  try {
    const { seq } = await serial(view.id, () => api.views.delete.mutate({ viewId: view.id }, inWorkspace(ws)));
    noteAcceptAfter(ws.id, seq);
  } catch (err) {
    if (list) queryClient.setQueryData(keys.views(ws.id, view.entityDefinitionId), list);
    queryClient.setQueryData(keys.view(ws.id, view.id), view);
    throw err;
  }
}

/** "Save for everyone": full replace of the filter and/or the sorts (C1 §3.1). */
export async function saveFilterAndSorts(
  ws: WorkspaceRef,
  viewId: string,
  parts: { filter?: FilterAst; sorts?: Sort[] },
): Promise<View> {
  return serial(viewId, async () => {
    let latest: View | undefined;
    if (parts.filter !== undefined) {
      const { view, seq } = await api.views.setFilter.mutate({ viewId, filter: parts.filter }, inWorkspace(ws));
      writeView(ws, view, seq);
      latest = view;
    }
    if (parts.sorts !== undefined) {
      const { view, seq } = await api.views.setSorts.mutate({ viewId, sorts: parts.sorts }, inWorkspace(ws));
      writeView(ws, view, seq);
      latest = view;
    }
    return latest ?? (queryClient.getQueryData<View>(keys.view(ws.id, viewId)) as View);
  });
}

// ---- schema ---------------------------------------------------------------------------------------------------------
// Own sub-keys under the shared resources (prefix invalidation reaches them) so other features' list shapes never
// collide with ours.

export const definitionsQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.objects(ws.id), 'all-with-archived'] as const,
    queryFn: () => api.schema.objects.list.query({ includeArchived: true }, inWorkspace(ws)),
    staleTime: 60_000,
  });

export const attributesQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: [...keys.attributes(ws.id, entityDefinitionId), 'with-archived'] as const,
    queryFn: (): Promise<AttributeDefinition[]> =>
      api.schema.attributes.list.query({ entityDefinitionId, includeArchived: true }, inWorkspace(ws)),
    staleTime: 60_000,
  });

export const optionsQuery = (ws: WorkspaceRef, entityDefinitionId: string, attributeDefinitionId: string) =>
  queryOptions({
    queryKey: [...keys.options(ws.id, entityDefinitionId, attributeDefinitionId), 'options'] as const,
    queryFn: (): Promise<SelectOption[]> =>
      api.schema.options.list.query({ entityDefinitionId, attributeDefinitionId }, inWorkspace(ws)),
    staleTime: 60_000,
  });

export const statusesQuery = (ws: WorkspaceRef, entityDefinitionId: string, attributeDefinitionId: string) =>
  queryOptions({
    queryKey: [...keys.options(ws.id, entityDefinitionId, attributeDefinitionId), 'statuses'] as const,
    queryFn: (): Promise<PipelineStage[]> =>
      api.schema.statuses.list.query({ entityDefinitionId, attributeDefinitionId }, inWorkspace(ws)),
    staleTime: 60_000,
  });

export const membersQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: [...keys.members(ws.id), 'views'] as const,
    queryFn: (): Promise<WorkspaceMember[]> => api.members.list.query(undefined, inWorkspace(ws)),
    staleTime: 60_000,
  });

export function useDefinitions(): EntityDefinition[] | undefined {
  const ws = useWorkspaceRef();
  return useQuery(definitionsQuery(ws)).data;
}

export function useDefinition(entityDefinitionId: string | null | undefined): EntityDefinition | undefined {
  return useDefinitions()?.find((d) => d.id === entityDefinitionId);
}

export function useAttributes(entityDefinitionId: string | null | undefined): AttributeDefinition[] | undefined {
  const ws = useWorkspaceRef();
  return useQuery({ ...attributesQuery(ws, entityDefinitionId ?? ''), enabled: Boolean(entityDefinitionId) }).data;
}

/** Options (select) or statuses (pipeline) of an attribute, non-archived first in rank order. */
export function useAttributeOptions(
  attr: AttributeDefinition | null | undefined,
): (SelectOption | PipelineStage)[] | undefined {
  const ws = useWorkspaceRef();
  const isPipeline = attr?.type === 'pipeline';
  const options = useQuery({
    ...optionsQuery(ws, attr?.entityDefinitionId ?? '', attr?.id ?? ''),
    enabled: attr?.type === 'select',
  });
  const statuses = useQuery({
    ...statusesQuery(ws, attr?.entityDefinitionId ?? '', attr?.id ?? ''),
    enabled: isPipeline,
  });
  const list = isPipeline ? statuses.data : options.data;
  return useMemo(
    () => list?.slice().sort((x, y) => (x.sortOrder < y.sortOrder ? -1 : x.sortOrder > y.sortOrder ? 1 : 0)),
    [list],
  );
}

export function useMembers(): WorkspaceMember[] | undefined {
  const ws = useWorkspaceRef();
  return useQuery(membersQuery(ws)).data;
}

/**
 * Schema read model over the root object plus every definition in `extraDefinitionIds` (path hops, drill-down
 * targets). Returns null until the root's attributes and the definitions have loaded.
 */
export function useSchemaIndex(
  rootDefinitionId: string | null | undefined,
  extraDefinitionIds: readonly string[] = [],
) {
  const ws = useWorkspaceRef();
  const definitions = useQuery(definitionsQuery(ws));
  const idsKey = [...new Set([...(rootDefinitionId ? [rootDefinitionId] : []), ...extraDefinitionIds])]
    .sort()
    .join(',');
  const ids = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey]);
  const results = useQueries({ queries: ids.map((id) => attributesQuery(ws, id)) });
  const dataKey = results.map((r) => r.dataUpdatedAt).join(',');
  return useMemo(() => {
    if (!definitions.data || !rootDefinitionId) return null;
    const map = new Map<string, AttributeDefinition[]>();
    ids.forEach((id, i) => {
      const data = results[i]?.data;
      if (data) map.set(id, data);
    });
    if (!map.has(rootDefinitionId)) return null;
    return new SchemaIndex(definitions.data, map);
  }, [definitions.data, rootDefinitionId, ids, dataKey]);
}
