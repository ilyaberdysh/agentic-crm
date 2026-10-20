// Resolves "which workspace is this request about, and is the user a member" for tRPC and the realtime gateway.
// An adapter over packages/domain's workspace service (I5): the domain owns the workspace and membership tables.
import type { Domain } from '@agentic-crm/domain';

export type AccessLevel = 'admin' | 'member' | 'suspended';

export interface WorkspaceRef {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
}

export interface MembershipRef {
  id: string;
  workspaceId: string;
  userId: string;
  accessLevel: AccessLevel;
}

export interface WorkspaceWithMembership {
  workspace: WorkspaceRef;
  membership: MembershipRef;
}

export type WorkspaceKey = { slug: string } | { id: string };

export type WorkspaceResolution =
  | ({ status: 'ok' } & WorkspaceWithMembership)
  | { status: 'not-found' }
  /** The workspace exists but the user has no active membership (absent or suspended). */
  | { status: 'not-member' };

export interface WorkspaceResolver {
  /** Workspaces the user is an active (non-suspended) member of. */
  listForUser(userId: string): Promise<WorkspaceWithMembership[]>;
  resolve(userId: string, key: WorkspaceKey): Promise<WorkspaceResolution>;
}

const toRef = (w: WorkspaceRef): WorkspaceRef => ({ id: w.id, slug: w.slug, name: w.name, logoUrl: w.logoUrl });
const toMembershipRef = (m: MembershipRef): MembershipRef => ({
  id: m.id,
  workspaceId: m.workspaceId,
  userId: m.userId,
  accessLevel: m.accessLevel,
});

/** `domain.workspaces.listForUser` / `resolveForUser` behind the transport-facing interface. */
export class DomainWorkspaceResolver implements WorkspaceResolver {
  constructor(private readonly domain: Pick<Domain, 'workspaces'>) {}

  async listForUser(userId: string): Promise<WorkspaceWithMembership[]> {
    const items = await this.domain.workspaces.listForUser(userId);
    return items.map((w) => ({ workspace: toRef(w), membership: toMembershipRef(w.membership) }));
  }

  async resolve(userId: string, key: WorkspaceKey): Promise<WorkspaceResolution> {
    const resolution = await this.domain.workspaces.resolveForUser(userId, key);
    if (resolution.status !== 'ok') return resolution;
    return {
      status: 'ok',
      workspace: toRef(resolution.workspace),
      membership: toMembershipRef(resolution.membership),
    };
  }
}
