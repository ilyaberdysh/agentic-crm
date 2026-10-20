// Pure operations on the grants of a dashboard (what the Share popover and the Permissions tab show): split into the
// workspace row, teams and members; the optimistic result of a level change, an added target or a removal; and the
// members and teams still free to add. The server's answer replaces all of it as soon as it arrives.
import {
  type AccessScope,
  kindFlagsForScope,
  type ListPermissionsOutput,
  maxAccessScope,
  type PermissionGrant,
} from '@agentic-crm/contracts';

export type Grants = ListPermissionsOutput;
export type Grant = PermissionGrant;
export type GrantTarget = { type: 'workspace' | 'team' | 'member'; id: string };

export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export interface TeamOption {
  id: string;
  name: string;
  memberCount: number;
}

export interface SplitGrants {
  workspace: Grant | undefined;
  teams: Grant[];
  members: Grant[];
}

/** The workspace row, then team and member rows by name (workflows never get a dashboard grant). */
export function splitGrants(grants: Pick<Grants, 'grants'> | undefined): SplitGrants {
  const rows = grants?.grants ?? [];
  const byName = (a: Grant, b: Grant) => (a.targetName ?? '').localeCompare(b.targetName ?? '');
  return {
    workspace: rows.find((g) => g.target.type === 'workspace'),
    teams: rows.filter((g) => g.target.type === 'team').sort(byName),
    members: rows.filter((g) => g.target.type === 'member').sort(byName),
  };
}

const same = (g: Grant, t: GrantTarget) => g.target.type === t.type && g.target.id === t.id;

/**
 * The grants after setting `target` to `level`: an existing row changes its level (flags follow), a new target gets a
 * row named from `label`. The effective level of the changed row is the more permissive of its own and the
 * workspace's (team inheritance of member rows is left to the server's answer).
 */
export function withGrant(
  grants: Grants,
  target: GrantTarget,
  level: AccessScope,
  label?: { name: string; detail: string | null },
): Grants {
  const workspaceLevel = splitGrants(grants).workspace?.level ?? 'full-access';
  const effective = (own: AccessScope): Grant['effective'] =>
    target.type === 'workspace'
      ? { level: own, source: { type: 'workspace', id: target.id, name: null } }
      : maxAccessScope(own, workspaceLevel) === own
        ? { level: own, source: { type: target.type, id: target.id, name: null } }
        : { level: workspaceLevel, source: { type: 'workspace', id: null, name: null } };
  const flags = kindFlagsForScope('dashboard', level);
  const existing = grants.grants.find((g) => same(g, target));
  if (existing) {
    return {
      ...grants,
      grants: grants.grants.map((g) => (g === existing ? { ...g, level, flags, effective: effective(level) } : g)),
    };
  }
  const added: Grant = {
    id: null,
    resourceKind: 'dashboard',
    resourceId: grants.resourceId,
    target: { type: target.type, id: target.id },
    level,
    flags,
    targetName: label?.name ?? null,
    targetDetail: label?.detail ?? null,
    effective: effective(level),
    createdBy: null,
    createdAt: null,
    updatedAt: null,
  };
  return { ...grants, grants: [...grants.grants, added] };
}

/** The grants without the team or member override. */
export function withoutGrant(grants: Grants, target: GrantTarget): Grants {
  return { ...grants, grants: grants.grants.filter((g) => !same(g, target)) };
}

/** Members and teams that have no grant yet, by name. */
export function freeTargets(
  grants: Pick<Grants, 'grants'> | undefined,
  members: readonly MemberOption[],
  teams: readonly TeamOption[],
): { members: MemberOption[]; teams: TeamOption[] } {
  const rows = grants?.grants ?? [];
  const taken = (type: 'member' | 'team', id: string) => rows.some((g) => g.target.type === type && g.target.id === id);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return {
    members: members.filter((m) => !taken('member', m.id)).sort(byName),
    teams: teams.filter((t) => !taken('team', t.id)).sort(byName),
  };
}

/** The search of the add row: names (and member emails) containing the text, case-insensitive. */
export function filterTargets(
  free: { members: readonly MemberOption[]; teams: readonly TeamOption[] },
  text: string,
): { members: MemberOption[]; teams: TeamOption[] } {
  const q = text.trim().toLowerCase();
  if (!q) return { members: [...free.members], teams: [...free.teams] };
  return {
    members: free.members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)),
    teams: free.teams.filter((t) => t.name.toLowerCase().includes(q)),
  };
}
