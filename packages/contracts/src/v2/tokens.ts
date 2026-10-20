// Workspace API tokens for the public REST API (/v2): Attio's scope catalogue (`<resource>:<read|read-write>`,
// 18 resources × 2 levels, documented in api.json securitySchemes; labels in K oauth-consent §2.8) and the domain
// contracts for creating, listing, editing and revoking tokens (J workspace-admin §6 "Access tokens").
import { z } from 'zod';
import { timestampSchema, uuidSchema } from '../common.ts';

export const apiScopeResources = [
  'user_management',
  'record_permission',
  'object_configuration',
  'list_entry',
  'list_configuration',
  'public_collection',
  'private_collection',
  'comment',
  'task',
  'note',
  'meeting',
  'call_recording',
  'webhook',
  'file',
  'email',
  'activity_configuration',
  'activity_record',
  'sequence_unsubscribe',
] as const;
export type ApiScopeResource = (typeof apiScopeResources)[number];
export type ApiScope = `${ApiScopeResource}:read` | `${ApiScopeResource}:read-write`;

export const apiScopes = apiScopeResources.flatMap((r) => [`${r}:read`, `${r}:read-write`]) as ApiScope[];
export const apiScopeSchema = z.enum(apiScopes as [ApiScope, ...ApiScope[]]);

export const tokenLevelSchema = z.enum(['workspace', 'user']);
export type TokenLevel = z.infer<typeof tokenLevelSchema>;

/** `read-write` includes `read` (a token with `records:read-write` may call endpoints requiring `records:read`). */
export function scopeSatisfies(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  const [resource, level] = required.split(':');
  return level === 'read' && granted.includes(`${resource}:read-write`);
}

/** Required scopes the token does not have. */
export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !scopeSatisfies(granted, scope));
}

/** Drops duplicates and `:read` scopes covered by `:read-write`; stable catalogue order. */
export function normalizeScopes(scopes: readonly string[]): ApiScope[] {
  const set = new Set(scopes);
  return apiScopes.filter((s) => set.has(s) && !(s.endsWith(':read') && set.has(`${s}-write`)));
}

const scopesSchema = z
  .array(apiScopeSchema)
  .min(1, 'Please select at least one scope')
  .max(apiScopes.length * 2)
  .transform(normalizeScopes);

export const createApiTokenInputSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1, "Name can't be empty").max(256),
  scopes: scopesSchema,
  /** Who authorised the token; only system callers (CLI, seed) may set it, members authorise their own tokens. */
  authorizedByMemberId: uuidSchema.nullable().optional(),
  /**
   * `user` tokens act with the permissions of `authorizedByMemberId` (Attio: only OAuth tokens are user-level, so only
   * system callers may mint them); the settings page creates workspace-level tokens.
   */
  tokenLevel: tokenLevelSchema.optional(),
});
export type CreateApiTokenInput = z.input<typeof createApiTokenInputSchema>;

export const updateApiTokenInputSchema = z.object({
  tokenId: uuidSchema,
  name: z.string().trim().min(1, "Name can't be empty").max(256).optional(),
  scopes: scopesSchema.optional(),
});
export type UpdateApiTokenInput = z.input<typeof updateApiTokenInputSchema>;

/** A token as listed in settings (the secret is never returned again after creation). */
export const apiTokenSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  scopes: z.array(apiScopeSchema),
  tokenLevel: tokenLevelSchema,
  /** First characters of the secret, for recognising a token. */
  tokenPrefix: z.string(),
  authorizedByMemberId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
});
export type ApiToken = z.infer<typeof apiTokenSchema>;

export const createdApiTokenSchema = apiTokenSchema.extend({ token: z.string() });
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>;

/** What an authenticated /v2 request knows about its token and workspace. */
export const apiTokenIdentitySchema = z.object({
  token: apiTokenSchema,
  workspace: z.object({
    id: uuidSchema,
    slug: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
  }),
});
export type ApiTokenIdentity = z.infer<typeof apiTokenIdentitySchema>;
