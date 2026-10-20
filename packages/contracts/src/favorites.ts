// Favorites and favorite folders (BACKLOG 3.17; specs B sidebar §6, A README §4.15, D README §3.10b, E README §3.1;
// CROSS-DOMAIN B.18). Personal to the member; ordered by rank (X-01). Top level mixes folders and favorites.
import { z } from 'zod';
import { acceptAfterSchema, idOrSlugSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';

export const favoriteTypes = [
  'record',
  'entity-view',
  'collection-view',
  'note',
  'note-template',
  'email-template',
  'message-template',
  'reporting-dashboard',
  'report',
  'workflow',
  'sequence',
  'call-recording',
  'merlin-thread',
] as const;
export const favoriteTypeSchema = z.enum(favoriteTypes);
export type FavoriteType = z.infer<typeof favoriteTypeSchema>;

/** What the sidebar row shows (B sidebar §6 table); resolved by the server for the types it knows. */
export const favoriteTargetSummarySchema = z.object({
  /** 'missing' = deleted; 'forbidden' = no access ("Private item"); 'unknown' = type not resolved yet. */
  state: z.enum(['ok', 'missing', 'forbidden', 'unknown']),
  label: z.string().nullable(),
  /** Object singular noun (records), object plural / list name (views), parent record name (notes). */
  secondaryLabel: z.string().nullable(),
});
export type FavoriteTargetSummary = z.infer<typeof favoriteTargetSummarySchema>;

export const favoriteSchema = z.object({
  id: uuidSchema,
  favoriteType: favoriteTypeSchema,
  /** Records: their object; views: their object or list. */
  entityDefinitionId: uuidSchema.nullable(),
  targetId: uuidSchema,
  directoryId: uuidSchema.nullable(),
  sortOrder: z.string(),
  createdAt: timestampSchema,
  target: favoriteTargetSummarySchema,
});
export type Favorite = z.infer<typeof favoriteSchema>;

export const favoriteDirectorySchema = z.object({
  id: uuidSchema,
  title: z.string(),
  sortOrder: z.string(),
  createdAt: timestampSchema,
});
export type FavoriteDirectory = z.infer<typeof favoriteDirectorySchema>;

export const listFavoritesInputSchema = z.object({ acceptAfter: acceptAfterSchema }).optional();
export const listFavoritesOutputSchema = z.object({
  directories: z.array(favoriteDirectorySchema),
  favorites: z.array(favoriteSchema),
});
export type ListFavoritesOutput = z.infer<typeof listFavoritesOutputSchema>;

/**
 * Add a favorite (PUT with a client UUID, I3). Without `sortOrder` it goes to the top of its folder / the top level.
 * Favoriting an item that is already a favorite returns the existing favorite.
 */
export const putFavoriteInputSchema = z
  .object({
    id: uuidSchema,
    favoriteType: favoriteTypeSchema,
    targetId: uuidSchema,
    /** Required for records (their object, id or api_slug). */
    entityDefinitionId: idOrSlugSchema.optional(),
    directoryId: uuidSchema.nullable().default(null),
    sortOrder: rankSchema.optional(),
  })
  .refine((v) => v.favoriteType !== 'record' || v.entityDefinitionId !== undefined, {
    message: 'Record favorites need the entityDefinitionId',
    path: ['entityDefinitionId'],
  });
export type PutFavoriteInput = z.input<typeof putFavoriteInputSchema>;

/** Drag and drop: new parent folder (null = top level) and rank among the new siblings. */
export const moveFavoriteInputSchema = z.object({
  favoriteId: uuidSchema,
  directoryId: uuidSchema.nullable(),
  sortOrder: rankSchema,
});
export type MoveFavoriteInput = z.input<typeof moveFavoriteInputSchema>;

export const favoriteIdInputSchema = z.object({ favoriteId: uuidSchema });
export type FavoriteIdInput = z.input<typeof favoriteIdInputSchema>;

/** Star toggles: remove whatever favorite the member has for this item (idempotent). */
export const removeFavoriteByTargetInputSchema = z.object({ favoriteType: favoriteTypeSchema, targetId: uuidSchema });
export type RemoveFavoriteByTargetInput = z.input<typeof removeFavoriteByTargetInputSchema>;

export const putFavoriteDirectoryInputSchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1).max(200),
  /** Default: top of the list. */
  sortOrder: rankSchema.optional(),
});
export type PutFavoriteDirectoryInput = z.input<typeof putFavoriteDirectoryInputSchema>;

export const updateFavoriteDirectoryInputSchema = z.object({
  directoryId: uuidSchema,
  title: z.string().trim().min(1).max(200).optional(),
  sortOrder: rankSchema.optional(),
});
export type UpdateFavoriteDirectoryInput = z.input<typeof updateFavoriteDirectoryInputSchema>;

export const favoriteDirectoryIdInputSchema = z.object({ directoryId: uuidSchema });
export type FavoriteDirectoryIdInput = z.input<typeof favoriteDirectoryIdInputSchema>;
