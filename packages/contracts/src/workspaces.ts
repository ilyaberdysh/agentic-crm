// Workspaces, members and invites (BACKLOG 1.03–1.04; K legacy-welcome §6.5/§9/§10, J workspace-admin §3.2,
// J permissions §1).
import { z } from 'zod';
import { timestampSchema, uuidSchema } from './common.ts';

/** Kebab-case handle (K legacy-welcome §6.5); reserved slugs are rejected by the domain. */
export const workspaceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, digits and single hyphens');

export const accessLevelSchema = z.enum(['admin', 'member', 'suspended']);
export type AccessLevel = z.infer<typeof accessLevelSchema>;
export const inviteAccessLevelSchema = z.enum(['admin', 'member']);

export const emailAddressSchema = z.string().trim().toLowerCase().pipe(z.email());

/** The authenticated user, supplied by the auth layer (apps/api); auth tables are not read by the domain. */
export const userIdentitySchema = z.object({
  userId: uuidSchema,
  emailAddress: emailAddressSchema,
  firstName: z.string().max(200).default(''),
  lastName: z.string().max(200).default(''),
});
export type UserIdentity = z.input<typeof userIdentitySchema>;

export const workspaceSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  countryCode: z.string().nullable(),
  settings: z.record(z.string(), z.unknown()),
  onboardingFlags: z.record(z.string(), z.unknown()),
  createdAt: timestampSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const createWorkspaceInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
  slug: workspaceSlugSchema,
  logoUrl: z.url().nullable().optional(),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: workspaceSlugSchema.optional(),
  logoUrl: z.url().nullable().optional(),
});
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceInputSchema>;

export const workspaceMemberSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  userId: uuidSchema,
  accessLevel: accessLevelSchema,
  emailAddress: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  suspendedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

/** A workspace in the picker, with the caller's membership. */
export const workspaceWithMembershipSchema = workspaceSchema.extend({ membership: workspaceMemberSchema });
export type WorkspaceWithMembership = z.infer<typeof workspaceWithMembershipSchema>;

export const updateMemberInputSchema = z.object({
  memberId: uuidSchema,
  accessLevel: accessLevelSchema,
});
export type UpdateMemberInput = z.input<typeof updateMemberInputSchema>;

export const workspaceInviteSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  emailAddress: z.string(),
  accessLevel: inviteAccessLevelSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  createdByMemberId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  /** Teams joined on acceptance (slice 6; empty for older invites). */
  teamIds: z.array(uuidSchema).default([]),
});
export type WorkspaceInvite = z.infer<typeof workspaceInviteSchema>;

/** "Invite members" dialog: 1–10 addresses per request (J workspace-admin §3.2). */
export const createInvitesInputSchema = z.object({
  invites: z
    .array(
      z.object({
        id: uuidSchema.optional(),
        emailAddress: emailAddressSchema,
        accessLevel: inviteAccessLevelSchema.default('member'),
        firstName: z.string().max(200).optional(),
        lastName: z.string().max(200).optional(),
        /** "Add to team (optional)": teams joined on acceptance (slice 6). */
        teamIds: z.array(uuidSchema).max(100).optional(),
      }),
    )
    .min(1, 'Provide at least one email to invite')
    .max(10, 'Provide at most 10 emails to invite'),
});
export type CreateInvitesInput = z.input<typeof createInvitesInputSchema>;

export const acceptInviteInputSchema = z.object({ workspaceId: uuidSchema });
export type AcceptInviteInput = z.input<typeof acceptInviteInputSchema>;
