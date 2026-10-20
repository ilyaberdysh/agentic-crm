// Server calls of the attribute editors that are not cached point reads: picker search (B.8, `search.records` /
// `search.members`) and inline option creation.
import type { SearchMemberHit, SearchRecordHit } from '@agentic-crm/contracts';
import { keys } from '../../../data/keys';
import { queryClient } from '../../../data/queryClient';
import { api, inWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import type { AttributeDefinition, SelectOption } from '../types';

export interface RecordSearchParams {
  query: string;
  /** Objects to search (a record-reference attribute's allowed objects); null/empty = every record object. */
  entityDefinitionIds: string[] | null;
  limit?: number;
  /** Already selected records (multi pickers list them separately). */
  excludeIds?: string[];
}

/** A search hit; `title` null = no display name (custom objects without a name show the record id). */
export type RecordSearchHit = Pick<SearchRecordHit, 'entityDefinitionId' | 'entityInstanceId'> &
  Partial<Pick<SearchRecordHit, 'title' | 'subtitle'>>;

export interface MemberSearchParams {
  query: string;
  limit?: number;
}
export type MemberSearchHit = SearchMemberHit;

// ---- search (B.8) -----------------------------------------------------------------------------------------------------
// The one call site of picker search: ranking is the server's (exact name > prefix > domain/email/phone > typo);
// an empty query answers the newest records.

export async function searchRecordsLive(
  workspace: WorkspaceRef,
  params: RecordSearchParams,
): Promise<RecordSearchHit[]> {
  const { hits } = await api.search.records.query(
    {
      query: params.query,
      limit: params.limit ?? 25,
      ...(params.entityDefinitionIds?.length ? { entityDefinitionIds: params.entityDefinitionIds } : {}),
      ...(params.excludeIds?.length ? { excludeIds: params.excludeIds } : {}),
    },
    inWorkspace(workspace),
  );
  return hits;
}

export async function searchMembersLive(
  workspace: WorkspaceRef,
  params: MemberSearchParams,
): Promise<MemberSearchHit[]> {
  const { hits } = await api.search.members.query(
    { query: params.query, limit: params.limit ?? 50 },
    inWorkspace(workspace),
  );
  return hits;
}

// ---- select options ----------------------------------------------------------------------------------------------

/** "+ Create “{query}”" in a select editor: creates the option and caches it. */
export async function createOptionLive(
  workspace: WorkspaceRef,
  attribute: AttributeDefinition,
  title: string,
): Promise<SelectOption> {
  const { option } = await api.schema.options.create.mutate(
    {
      entityDefinitionId: attribute.entityDefinitionId,
      attributeDefinitionId: attribute.id,
      id: newId(),
      title: title.trim(),
    },
    inWorkspace(workspace),
  );
  const key = keys.options(workspace.id, attribute.entityDefinitionId, attribute.id);
  queryClient.setQueryData<SelectOption[]>(key, (prev) =>
    prev ? [...prev.filter((o) => o.id !== option.id), option] : [option],
  );
  return option;
}
