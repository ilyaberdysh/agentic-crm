// POST /v2/objects/records/search (beta; B-shell README §6, CROSS-DOMAIN B.8): the public shape mapped onto the same
// search index and ranking as the in-product search (domain.search.records). `request_as` a workspace member searches
// with that member's permissions; `workspace` with the token's. Results are ordered by rank across the objects named.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { searchRecordsBody, v2Operations } from '@agentic-crm/contracts/v2';
import { memberContext } from '@agentic-crm/domain';
import { PUBLIC_OBJECT_TYPES } from '../context';
import { publicErrors } from '../errors';
import { parseInput, type RouteSpec } from '../route';

const MAX_LIMIT = 25;

export const searchRoutes: RouteSpec[] = [
  {
    method: 'POST',
    url: '/objects/records/search',
    operationId: 'searchRecords',
    scopes: v2Operations.searchRecords.scopes,
    kind: 'read',
    async handler(v2, request) {
      const body = parseInput(searchRecordsBody, request.body, 'request body');
      const all = await v2.allDefinitions();
      const defs: EntityDefinition[] = [];
      for (const key of body.objects) {
        const def = all.find(
          (d) => PUBLIC_OBJECT_TYPES.has(d.entityType) && (d.apiSlug === key || d.id === key.toLowerCase()),
        );
        if (!def) throw publicErrors.valueNotFound(`Object with slug/ID "${key}" not found.`);
        if (!defs.includes(def)) defs.push(def);
      }
      let ctx = v2.ctx;
      const as = body.request_as as { type: string; workspace_member_id?: string; email_address?: string };
      if (as.type === 'workspace-member') {
        const members = await v2.workspaceMembers();
        const member = members.find(
          (m) =>
            (as.workspace_member_id && m.id === as.workspace_member_id.toLowerCase()) ||
            (as.email_address && m.emailAddress.toLowerCase() === as.email_address.toLowerCase()),
        );
        if (!member) throw publicErrors.valueNotFound('The workspace member given in request_as was not found.');
        ctx = memberContext(v2.workspaceId, member.id);
      }
      const searchable = defs.filter((d) => !d.isArchived);
      if (searchable.length === 0) return { data: [] };
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(body.limit ?? MAX_LIMIT)));
      const { hits } = await v2.domain.search.records(ctx, {
        query: body.query,
        entityDefinitionIds: searchable.map((d) => d.id),
        limit,
      });
      const byId = new Map(searchable.map((d) => [d.id, d]));
      const data = hits.flatMap((hit) => {
        const def = byId.get(hit.entityDefinitionId);
        if (!def) return [];
        const base = {
          id: { workspace_id: v2.workspaceId, object_id: def.id, record_id: hit.entityInstanceId },
          record_text: hit.title ?? '',
          record_image: hit.avatar,
          object_slug: def.apiSlug,
        };
        if (def.entityType === 'person-record') {
          return [{ ...base, email_addresses: hit.emailAddresses, phone_numbers: hit.phoneNumbers }];
        }
        if (def.entityType === 'company-record') return [{ ...base, domains: hit.domains }];
        return [base];
      });
      return { data };
    },
  },
];
