// Slice 6 settings contracts (BACKLOG 6.01–6.03, 6.09): profile, workspace general and security settings, members
// administration, teams (J workspace-admin §1–5, J permissions §1, §6).
import { z } from 'zod';
import { acceptAfterSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';
import { accessScopeSchema } from './permissions.ts';
import { workspaceMemberSchema, workspaceSchema, workspaceSlugSchema } from './workspaces.ts';

// ---------------------------------------------------------------------------------------------------------------
// Profile (J workspace-admin §1): name, avatar (a file uploaded to the member's own record), time preferences.

export const weekStartSchema = z.enum(['monday', 'saturday', 'sunday']);
export type WeekStart = z.infer<typeof weekStartSchema>;

export const profileSchema = z.object({
  memberId: uuidSchema,
  userId: uuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  emailAddress: z.string(),
  /** Storage entry of the avatar image on the member's record; null = initials. */
  avatarFileId: uuidSchema.nullable(),
  /** IANA zone; null = the browser's. */
  timeZone: z.string().nullable(),
  /** "Start week on" (Monday / Saturday / Sunday); null = from the locale. */
  weekStart: weekStartSchema.nullable(),
  /** BCP 47 tag; null = system default. */
  locale: z.string().nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

export const updateProfileInputSchema = z.object({
  /** "First Name" / "Last Name" (save on blur). */
  name: z.object({ firstName: z.string().trim().max(200), lastName: z.string().trim().max(200) }).optional(),
  /** A file on the member's own record (PNG, JPEG or GIF under 10 MB); null removes the avatar. */
  avatarFileId: uuidSchema.nullable().optional(),
  timeZone: z.string().min(1).max(64).nullable().optional(),
  weekStart: weekStartSchema.nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
});
export type UpdateProfileInput = z.input<typeof updateProfileInputSchema>;

/** Avatar and logo uploads: "We only support PNGs, JPEGs and GIFs under 10MB". */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/gif'] as const;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Workspace › General and Security (J workspace-admin §2, §5).

export const workspaceDetailSchema = workspaceSchema.extend({
  /** Storage entry of the logo when it was uploaded through files. */
  logoFileId: uuidSchema.nullable(),
  /** Export security: prefix cells that look like formulas (J workspace-admin §5). */
  exportFormulaInjectionPrefix: z.boolean(),
});
export type WorkspaceDetail = z.infer<typeof workspaceDetailSchema>;

export const updateWorkspaceGeneralInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Slug change: availability is checked; integrations using the old slug may be affected (type-to-confirm UI). */
  slug: workspaceSlugSchema.optional(),
  /** A file on the uploader's member record (PNG, JPEG or GIF under 10 MB); null removes the logo. */
  logoFileId: uuidSchema.nullable().optional(),
});
export type UpdateWorkspaceGeneralInput = z.input<typeof updateWorkspaceGeneralInputSchema>;

export const checkWorkspaceSlugInputSchema = z.object({ slug: z.string().max(128) });
export const checkWorkspaceSlugOutputSchema = z.object({
  slug: z.string(),
  valid: z.boolean(),
  /** True for the workspace's own current slug too. */
  available: z.boolean(),
  reason: z.enum(['invalid', 'reserved', 'taken', 'current']).nullable(),
});
export type CheckWorkspaceSlugOutput = z.infer<typeof checkWorkspaceSlugOutputSchema>;

export const updateWorkspaceSettingsInputSchema = z.object({
  /** "Protect CSV exports against formula injection" (J workspace-admin §5). */
  exportFormulaInjectionPrefix: z.boolean().optional(),
  /** Default workspace level for new resources per kind (X-06; null = the built-in default). */
  defaultWorkspaceAccess: z
    .object({
      object: accessScopeSchema.nullable().optional(),
      list: accessScopeSchema.nullable().optional(),
      dashboard: accessScopeSchema.nullable().optional(),
      workflow: accessScopeSchema.nullable().optional(),
      sequence: accessScopeSchema.nullable().optional(),
    })
    .optional(),
});
export type UpdateWorkspaceSettingsInput = z.input<typeof updateWorkspaceSettingsInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Teams (J permissions §6).

export const teamIconSchema = z.object({ id: z.string().min(1).max(64), color: z.string().min(1).max(32) });
export type TeamIcon = z.infer<typeof teamIconSchema>;

export const teamSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string(),
  icon: teamIconSchema.nullable(),
  sortOrder: z.string(),
  memberCount: z.number().int(),
  /** Places the team is referenced (object/list/dashboard/workflow/sequence grants). */
  usageCount: z.number().int(),
  createdBy: z.unknown(),
  createdAt: timestampSchema,
});
export type Team = z.infer<typeof teamSchema>;

export const teamMembershipSchema = z.object({
  id: uuidSchema,
  teamId: uuidSchema,
  memberId: uuidSchema,
  createdAt: timestampSchema,
  createdBy: z.unknown(),
});
export type TeamMembership = z.infer<typeof teamMembershipSchema>;

export const teamUsageItemSchema = z.object({
  /** object / list / dashboard / workflow / sequence permission. */
  type: z.enum([
    'object-permission',
    'list-permission',
    'dashboard-permission',
    'workflow-permission',
    'sequence-permission',
  ]),
  resourceId: uuidSchema,
  /** Display name of the resource (object plural noun, list name); null when unknown. */
  name: z.string().nullable(),
  level: accessScopeSchema,
});
export type TeamUsageItem = z.infer<typeof teamUsageItemSchema>;

export const teamDetailSchema = teamSchema.extend({
  members: z.array(teamMembershipSchema),
  usage: z.array(teamUsageItemSchema),
});
export type TeamDetail = z.infer<typeof teamDetailSchema>;

export const createTeamInputSchema = z.object({
  /** Client id (PUT-style, idempotent). */
  id: uuidSchema,
  name: z.string().trim().min(1, 'Please provide a name for the team.').max(200),
  description: z.string().trim().max(2000).default(''),
  icon: teamIconSchema.nullable().optional(),
  sortOrder: rankSchema.optional(),
  /** Members to add right away ("Add to team (optional)" in the invite dialog adds later). */
  memberIds: z.array(uuidSchema).max(500).optional(),
});
export type CreateTeamInput = z.input<typeof createTeamInputSchema>;

export const updateTeamInputSchema = z.object({
  teamId: uuidSchema,
  name: z.string().trim().min(1, 'Please provide a name for the team.').max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  icon: teamIconSchema.nullable().optional(),
  sortOrder: rankSchema.optional(),
});
export type UpdateTeamInput = z.input<typeof updateTeamInputSchema>;

export const teamIdInputSchema = z.object({ teamId: uuidSchema, acceptAfter: acceptAfterSchema });
export const teamMembersInputSchema = z.object({ teamId: uuidSchema, memberIds: z.array(uuidSchema).min(1).max(500) });
export type TeamMembersInput = z.input<typeof teamMembersInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Members administration (J workspace-admin §3, J permissions §1).

export const memberSummarySchema = workspaceMemberSchema.extend({
  /** Removed members keep their row (their id is the actor of their history) but leave every list. */
  removedAt: timestampSchema.nullable(),
  avatarFileId: uuidSchema.nullable(),
  teamIds: z.array(uuidSchema),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const memberDetailSchema = memberSummarySchema.extend({
  teams: z.array(z.object({ teamId: uuidSchema, name: z.string(), addedAt: timestampSchema })),
});
export type MemberDetail = z.infer<typeof memberDetailSchema>;

/**
 * members.list: every member, suspended and removed ones included (their names label history and actor values);
 * `includeRemoved: false` leaves removed members out (settings tables, pickers).
 */
export const listMembersInputSchema = z
  .object({ includeRemoved: z.boolean().default(true), acceptAfter: acceptAfterSchema })
  .optional();
export type ListMembersInput = z.input<typeof listMembersInputSchema>;
export const memberIdInputSchema = z.object({ memberId: uuidSchema });
