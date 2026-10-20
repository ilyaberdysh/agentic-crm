// GET /v2/workspace_members, GET /v2/workspace_members/{workspace_member_id} (A public-api-mapping §3 #56–57).
import { getWorkspaceMemberPathParams, v2Operations } from '@agentic-crm/contracts/v2';
import { publicErrors } from '../errors';
import { memberToPublic } from '../mappers';
import { params, type RouteSpec } from '../route';

export const memberRoutes: RouteSpec[] = [
  {
    method: 'GET',
    url: '/workspace_members',
    operationId: 'listWorkspaceMembers',
    scopes: v2Operations.listWorkspaceMembers.scopes,
    async handler(v2) {
      // Removed members (slice 6) are no longer workspace members; their ids stay resolvable as actors elsewhere.
      const members = (await v2.workspaceMembers()).filter((m) => !m.removedAt);
      return { data: members.map(memberToPublic) };
    },
  },
  {
    method: 'GET',
    url: '/workspace_members/:workspace_member_id',
    operationId: 'getWorkspaceMember',
    scopes: v2Operations.getWorkspaceMember.scopes,
    async handler(v2, request) {
      // A malformed id cannot name a member: same 404 as an unknown one.
      const parsed = getWorkspaceMemberPathParams.safeParse(params(request));
      if (!parsed.success) throw publicErrors.memberNotFound(params(request).workspace_member_id ?? '');
      const id = parsed.data.workspace_member_id;
      const member = (await v2.workspaceMembers()).find((m) => m.id === id.toLowerCase() && !m.removedAt);
      if (!member) throw publicErrors.memberNotFound(id);
      return { data: memberToPublic(member) };
    },
  },
];
