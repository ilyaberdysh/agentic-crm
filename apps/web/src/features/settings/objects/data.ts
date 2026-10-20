// Data for settings → Objects (J objects-lists §1–3, attribute-dialogs §1–7) over the schema.* procedures.
// Queries live under sub-keys of the normalised keys (data/keys.ts), so realtime invalidations of objects,
// attributes and options refresh these screens too. Settings writes are submit-and-wait (dialogs need the 409
// codes for field errors), then the response is written into the cache and its seq noted (I4a).
import type {
  AttributeDefinition,
  CreateAttributeInput,
  CreateObjectInput,
  EntityDefinition,
  PipelineStage,
  SelectOption,
  UpdateAttributeInput,
  UpdateObjectInput,
  WorkspaceMember,
} from '@agentic-crm/contracts';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { useContext, useRef } from 'react';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import {
  api,
  errorEnvelopeOf,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type WorkspaceRef,
} from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { WorkspaceContext } from '../../shell/workspaceContext';
import type { ListDiff, OptionDraft, StageDraft } from './attributes/formModel';
import { encodeTargetTime } from './attributes/formModel';

/** Objects administered in settings: people, companies, standard (incl. not yet activated) and custom objects. */
export const SETTINGS_ENTITY_TYPES = ['person-record', 'company-record', 'standard-object', 'custom-record'] as const;

const settingsObjectsKey = (ws: string) => [...keys.objects(ws), 'settings'] as const;
const attributesKey = (ws: string, defId: string) => [...keys.attributes(ws, defId), 'settings'] as const;
const optionsKey = (ws: string, defId: string, attrId: string) =>
  [...keys.options(ws, defId, attrId), 'options'] as const;
const stagesKey = (ws: string, defId: string, attrId: string) =>
  [...keys.options(ws, defId, attrId), 'stages'] as const;
const countKey = (ws: string, defId: string) => ['ws', ws, 'snapshot', defId, 'settings-count'] as const;

// ---- queries --------------------------------------------------------------------------------------------------

/** `all` (admins): every definition, so the Permissions tab of an object without data access stays reachable. */
export const settingsObjectsQuery = (ws: WorkspaceRef, scope: 'readable' | 'all' = 'readable') =>
  queryOptions({
    queryKey: scope === 'all' ? ([...settingsObjectsKey(ws.id), 'all'] as const) : settingsObjectsKey(ws.id),
    queryFn: () =>
      api.schema.objects.list.query(
        { includeArchived: true, entityTypes: [...SETTINGS_ENTITY_TYPES], ...(scope === 'all' ? { scope } : {}) },
        inWorkspace(ws),
      ) as Promise<EntityDefinition[]>,
  });

export function useSettingsObjects(ws: WorkspaceRef) {
  const isAdmin = useContext(WorkspaceContext)?.isAdmin ?? false;
  return useQuery(settingsObjectsQuery(ws, isAdmin ? 'all' : 'readable'));
}

/**
 * One object by api slug (or id), from the settings list. After a slug change the URL still holds the old slug
 * until the navigation lands; the object is then found by the id seen last, so the page does not flash "not found".
 */
export function useSettingsObject(ws: WorkspaceRef, slugOrId: string) {
  const list = useSettingsObjects(ws);
  const lastId = useRef<string | null>(null);
  const object =
    list.data?.find((o) => o.apiSlug === slugOrId || o.id === slugOrId) ??
    list.data?.find((o) => o.id === lastId.current) ??
    null;
  lastId.current = object?.id ?? null;
  return { ...list, object };
}

export const attributesQuery = (ws: WorkspaceRef, defId: string) =>
  queryOptions({
    queryKey: attributesKey(ws.id, defId),
    queryFn: () =>
      api.schema.attributes.list.query(
        { entityDefinitionId: defId, includeArchived: true },
        inWorkspace(ws),
      ) as Promise<AttributeDefinition[]>,
  });

export function useAttributes(ws: WorkspaceRef, defId: string | null) {
  return useQuery({ ...attributesQuery(ws, defId ?? ''), enabled: Boolean(defId) });
}

export function useOptions(
  ws: WorkspaceRef,
  attr: Pick<AttributeDefinition, 'id' | 'entityDefinitionId' | 'type'> | null,
) {
  return useQuery({
    queryKey: optionsKey(ws.id, attr?.entityDefinitionId ?? '', attr?.id ?? ''),
    queryFn: () =>
      api.schema.options.list.query(
        { entityDefinitionId: attr?.entityDefinitionId ?? '', attributeDefinitionId: attr?.id ?? '' },
        inWorkspace(ws),
      ) as Promise<SelectOption[]>,
    enabled: attr?.type === 'select',
  });
}

export function useStages(
  ws: WorkspaceRef,
  attr: Pick<AttributeDefinition, 'id' | 'entityDefinitionId' | 'type'> | null,
) {
  return useQuery({
    queryKey: stagesKey(ws.id, attr?.entityDefinitionId ?? '', attr?.id ?? ''),
    queryFn: () =>
      api.schema.statuses.list.query(
        { entityDefinitionId: attr?.entityDefinitionId ?? '', attributeDefinitionId: attr?.id ?? '' },
        inWorkspace(ws),
      ) as Promise<PipelineStage[]>,
    enabled: attr?.type === 'pipeline',
  });
}

/**
 * Record count of an active object ("Records" column). No usage-metrics endpoint yet: an empty snapshot range
 * returns the total. Archived (not activated) objects have no records.
 */
export function useRecordCount(ws: WorkspaceRef, object: Pick<EntityDefinition, 'id' | 'isArchived'>) {
  return useQuery({
    queryKey: countKey(ws.id, object.id),
    queryFn: async () => {
      const snap = await api.snapshots.query.query(
        { entityDefinitionId: object.id, initialRange: { start: 0, size: 0 } },
        inWorkspace(ws),
      );
      return snap.total;
    },
    enabled: !object.isArchived,
    staleTime: 30_000,
  });
}

/** Feature flags and quotas (B.13): object, attribute, option and view limits. */
export function useCapabilities(ws: WorkspaceRef) {
  return useQuery({
    queryKey: ['ws', ws.id, 'capabilities'],
    queryFn: () => api.capabilities.get.query(undefined, inWorkspace(ws)),
    staleTime: 5 * 60_000,
  });
}

export function useMembers(ws: WorkspaceRef) {
  return useQuery({
    queryKey: keys.members(ws.id),
    queryFn: () => api.members.list.query(undefined, inWorkspace(ws)) as Promise<WorkspaceMember[]>,
  });
}

// ---- errors ---------------------------------------------------------------------------------------------------

export interface WriteError {
  status: number;
  code?: string;
  message?: string;
  /** `additional_information` of the envelope (e.g. `limit`, `quota`, `conflicting_field`). */
  details?: Record<string, unknown>;
}

export function writeErrorOf(error: unknown): WriteError {
  const env = errorEnvelopeOf(error);
  const shape =
    error instanceof TRPCClientError ? (error.shape as { additional_information?: unknown } | undefined) : undefined;
  const details =
    shape?.additional_information && typeof shape.additional_information === 'object'
      ? (shape.additional_information as Record<string, unknown>)
      : undefined;
  return { status: httpStatusOf(error), code: env.code, message: env.message, ...(details ? { details } : {}) };
}

/**
 * Copy for the limit errors (C.4 #7): 409 ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED (options/stages per attribute) and
 * 409 OVER_USAGE_LIMIT (attributes or views per object, archived included). Null for other errors.
 */
export function limitMessage(e: WriteError): string | null {
  const limit = typeof e.details?.limit === 'number' ? e.details.limit : null;
  if (e.code === 'ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED') {
    return limit !== null
      ? `Reached the limit of ${limit} options. New options will not be created.`
      : 'Reached the limit of options. New options will not be created.';
  }
  if (e.code === 'OVER_USAGE_LIMIT') {
    const what = e.details?.quota === 'views_per_object_hard' ? 'views' : 'attributes';
    return limit !== null
      ? `This object has reached the limit of ${limit} ${what} (archived ${what} count towards it).`
      : `This object has reached its limit of ${what}.`;
  }
  return null;
}

// ---- cache helpers ----------------------------------------------------------------------------------------------

function upsertObject(ws: WorkspaceRef, object: EntityDefinition) {
  for (const key of [settingsObjectsKey(ws.id), [...settingsObjectsKey(ws.id), 'all'] as const]) {
    queryClient.setQueryData<EntityDefinition[]>(key, (list) => {
      if (!list) return list;
      return list.some((o) => o.id === object.id)
        ? list.map((o) => (o.id === object.id ? object : o))
        : [...list, object];
    });
  }
  queryClient.setQueryData(keys.object(ws.id, object.id), object);
  void queryClient.invalidateQueries({ queryKey: keys.objects(ws.id) });
}

function upsertAttribute(ws: WorkspaceRef, attr: AttributeDefinition) {
  queryClient.setQueryData<AttributeDefinition[]>(attributesKey(ws.id, attr.entityDefinitionId), (list) => {
    if (!list) return list;
    return list.some((a) => a.id === attr.id) ? list.map((a) => (a.id === attr.id ? attr : a)) : [...list, attr];
  });
  void queryClient.invalidateQueries({ queryKey: keys.attributes(ws.id, attr.entityDefinitionId) });
  // The other side of a relationship lives on another object.
  if (attr.relationship) {
    void queryClient.invalidateQueries({
      queryKey: keys.attributes(ws.id, attr.relationship.relatedEntityDefinitionId),
    });
  }
}

// ---- object writes ------------------------------------------------------------------------------------------------

export async function createObject(ws: WorkspaceRef, input: CreateObjectInput): Promise<EntityDefinition> {
  const res = await api.schema.objects.create.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertObject(ws, res.object);
  return res.object;
}

export async function updateObject(ws: WorkspaceRef, input: UpdateObjectInput): Promise<EntityDefinition> {
  const res = await api.schema.objects.update.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertObject(ws, res.object);
  return res.object;
}

export async function activateObject(ws: WorkspaceRef, entityDefinitionId: string): Promise<EntityDefinition> {
  const res = await api.schema.objects.activate.mutate({ entityDefinitionId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertObject(ws, res.object);
  void queryClient.invalidateQueries({ queryKey: keys.attributes(ws.id, entityDefinitionId) });
  return res.object;
}

/** Deactivate a standard object / remove a custom one (soft: `is_archived`, X-22; no hard delete endpoint yet). */
export async function archiveObject(ws: WorkspaceRef, entityDefinitionId: string): Promise<EntityDefinition> {
  const res = await api.schema.objects.archive.mutate({ entityDefinitionId }, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertObject(ws, res.object);
  return res.object;
}

// ---- attribute writes ---------------------------------------------------------------------------------------------

export async function createAttribute(ws: WorkspaceRef, input: CreateAttributeInput): Promise<AttributeDefinition> {
  const res = await api.schema.attributes.create.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertAttribute(ws, res.attribute);
  return res.attribute;
}

export async function updateAttribute(ws: WorkspaceRef, input: UpdateAttributeInput): Promise<AttributeDefinition> {
  const res = await api.schema.attributes.update.mutate(input, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertAttribute(ws, res.attribute);
  return res.attribute;
}

export async function archiveAttribute(ws: WorkspaceRef, attr: AttributeDefinition): Promise<AttributeDefinition> {
  const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
  const res = await api.schema.attributes.archive.mutate(ref, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertAttribute(ws, res.attribute);
  return res.attribute;
}

export async function restoreAttribute(ws: WorkspaceRef, attr: AttributeDefinition): Promise<AttributeDefinition> {
  const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
  const res = await api.schema.attributes.restore.mutate(ref, inWorkspace(ws));
  noteAcceptAfter(ws.id, res.seq);
  upsertAttribute(ws, res.attribute);
  return res.attribute;
}

export async function duplicateAttribute(
  ws: WorkspaceRef,
  attr: AttributeDefinition,
  input: { title: string; sortOrder?: string },
): Promise<AttributeDefinition> {
  const res = await api.schema.attributes.duplicate.mutate(
    {
      entityDefinitionId: attr.entityDefinitionId,
      attributeDefinitionId: attr.id,
      id: newId(),
      title: input.title,
      ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
    },
    inWorkspace(ws),
  );
  noteAcceptAfter(ws.id, res.seq);
  upsertAttribute(ws, res.attribute);
  return res.attribute;
}

/** Option writes of the edit dialog: archives first (a removed title can be reused), then creates and updates. */
export async function applyOptionDiff(ws: WorkspaceRef, attr: AttributeDefinition, diff: ListDiff<OptionDraft>) {
  const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
  let seq: string | null = null;
  const note = (s: string | null | undefined) => {
    if (s) seq = s;
  };
  for (const id of diff.archive)
    note((await api.schema.options.archive.mutate({ ...ref, selectOptionId: id }, inWorkspace(ws))).seq);
  for (const o of diff.create) {
    note(
      (
        await api.schema.options.create.mutate(
          { ...ref, id: o.id, title: o.title, color: o.color as never, sortOrder: o.sortOrder },
          inWorkspace(ws),
        )
      ).seq,
    );
  }
  for (const u of diff.update) {
    note(
      (
        await api.schema.options.update.mutate(
          {
            ...ref,
            selectOptionId: u.id,
            ...(u.title !== undefined ? { title: u.title } : {}),
            ...(u.color !== undefined ? { color: u.color as never } : {}),
            ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
          },
          inWorkspace(ws),
        )
      ).seq,
    );
  }
  if (seq) noteAcceptAfter(ws.id, seq);
  await queryClient.invalidateQueries({ queryKey: keys.options(ws.id, attr.entityDefinitionId, attr.id) });
}

export async function applyStageDiff(ws: WorkspaceRef, attr: AttributeDefinition, diff: ListDiff<StageDraft>) {
  const ref = { entityDefinitionId: attr.entityDefinitionId, attributeDefinitionId: attr.id };
  let seq: string | null = null;
  const note = (s: string | null | undefined) => {
    if (s) seq = s;
  };
  for (const id of diff.archive)
    note((await api.schema.statuses.archive.mutate({ ...ref, pipelineStageId: id }, inWorkspace(ws))).seq);
  for (const s of diff.create) {
    note(
      (
        await api.schema.statuses.create.mutate(
          {
            ...ref,
            id: s.id,
            title: s.title,
            color: s.color as never,
            sortOrder: s.sortOrder,
            lifecyclePhase: 'ACTIVE',
            celebrationEnabled: s.celebrationEnabled,
            targetTimeInStatus: encodeTargetTime(s.targetTime),
          },
          inWorkspace(ws),
        )
      ).seq,
    );
  }
  for (const u of diff.update) {
    note(
      (
        await api.schema.statuses.update.mutate(
          {
            ...ref,
            pipelineStageId: u.id,
            ...(u.title !== undefined ? { title: u.title } : {}),
            ...(u.color !== undefined ? { color: u.color as never } : {}),
            ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
            ...(u.extra?.celebrationEnabled !== undefined ? { celebrationEnabled: u.extra.celebrationEnabled } : {}),
            ...(u.extra?.targetTime !== undefined ? { targetTimeInStatus: encodeTargetTime(u.extra.targetTime) } : {}),
          },
          inWorkspace(ws),
        )
      ).seq,
    );
  }
  if (seq) noteAcceptAfter(ws.id, seq);
  await queryClient.invalidateQueries({ queryKey: keys.options(ws.id, attr.entityDefinitionId, attr.id) });
}

/** For components that need to refresh after a multi-call write. */
export function useInvalidateObjectSchema(ws: WorkspaceRef) {
  const client = useQueryClient();
  return (defId: string) => client.invalidateQueries({ queryKey: keys.attributes(ws.id, defId) });
}
