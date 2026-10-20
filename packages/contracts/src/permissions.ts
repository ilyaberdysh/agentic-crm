// Object/list action policies (J permissions §2–3, A §4.12): four access levels, each a preset of 22 boolean
// action flags. The client fetches resolved policies per entity definition and gates controls with can(flag).
import { z } from 'zod';
import { idOrSlugSchema, resultSchema, uuidSchema } from './common.ts';

export const actionFlags = [
  'administrate_entity_definition_permissions',
  'read_entity_definition',
  'update_entity_definition',
  'delete_entity_definition',
  'read_attribute_definition',
  'create_attribute_definition',
  'update_attribute_definition',
  'archive_attribute_definition',
  'read_attribute_value',
  'create_attribute_value',
  'update_attribute_value',
  'read_entity_instance',
  'create_entity_instance',
  'update_entity_instance',
  'delete_entity_instance',
  'batch_delete_entity_instances',
  'create_entity_view',
  'update_entity_view',
  'delete_entity_view',
  'create_custom_layout',
  'update_custom_layout',
  'delete_custom_layout',
] as const;
export type ActionFlag = (typeof actionFlags)[number];

export const accessScopes = ['full-access', 'read-write', 'read-only', 'no-access'] as const;
export const accessScopeSchema = z.enum(accessScopes);
export type AccessScope = z.infer<typeof accessScopeSchema>;

const READ: ActionFlag[] = [
  'read_entity_definition',
  'read_attribute_definition',
  'read_attribute_value',
  'read_entity_instance',
  'create_entity_view',
  'update_entity_view',
  'delete_entity_view',
];
const WRITE: ActionFlag[] = [
  ...READ,
  'create_attribute_value',
  'update_attribute_value',
  'create_entity_instance',
  'update_entity_instance',
  'delete_entity_instance',
  'batch_delete_entity_instances',
];

/** Preset table from J permissions §2 (flags allowed per scope). */
export const scopePresets: Record<AccessScope, ReadonlySet<ActionFlag>> = {
  'no-access': new Set(),
  'read-only': new Set(READ),
  'read-write': new Set(WRITE),
  'full-access': new Set(actionFlags),
};

export type ActionFlags = Record<ActionFlag, boolean>;

export function flagsForScope(scope: AccessScope): ActionFlags {
  const allowed = scopePresets[scope];
  return Object.fromEntries(actionFlags.map((f) => [f, allowed.has(f)])) as ActionFlags;
}

export const resolvedActionPolicySchema = z.object({
  workspaceMembershipId: uuidSchema.nullable(),
  ...(Object.fromEntries(actionFlags.map((f) => [f, z.boolean()])) as Record<ActionFlag, z.ZodBoolean>),
});
export type ResolvedActionPolicy = z.infer<typeof resolvedActionPolicySchema>;

export const resolvePoliciesInputSchema = z.object({ entityDefinitionIds: z.array(idOrSlugSchema).min(1).max(500) });
export type ResolvePoliciesInput = z.infer<typeof resolvePoliciesInputSchema>;
export const resolvePoliciesOutputSchema = z.object({
  policies: z.record(z.string(), resultSchema(resolvedActionPolicySchema)),
});
export type ResolvePoliciesOutput = z.infer<typeof resolvePoliciesOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Slice 6: grants per resource kind (B.12; J permissions §3–5; H api §1.5, G internal-api §6, F sequences §5).
// Objects and lists share the 22 entity-definition flags; dashboards, workflows and sequences have four flags each
// (administrate / read / update / delete). A grant targets the workspace, a team, a member or a workflow; a member's
// effective level is the most permissive of the workspace grant, the grants of their teams and their own grant.

export const resourceKinds = ['object', 'list', 'dashboard', 'workflow', 'sequence'] as const;
export const resourceKindSchema = z.enum(resourceKinds);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

/** Flags per kind, in Attio's order. */
export const resourceKindFlags = {
  object: actionFlags,
  list: actionFlags,
  dashboard: [
    'administrate_reporting_dashboard_permissions',
    'read_reporting_dashboard',
    'update_reporting_dashboard',
    'delete_reporting_dashboard',
  ],
  workflow: ['administrate_workflow_permissions', 'read_workflow', 'update_workflow', 'delete_workflow'],
  sequence: ['administrate_sequence_permissions', 'read_sequence', 'update_sequence', 'delete_sequence'],
} as const satisfies Record<ResourceKind, readonly string[]>;

/**
 * Flags allowed per level for a kind. Objects and lists use the 22-flag preset table; the four-flag kinds map
 * Full = all, Read and write = read + update, Read only = read, No access = none (H api §1.5).
 */
export function kindFlagsForScope(kind: ResourceKind, scope: AccessScope): Record<string, boolean> {
  if (kind === 'object' || kind === 'list') return flagsForScope(scope);
  const flags: readonly string[] = resourceKindFlags[kind];
  const [administrate, read, update, del] = flags as [string, string, string, string];
  const allowed: Record<AccessScope, string[]> = {
    'full-access': [administrate, read, update, del],
    'read-write': [read, update],
    'read-only': [read],
    'no-access': [],
  };
  return Object.fromEntries(flags.map((f) => [f, allowed[scope].includes(f)]));
}

/** The flag that lets a member manage a resource's grants. */
export function administrateFlagOf(kind: ResourceKind): string {
  return kind === 'object' || kind === 'list'
    ? 'administrate_entity_definition_permissions'
    : (resourceKindFlags[kind][0] as string);
}

export const accessScopeRank: Record<AccessScope, number> = {
  'no-access': 0,
  'read-only': 1,
  'read-write': 2,
  'full-access': 3,
};

/** The more permissive of two levels. */
export function maxAccessScope(a: AccessScope, b: AccessScope): AccessScope {
  return accessScopeRank[a] >= accessScopeRank[b] ? a : b;
}

/**
 * Defaults per resource kind (decision X-06, slice6-contracts.md): the workspace level a newly created resource gets,
 * the creator's own level, and the level assumed when a resource has no workspace grant at all (objects that existed
 * before slice 6, standard objects). A workspace may override `createWorkspaceScope` in
 * settings.defaultWorkspaceAccess.<kind> (Attio's default_*_workspace_permission_scope, K sessions §1.2).
 */
export const resourceKindDefaults: Record<
  ResourceKind,
  { createWorkspaceScope: AccessScope; creatorScope: AccessScope; implicitWorkspaceScope: AccessScope }
> = {
  object: { createWorkspaceScope: 'read-write', creatorScope: 'full-access', implicitWorkspaceScope: 'full-access' },
  list: { createWorkspaceScope: 'read-write', creatorScope: 'full-access', implicitWorkspaceScope: 'no-access' },
  dashboard: {
    createWorkspaceScope: 'full-access',
    creatorScope: 'full-access',
    implicitWorkspaceScope: 'full-access',
  },
  workflow: { createWorkspaceScope: 'full-access', creatorScope: 'full-access', implicitWorkspaceScope: 'full-access' },
  sequence: { createWorkspaceScope: 'full-access', creatorScope: 'full-access', implicitWorkspaceScope: 'full-access' },
};

/** Grant targets as the procedures name them (`member` is stored as Attio's `workspace-member`). */
export const permissionTargetTypes = ['workspace', 'team', 'member', 'workflow'] as const;
export type PermissionTargetType = (typeof permissionTargetTypes)[number];
export const permissionTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace'), id: uuidSchema.nullish() }),
  z.object({ type: z.literal('team'), id: uuidSchema }),
  z.object({ type: z.literal('member'), id: uuidSchema }),
  z.object({ type: z.literal('workflow'), id: uuidSchema }),
]);
export type PermissionTarget = z.input<typeof permissionTargetSchema>;

/** Where an effective level comes from (the ⚠ inheritance tooltip, J permissions §5). */
export const permissionSourceSchema = z.object({
  /**
   * workspace / team / member / workflow = that grant; default = no workspace grant (the kind's default level);
   * token = a workspace-level API token (governed by its scopes); system = internal callers.
   */
  type: z.enum(['workspace', 'team', 'member', 'workflow', 'default', 'token', 'system']),
  id: uuidSchema.nullable(),
  /** Team name for team sources (tooltip 'Inheriting "…" from the "{team}" team'). */
  name: z.string().nullable(),
});
export type PermissionSource = z.infer<typeof permissionSourceSchema>;

export const effectiveAccessSchema = z.object({ level: accessScopeSchema, source: permissionSourceSchema });
export type EffectiveAccess = z.infer<typeof effectiveAccessSchema>;

export const permissionGrantSchema = z.object({
  /** null for the synthesised workspace row of a resource without a workspace grant. */
  id: uuidSchema.nullable(),
  resourceKind: resourceKindSchema,
  resourceId: uuidSchema,
  target: z.object({ type: z.enum(permissionTargetTypes), id: uuidSchema }),
  level: accessScopeSchema,
  /** The level's flags (22 for objects and lists, 4 for the other kinds). */
  flags: z.record(z.string(), z.boolean()),
  /** Team rows: the team's name; member rows: the member's name. */
  targetName: z.string().nullable(),
  /** Team rows: member count; member rows: the member's email. */
  targetDetail: z.string().nullable(),
  /** What this target effectively gets (team rows: with the workspace; member rows: with workspace and teams). */
  effective: effectiveAccessSchema,
  createdBy: z.unknown(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type PermissionGrant = z.infer<typeof permissionGrantSchema>;

export const resourceRefInputSchema = z.object({ resourceKind: resourceKindSchema, resourceId: idOrSlugSchema });

export const listPermissionsInputSchema = resourceRefInputSchema;
export type ListPermissionsInput = z.input<typeof listPermissionsInputSchema>;
export const listPermissionsOutputSchema = z.object({
  resourceKind: resourceKindSchema,
  resourceId: uuidSchema,
  /** Object plural noun or list name (the page header even for admins without access). */
  resourceName: z.string(),
  /** Levels offered for this kind. */
  levels: z.array(accessScopeSchema),
  /** The caller may change these grants (admin, or Full access on the resource). */
  canManage: z.boolean(),
  /** The workspace row first (synthesised from the kind default when there is none), then teams, members, workflows. */
  grants: z.array(permissionGrantSchema),
});
export type ListPermissionsOutput = z.infer<typeof listPermissionsOutputSchema>;

export const putPermissionInputSchema = resourceRefInputSchema.extend({
  target: permissionTargetSchema,
  level: accessScopeSchema,
});
export type PutPermissionInput = z.input<typeof putPermissionInputSchema>;

export const removePermissionInputSchema = resourceRefInputSchema.extend({ target: permissionTargetSchema });
export type RemovePermissionInput = z.input<typeof removePermissionInputSchema>;

export const resolvePermissionsInputSchema = z.object({
  resourceKind: resourceKindSchema,
  resourceIds: z.array(idOrSlugSchema).min(1).max(500),
});
export type ResolvePermissionsInput = z.input<typeof resolvePermissionsInputSchema>;

export const resolvedPermissionSchema = z.object({
  workspaceMembershipId: uuidSchema.nullable(),
  level: accessScopeSchema,
  source: permissionSourceSchema,
  flags: z.record(z.string(), z.boolean()),
  /** May open the Permissions tab and change grants (admins always can, OQ-067). */
  canManagePermissions: z.boolean(),
});
export type ResolvedPermission = z.infer<typeof resolvedPermissionSchema>;
export const resolvePermissionsOutputSchema = z.object({
  resourceKind: resourceKindSchema,
  resolved: z.record(z.string(), resultSchema(resolvedPermissionSchema)),
});
export type ResolvePermissionsOutput = z.infer<typeof resolvePermissionsOutputSchema>;
