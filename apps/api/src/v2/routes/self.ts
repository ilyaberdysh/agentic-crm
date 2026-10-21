import { PUBLIC_API_ISSUER, v2Operations } from '@agentic-crm/contracts/v2';
import type { RouteSpec } from '../route';

/** Active-token introspection. The shared registration path handles unknown tokens as `{active: false}`. */
export const selfRoute: RouteSpec = {
  method: 'GET',
  url: '/self',
  operationId: 'getSelf',
  scopes: v2Operations.getSelf.scopes,
  async handler(v2) {
    const { token, workspace } = v2.identity;
    return {
      active: true,
      scope: token.scopes.join(' '),
      client_id: token.id,
      token_type: 'Bearer',
      exp: null,
      iat: Math.floor(Date.parse(token.createdAt.replace(/(\.\d{3})\d*Z$/, '$1Z')) / 1000),
      sub: workspace.id,
      aud: token.id,
      iss: PUBLIC_API_ISSUER,
      token_level: token.tokenLevel,
      ...(token.authorizedByMemberId ? { authorized_by_workspace_member_id: token.authorizedByMemberId } : {}),
      workspace_id: workspace.id,
      workspace_name: workspace.name,
      workspace_slug: workspace.slug,
      workspace_logo_url: workspace.logoUrl,
    };
  },
};
