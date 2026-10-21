// Cached reads the attribute UI needs besides the values themselves: select options, pipeline stages, workspace
// members, object definitions (display-name path, icon), attribute lists, record display names and action
// policies. Keys follow data/keys.ts so realtime invalidations refresh them (stages live under the option-list
// prefix: `select-option-list` invalidations cover both).
import type { EntityDefinition, ResolvedActionPolicy } from '@agentic-crm/contracts';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { queryClient as appQueryClient } from '../../../data/queryClient';
import { valuesQuery } from '../../../data/records';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { formatOne } from '../format/formatValue';
import type { AttributeDefinition, AttributeValue, Member, PipelineStage, SelectOption, ValueLookup } from '../types';
import { currentValues, read } from '../values/shapes';
import { useAttributeEnv } from './env';

const enabled = (ws: WorkspaceRef) => Boolean(ws.id);

export const optionsQuery = (ws: WorkspaceRef, attribute: Pick<AttributeDefinition, 'entityDefinitionId' | 'id'>) =>
  queryOptions({
    queryKey: keys.options(ws.id, attribute.entityDefinitionId, attribute.id),
    queryFn: () =>
      api.schema.options.list.query(
        {
          entityDefinitionId: attribute.entityDefinitionId,
          attributeDefinitionId: attribute.id,
          includeArchived: true,
        },
        inWorkspace(ws),
      ) as Promise<SelectOption[]>,
  });

export const stagesQuery = (ws: WorkspaceRef, attribute: Pick<AttributeDefinition, 'entityDefinitionId' | 'id'>) =>
  queryOptions({
    queryKey: [...keys.options(ws.id, attribute.entityDefinitionId, attribute.id), 'stages'] as const,
    queryFn: () =>
      api.schema.statuses.list.query(
        {
          entityDefinitionId: attribute.entityDefinitionId,
          attributeDefinitionId: attribute.id,
          includeArchived: true,
        },
        inWorkspace(ws),
      ) as Promise<PipelineStage[]>,
  });

export const membersQuery = (ws: WorkspaceRef) =>
  queryOptions({
    queryKey: keys.members(ws.id),
    queryFn: () => api.members.list.query(undefined, inWorkspace(ws)) as Promise<Member[]>,
  });

export const objectQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: keys.object(ws.id, entityDefinitionId),
    queryFn: () => api.schema.objects.get.query({ entityDefinitionId }, inWorkspace(ws)) as Promise<EntityDefinition>,
  });

export const attributesQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: keys.attributes(ws.id, entityDefinitionId),
    queryFn: () =>
      api.schema.attributes.list.query({ entityDefinitionId }, inWorkspace(ws)) as Promise<AttributeDefinition[]>,
  });

export const policyQuery = (ws: WorkspaceRef, entityDefinitionId: string) =>
  queryOptions({
    queryKey: [...keys.object(ws.id, entityDefinitionId), 'policy'] as const,
    queryFn: async () => {
      const { policies } = await api.policies.resolve.query(
        { entityDefinitionIds: [entityDefinitionId] },
        inWorkspace(ws),
      );
      const entry = Object.values(policies)[0];
      return entry?.state === 'complete' ? (entry.value as ResolvedActionPolicy) : null;
    },
  });

// ---- hooks -----------------------------------------------------------------------------------------------------------

export function useSelectOptions(attribute: AttributeDefinition): SelectOption[] {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...optionsQuery(workspace, attribute),
    enabled: enabled(workspace) && attribute.type === 'select',
  });
  return q.data ?? EMPTY;
}

export function useStages(attribute: AttributeDefinition): PipelineStage[] {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...stagesQuery(workspace, attribute),
    enabled: enabled(workspace) && attribute.type === 'pipeline',
  });
  return q.data ?? EMPTY;
}

export function useMembers(active = true): Member[] {
  const { workspace } = useAttributeEnv();
  const q = useQuery({ ...membersQuery(workspace), enabled: enabled(workspace) && active });
  return q.data ?? EMPTY;
}

export function useObjectDefinition(entityDefinitionId: string | null | undefined): EntityDefinition | undefined {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...objectQuery(workspace, entityDefinitionId ?? ''),
    enabled: enabled(workspace) && Boolean(entityDefinitionId),
  });
  return q.data;
}

export function useAttributes(entityDefinitionId: string | null | undefined): {
  attributes: AttributeDefinition[];
  isLoading: boolean;
} {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...attributesQuery(workspace, entityDefinitionId ?? ''),
    enabled: enabled(workspace) && Boolean(entityDefinitionId),
  });
  return { attributes: q.data ?? EMPTY, isLoading: q.isPending };
}

/** `can(flag)`: true until the policy is known (allow-all resolver in /2). */
export function usePolicy(
  entityDefinitionId: string | null | undefined,
): (flag: keyof ResolvedActionPolicy) => boolean {
  const { workspace } = useAttributeEnv();
  const q = useQuery({
    ...policyQuery(workspace, entityDefinitionId ?? ''),
    enabled: enabled(workspace) && Boolean(entityDefinitionId),
  });
  return (flag) => {
    const p = q.data;
    if (!p) return true;
    const v = p[flag];
    return typeof v === 'boolean' ? v : true;
  };
}

const EMPTY: never[] = [];

/** Display name of a value of the object's display-name attribute (text, personal name, email, domain). */
export function titleFromValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const name = read.name(value);
  if (name?.fullName || name?.firstName || name?.lastName)
    return name.fullName || `${name.firstName} ${name.lastName}`.trim();
  const email = read.email(value);
  if (email) return email.originalEmailAddress;
  const domain = read.domain(value);
  if (domain) return domain.normalizedDomain;
  return '';
}

export interface RecordTitle {
  title: string;
  isLoading: boolean;
  definition: EntityDefinition | undefined;
}

/** A record's display name: its object's display-name attribute value (D), else the record id. */
export function useRecordTitle(entityDefinitionId: string, entityInstanceId: string): RecordTitle {
  const { workspace } = useAttributeEnv();
  const definition = useObjectDefinition(entityDefinitionId || null);
  const titleHop = definition?.epithetPath?.length === 1 ? definition.epithetPath[0] : undefined;
  const q = useQuery({
    ...valuesQuery({
      workspace,
      entityDefinitionId,
      entityInstanceId,
      attributeDefinitionId: titleHop?.attributeDefinitionId ?? '',
    }),
    enabled: enabled(workspace) && Boolean(titleHop && entityInstanceId),
  });
  const value = q.data ? currentValues(q.data.values as AttributeValue[])[0]?.value : undefined;
  const title = value !== undefined ? titleFromValue(value) : '';
  return {
    title: title || (definition && !titleHop ? entityInstanceId : title),
    isLoading: !definition || (Boolean(titleHop) && q.isPending),
    definition,
  };
}

// ---- cache lookup (formatValue / copyText without hooks) ------------------------------------------------------------

/** Resolves titles from whatever the query cache already holds (cells render before they are copied). */
export function cacheLookup(workspaceId: string, client: QueryClient = appQueryClient): ValueLookup {
  return {
    option: (attribute, id) =>
      client
        .getQueryData<SelectOption[]>(keys.options(workspaceId, attribute.entityDefinitionId, attribute.id))
        ?.find((o) => o.id === id),
    stage: (attribute, id) =>
      client
        .getQueryData<PipelineStage[]>([
          ...keys.options(workspaceId, attribute.entityDefinitionId, attribute.id),
          'stages',
        ])
        ?.find((s) => s.id === id),
    member: (id) => client.getQueryData<Member[]>(keys.members(workspaceId))?.find((m) => m.id === id),
    recordTitle: (entityDefinitionId, entityInstanceId) => {
      const def = client.getQueryData<EntityDefinition>(keys.object(workspaceId, entityDefinitionId));
      const hop = def?.epithetPath?.length === 1 ? def.epithetPath[0] : undefined;
      if (!hop) return def ? entityInstanceId : undefined;
      const data = client.getQueryData<{ values: AttributeValue[] }>(
        keys.values(workspaceId, entityDefinitionId, hop.attributeDefinitionId, entityInstanceId),
      );
      const v = data ? currentValues(data.values)[0]?.value : undefined;
      return v === undefined ? undefined : titleFromValue(v);
    },
  };
}

/** formatOne with cache lookups for an attribute of the given workspace. */
export function formatWithCache(attribute: AttributeDefinition, value: unknown): string {
  return formatOne(attribute, value, { lookup: cacheLookup(attribute.workspaceId) });
}
