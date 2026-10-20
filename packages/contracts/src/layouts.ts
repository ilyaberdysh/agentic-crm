// Record page layouts (BACKLOG 3.10; specs D README §2.8, §4.1, A README §4.11). One layout per object: a flat
// element tree (locked groups → elements → child elements) saved by full replacement.
import { z } from 'zod';
import { acceptAfterSchema, idOrSlugSchema, pathSchema, rankSchema, timestampSchema, uuidSchema } from './common.ts';

export const layoutGroupIdentifiers = ['widgets-v2', 'static-tabs', 'tabs', 'actions', 'details-sidebar'] as const;
export const layoutGroupIdentifierSchema = z.enum(layoutGroupIdentifiers);
export type LayoutGroupIdentifier = z.infer<typeof layoutGroupIdentifierSchema>;

export const layoutElementTypes = [
  'group',
  // highlights (max 6)
  'value-widget-v2',
  // tabs
  'overview-tab',
  'activity-tab',
  'note-tab',
  'task-tab',
  'email-tab',
  'email-tab-value',
  'call-tab',
  'agent-tab',
  'file-tab',
  'relationship-tab',
  'relationship-tab-value',
  // header actions
  'email-action',
  'list-action',
  'note-action',
  'workflow-action',
  'task-action',
  'sequence-action',
  // details sidebar
  'details',
  'details-value',
  'detail-list-entries',
] as const;
export const layoutElementTypeSchema = z.enum(layoutElementTypes);
export type LayoutElementType = z.infer<typeof layoutElementTypeSchema>;

/** Max highlight widgets ("Add widget ({count}/6)", D §4.1). */
export const MAX_LAYOUT_WIDGETS = 6;

export const layoutElementSchema = z.object({
  elementId: uuidSchema,
  /** null for the six root groups. */
  parentElementId: uuidSchema.nullable(),
  type: layoutElementTypeSchema,
  /** Groups only. */
  groupIdentifier: layoutGroupIdentifierSchema.nullable(),
  /** Tab / section title, or a widget's custom label (null = the attribute title). */
  title: z.string().nullable(),
  /** Tabs: the `$activeTab` URL segment (unique in the layout). */
  slug: z.string().nullable(),
  sortOrder: z.string(),
  /** Locked elements cannot be edited or removed (groups, Overview, Lists section). */
  isLocked: z.boolean(),
  /** System elements accept only sort-order changes (Activity/Notes/Tasks tabs, actions). */
  isSystemElement: z.boolean(),
  /** Widgets, relationship tabs and attribute rows: the attribute path (multi-hop allowed). */
  path: pathSchema.nullable(),
  /** Sub-field of the attribute (e.g. 'interacted_at'). */
  field: z.string().nullable(),
  createdAt: timestampSchema,
});
export type LayoutElement = z.infer<typeof layoutElementSchema>;

export const customLayoutSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  entityDefinitionId: uuidSchema,
  type: z.literal('record-page'),
  title: z.string(),
  description: z.string(),
  isSystemLayout: z.boolean(),
  /** Increments on every save (optimistic concurrency for the editor). */
  version: z.number().int(),
  elements: z.array(layoutElementSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type CustomLayout = z.infer<typeof customLayoutSchema>;

/** The object's record-page layout; the default layout is created on first read if it does not exist yet. */
export const getLayoutInputSchema = z.object({ entityDefinitionId: idOrSlugSchema, acceptAfter: acceptAfterSchema });
export type GetLayoutInput = z.input<typeof getLayoutInputSchema>;

/** One element of a save; locks, system flags and creation times are the server's. */
export const layoutElementInputSchema = z.object({
  /** Client-minted for new elements. */
  elementId: uuidSchema,
  parentElementId: uuidSchema.nullable(),
  type: layoutElementTypeSchema,
  groupIdentifier: layoutGroupIdentifierSchema.nullable().default(null),
  title: z.string().max(250).nullable().default(null),
  slug: z
    .string()
    .max(128)
    .regex(/^[a-z0-9_-]+$/)
    .nullable()
    .default(null),
  sortOrder: rankSchema,
  path: pathSchema.nullable().default(null),
  field: z.string().max(64).nullable().default(null),
});
export type LayoutElementInput = z.input<typeof layoutElementInputSchema>;

/**
 * "Save changes" in the layout editor: the full element list (removed elements are simply omitted). With
 * `expectedVersion` a concurrent save answers 409.
 */
export const saveLayoutInputSchema = z.object({
  customLayoutId: uuidSchema,
  elements: z.array(layoutElementInputSchema).max(500),
  expectedVersion: z.number().int().optional(),
});
export type SaveLayoutInput = z.input<typeof saveLayoutInputSchema>;
