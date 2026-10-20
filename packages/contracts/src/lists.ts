// Lists, entries and kanban boards (BACKLOG §4; specs A §4.4–4.5, C2 README §2, kanban K1–K8, J objects-lists §4,
// J permissions §2). Decisions: slice4-contracts.md (X-02 new ids on duplicate, X-06 default access, X-08 archived
// stages, C.4 #11 no persisted in-column order, X-23 kanban calculations follow the table rule).
//   list  = collection metadata + the `collection-entry` entity definition with the same id: list attributes are
//           ordinary attributes of that definition (schema.attributes.* with entityDefinitionId = listId);
//   entry = an entity instance of the list's definition; its parent record is the system attribute `parent_record`.
// Entry values are read and written with records.* / values.* using the list id as the definition id; views,
// snapshots, filters, sorts and aggregates over entries are views.* / snapshots.* with entityDefinitionId = listId.
import { z } from 'zod';
import { recordRefInputSchema, recordRefSchema } from './collab.ts';
import {
  acceptAfterSchema,
  actorSchema,
  idOrSlugSchema,
  pathSchema,
  rankSchema,
  timestampSchema,
  uuidSchema,
} from './common.ts';
import { accessScopeSchema } from './permissions.ts';
import { apiSlugSchema, attributeTypeSchema, lifecyclePhaseSchema } from './schema.ts';
import { attributeValueSchema, valuesMapSchema } from './values.ts';
import {
  aggregateOutputSchema,
  kanbanCalculationSchema,
  predicateSchema,
  snapshotChunkInputSchema,
  sortSchema,
  viewSchema,
} from './views.ts';

// ---------------------------------------------------------------------------------------------------------------
// Lists

/** Default list icon (C2 §4: `emoji:clipboard`, rendered 📋). */
export const DEFAULT_LIST_ICON = 'emoji:clipboard';
/** Default workspace access of a new list (observed, X-06); the creator always gets Full access. */
export const DEFAULT_LIST_WORKSPACE_ACCESS = 'read-write' as const;

export const listNameSchema = z.string().trim().min(1, 'Please provide a name for this list.').max(200);
export const listIconSchema = z.string().trim().min(1).max(64);

export const listMemberAccessSchema = z.object({ memberId: uuidSchema, scope: accessScopeSchema });
export type ListMemberAccess = z.infer<typeof listMemberAccessSchema>;

export const listSchema = z.object({
  /** = the collection-entry entity definition id (public `list_id`). */
  id: uuidSchema,
  workspaceId: uuidSchema,
  name: z.string(),
  /** `emoji:<shortname>`; null renders the default 📋. */
  icon: z.string().nullable(),
  apiSlug: z.string(),
  /** Sidebar rank (X-01). */
  sortOrder: z.string(),
  /** Objects whose records can be added (public `parent_object`). */
  parentEntityDefinitionIds: z.array(uuidSchema),
  /** The list's system `parent_record` attribute (path hop into the parent record). */
  parentRecordAttributeId: uuidSchema,
  /** Workspace grant ("Workspace access"). */
  workspaceAccess: accessScopeSchema,
  /** Individual member grants. */
  memberAccess: z.array(listMemberAccessSchema),
  /** The caller's effective access (most permissive of its grants). */
  myAccess: accessScopeSchema,
  /** Live entries (settings "Entries" column). */
  entryCount: z.number().int(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type List = z.infer<typeof listSchema>;

/** Sidebar / settings listing in rank order. `all` (admins only): also lists the caller cannot open. */
export const listListsInputSchema = z
  .object({ scope: z.enum(['readable', 'all']).default('readable'), acceptAfter: acceptAfterSchema })
  .default({ scope: 'readable' });
export type ListListsInput = z.input<typeof listListsInputSchema>;

export const listRefInputSchema = z.object({ listId: idOrSlugSchema, acceptAfter: acceptAfterSchema });
export type ListRefInput = z.input<typeof listRefInputSchema>;

/**
 * Create a list (C2 §2.1 "Start from scratch"; public POST /v2/lists). Creates the definition with the system
 * attributes Entry ID, Parent Record, Added to list at, Added to list by; grants (creator Full access + workspace
 * `workspaceAccess`, default Read and write — X-06); and, unless `createDefaultView` is false, the table view
 * "All entries table". Idempotent per `id`.
 */
export const createListInputSchema = z.object({
  id: uuidSchema.optional(),
  name: listNameSchema,
  icon: listIconSchema.nullable().optional(),
  apiSlug: apiSlugSchema.optional(),
  parentEntityDefinitionIds: z.array(idOrSlugSchema).min(1).max(20),
  workspaceAccess: accessScopeSchema.optional(),
  /** Extra member grants (public `workspace_member_access`). */
  memberAccess: z.array(listMemberAccessSchema).max(500).optional(),
  createDefaultView: z.boolean().default(true),
  /** Client-minted id of the default view. */
  defaultViewId: uuidSchema.optional(),
});
export type CreateListInput = z.input<typeof createListInputSchema>;

export const updateListInputSchema = z.object({
  listId: idOrSlugSchema,
  name: listNameSchema.optional(),
  icon: listIconSchema.nullable().optional(),
  apiSlug: apiSlugSchema.optional(),
  /** Changing the parent object (J objects-lists §4.2); existing entries keep their parents. */
  parentEntityDefinitionIds: z.array(idOrSlugSchema).min(1).max(20).optional(),
  /** Sidebar reorder: the moved list's new rank. */
  sortOrder: rankSchema.optional(),
});
export type UpdateListInput = z.input<typeof updateListInputSchema>;

/**
 * Duplicate (C2 §2.7; decision X-02): every id is new (definition, attributes, options, stages, views); entries are
 * copied only with `includeEntries`. `name` defaults to the first free of "<name> (2)", "<name> (3)", ….
 */
export const duplicateListInputSchema = z.object({
  listId: idOrSlugSchema,
  name: listNameSchema.optional(),
  includeEntries: z.boolean().default(false),
  /** Client-minted id of the copy (idempotent replays). */
  id: uuidSchema.optional(),
});
export type DuplicateListInput = z.input<typeof duplicateListInputSchema>;

export const deleteListInputSchema = z.object({ listId: idOrSlugSchema });
export type DeleteListInput = z.input<typeof deleteListInputSchema>;

/**
 * List access (J permissions §2, §5): the workspace level and per-member overrides (`scope: null` removes a member's
 * override). Needs Full access on the list, or a workspace admin (admins can always grant themselves access).
 */
export const setListAccessInputSchema = z.object({
  listId: idOrSlugSchema,
  workspaceAccess: accessScopeSchema.optional(),
  memberAccess: z
    .array(z.object({ memberId: uuidSchema, scope: accessScopeSchema.nullable() }))
    .max(500)
    .optional(),
});
export type SetListAccessInput = z.input<typeof setListAccessInputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Entries

export const entrySchema = z.object({
  /** Entry id (entity instance id in the list's definition). */
  id: uuidSchema,
  listId: uuidSchema,
  parentRecord: recordRefSchema,
  createdAt: timestampSchema,
  createdBy: actorSchema,
  /** Current values of the list attributes, keyed by attribute definition id. */
  values: z.record(z.string(), z.array(attributeValueSchema)),
});
export type Entry = z.infer<typeof entrySchema>;

/** A parent record that already has entries in the list (Duplicates step / bulk "Duplicate entries" dialog). */
export const entryDuplicateSchema = z.object({ parentRecord: recordRefSchema, entries: z.array(entrySchema) });
export type EntryDuplicate = z.infer<typeof entryDuplicateSchema>;

export const ADD_ENTRIES_MAX = 500;

/**
 * Add records to a list (C2 §2.5 A–C; A §4.4). `values` (keyed by list attribute id or slug) are written on every new
 * entry (prefilled stage, Add-to-list form). Records that already have entries are duplicates:
 *   onDuplicate 'cancel' → nothing is created when any duplicate exists (the response lists them);
 *   'skip'               → only records without entries are added;
 *   'keep'               → every record gets a new entry ("Create duplicate list entries", "Create new entry").
 * `entryIds` (client-minted, same order as parentRecords) make the call idempotent.
 */
export const addEntriesInputSchema = z.object({
  listId: idOrSlugSchema,
  parentRecords: z.array(recordRefInputSchema).min(1).max(ADD_ENTRIES_MAX),
  entryIds: z.array(uuidSchema).max(ADD_ENTRIES_MAX).optional(),
  values: valuesMapSchema.optional(),
  onDuplicate: z.enum(['cancel', 'keep', 'skip']).default('cancel'),
});
export type AddEntriesInput = z.input<typeof addEntriesInputSchema>;
export const addEntriesOutputSchema = z.object({
  entries: z.array(entrySchema),
  duplicates: z.array(entryDuplicateSchema),
  /** A value written on a new entry entered a stage with Confetti on (C2 §2.5 "Entering a stage with Confetti"). */
  celebrate: z.boolean(),
});
export type AddEntriesOutput = z.infer<typeof addEntriesOutputSchema>;

export const checkDuplicatesInputSchema = z.object({
  listId: idOrSlugSchema,
  parentRecords: z.array(recordRefInputSchema).min(1).max(5000),
  acceptAfter: acceptAfterSchema,
});
export type CheckDuplicatesInput = z.input<typeof checkDuplicatesInputSchema>;
export const checkDuplicatesOutputSchema = z.object({
  duplicates: z.array(entryDuplicateSchema),
  /** Distinct given records that already have an entry ("<n> records are already in this list"). */
  duplicateCount: z.number().int(),
});
export type CheckDuplicatesOutput = z.infer<typeof checkDuplicatesOutputSchema>;

/** Remove from list (C2 §2.6): entries are deleted with their list attribute data (soft, X-22). */
export const removeEntriesInputSchema = z.object({
  listId: idOrSlugSchema,
  entryIds: z.array(uuidSchema).min(1).max(ADD_ENTRIES_MAX),
});
export type RemoveEntriesInput = z.input<typeof removeEntriesInputSchema>;
export const removeEntriesOutputSchema = z.object({ removedIds: z.array(uuidSchema) });
export type RemoveEntriesOutput = z.infer<typeof removeEntriesOutputSchema>;

export const getEntryInputSchema = z.object({
  listId: idOrSlugSchema,
  entryId: uuidSchema,
  acceptAfter: acceptAfterSchema,
});
export type GetEntryInput = z.input<typeof getEntryInputSchema>;

export const listSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  icon: z.string().nullable(),
  apiSlug: z.string(),
  sortOrder: z.string(),
});
export type ListSummary = z.infer<typeof listSummarySchema>;

/** Entries of a record across the lists the caller can read (record page Lists section, A §4.4 list-entries). */
export const entriesForRecordInputSchema = z.object({
  recordRef: recordRefInputSchema,
  acceptAfter: acceptAfterSchema,
});
export type EntriesForRecordInput = z.input<typeof entriesForRecordInputSchema>;
export const entryMembershipSchema = z.object({
  listId: uuidSchema,
  entryId: uuidSchema,
  list: listSummarySchema,
  entry: entrySchema,
});
export type EntryMembership = z.infer<typeof entryMembershipSchema>;
export const entriesForRecordOutputSchema = z.object({ memberships: z.array(entryMembershipSchema) });
export type EntriesForRecordOutput = z.infer<typeof entriesForRecordOutputSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Kanban boards (objects and lists)

/** A board column's stage (status stage or select option). Archived stages never become columns (X-08). */
export const kanbanStageSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  color: z.string(),
  sortOrder: z.string(),
  isHidden: z.boolean(),
  lifecyclePhase: lifecyclePhaseSchema.nullable(),
  targetTimeInStatus: z.string().nullable(),
  celebrationEnabled: z.boolean(),
});
export type KanbanStage = z.infer<typeof kanbanStageSchema>;

/**
 * Board columns (C2 kanban K2): one snapshot per visible column — `{stageId (null = No stage), total, firstIds,
 * aggregate}`. The view's filter and sorts apply (drafts override them, like snapshots.query); in-column order is the
 * sort order, never a persisted rank (C.4 #11). `calculation` (or the view's) yields `aggregate` per column (X-23).
 */
export const kanbanColumnsInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  viewId: uuidSchema.optional(),
  groupBy: pathSchema.optional(),
  filter: predicateSchema.nullable().optional(),
  sorts: z.array(sortSchema).max(5).optional(),
  hiddenStageIds: z.array(uuidSchema).max(500).optional(),
  showNoStage: z.boolean().optional(),
  calculation: kanbanCalculationSchema.nullable().optional(),
  timeZone: z.string().min(1).max(64).optional(),
  /** Ids returned per column (more via kanban.columnChunk). */
  cardsPerColumn: z.number().int().min(0).max(1000).default(100),
  /** Also return hidden stages' columns (Visible columns preview). */
  includeHidden: z.boolean().default(false),
  acceptAfter: acceptAfterSchema,
});
export type KanbanColumnsInput = z.input<typeof kanbanColumnsInputSchema>;

export const kanbanColumnSchema = z.object({
  stageId: uuidSchema.nullable(),
  snapshotId: uuidSchema,
  total: z.number().int(),
  firstIds: z.array(uuidSchema),
  aggregate: aggregateOutputSchema.nullable(),
});
export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;

export const kanbanColumnsOutputSchema = z.object({
  entityDefinitionId: uuidSchema,
  groupBy: pathSchema,
  /** The grouping attribute (leaf of groupBy). */
  attribute: z.object({
    entityDefinitionId: uuidSchema,
    attributeDefinitionId: uuidSchema,
    type: attributeTypeSchema,
    isRequired: z.boolean(),
  }),
  /** Every non-archived stage in order, with its visibility on this board. */
  stages: z.array(kanbanStageSchema),
  columns: z.array(kanbanColumnSchema),
  calculation: kanbanCalculationSchema.nullable(),
  accurateAt: timestampSchema,
});
export type KanbanColumnsOutput = z.infer<typeof kanbanColumnsOutputSchema>;

/** More ids of a column snapshot (scrolling a long column). */
export const kanbanColumnChunkInputSchema = snapshotChunkInputSchema.extend({
  entityDefinitionId: idOrSlugSchema,
  acceptAfter: acceptAfterSchema,
});
export type KanbanColumnChunkInput = z.input<typeof kanbanColumnChunkInputSchema>;

/**
 * Drag and drop (C2 kanban K8): writes the stage value (retire + insert, history and Activity) on the card's own
 * attribute, or — when grouped through `parent_record` — on the parent record. `toStageId: null` (No stage) clears it.
 * `attributeValueId` (client-minted) makes it idempotent.
 */
export const kanbanMoveInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceId: uuidSchema,
  groupBy: pathSchema,
  toStageId: uuidSchema.nullable(),
  attributeValueId: uuidSchema.optional(),
});
export type KanbanMoveInput = z.input<typeof kanbanMoveInputSchema>;
export const kanbanMoveOutputSchema = z.object({
  /** Where the value was written (the card itself, or its parent record). */
  target: z.object({
    entityDefinitionId: uuidSchema,
    entityInstanceId: uuidSchema,
    attributeDefinitionId: uuidSchema,
  }),
  /** Every current value of the grouping attribute on the target. */
  values: z.array(attributeValueSchema),
  /** False when the card already was in that stage. */
  changed: z.boolean(),
  /** The destination stage has Confetti on (fire the celebration). */
  celebrate: z.boolean(),
});
export type KanbanMoveOutput = z.infer<typeof kanbanMoveOutputSchema>;

/**
 * Time in stage (C2 §4, kanban K2 footer chip): now − active_from of the current grouping value (from the value
 * history), whole days; overdue when the stage's target time is exceeded.
 */
export const kanbanTimeInStageInputSchema = z.object({
  entityDefinitionId: idOrSlugSchema,
  entityInstanceIds: z.array(uuidSchema).min(1).max(1000),
  groupBy: pathSchema,
  acceptAfter: acceptAfterSchema,
});
export type KanbanTimeInStageInput = z.input<typeof kanbanTimeInStageInputSchema>;
export const timeInStageSchema = z.object({
  stageId: uuidSchema.nullable(),
  enteredAt: timestampSchema.nullable(),
  days: z.number().int().nullable(),
  targetTimeInStatus: z.string().nullable(),
  isOverdue: z.boolean(),
});
export type TimeInStage = z.infer<typeof timeInStageSchema>;
export const kanbanTimeInStageOutputSchema = z.object({
  items: z.record(z.string(), timeInStageSchema),
  accurateAt: timestampSchema,
});
export type KanbanTimeInStageOutput = z.infer<typeof kanbanTimeInStageOutputSchema>;

/** Create-view helper output for lists (`lists.create` returns the default view). */
export const createListOutputSchema = z.object({ list: listSchema, view: viewSchema.nullable() });
export type CreateListOutput = z.infer<typeof createListOutputSchema>;
