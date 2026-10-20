// Dashboard access levels: labels, the one-line explanations of the level menu, and the
// "Inheriting …" hint when a team or member gets more than their own grant says (J permissions).
import { type AccessScope, accessScopeRank, type PermissionGrant } from '@agentic-crm/contracts';

export const LEVELS: readonly AccessScope[] = ['full-access', 'read-write', 'read-only', 'no-access'];

export const LEVEL_LABEL: Record<AccessScope, string> = {
  'full-access': 'Full access',
  'read-write': 'Read and write',
  'read-only': 'Read only',
  'no-access': 'No access',
};

export const DASHBOARD_LEVEL_DESCRIPTION: Record<AccessScope, string> = {
  'full-access': 'Can manage reporting dashboard permissions',
  'read-write': 'Can update the reporting dashboard',
  'read-only': 'Can only view the reporting dashboard',
  'no-access': 'Has no access to the reporting dashboard',
};

export interface Inherited {
  level: AccessScope;
  /** Tooltip: `Inheriting "Full access" from the workspace`. */
  hint: string;
}

/** Where a more permissive effective level comes from, in the words of the tooltip. */
export function inheritedFrom(source: PermissionGrant['effective']['source']): string {
  switch (source.type) {
    case 'workspace':
      return 'from the workspace';
    case 'team':
      return source.name ? `from the "${source.name}" team` : 'from a team';
    default:
      return 'from another permission';
  }
}

/** Set when the target effectively gets more than its own grant: the effective level and why (else null). */
export function inheritanceOf(grant: PermissionGrant): Inherited | null {
  if (grant.target.type === 'workspace') return null;
  const effective = grant.effective;
  if (accessScopeRank[effective.level] <= accessScopeRank[grant.level]) return null;
  return {
    level: effective.level,
    hint: `Inheriting "${LEVEL_LABEL[effective.level]}" ${inheritedFrom(effective.source)}`,
  };
}
