// CSV import (BACKLOG 4.07; specs C2 import.md I1–I9; procedure names: decisions/slice4-contracts.md).
//
// Flow: imports.create (file name, header row, row count) → imports.uploadRows (chunks; the last one sets the job to
// 'draft') → imports.mappableProperties / imports.setMapping (Map columns) → imports.reviewSummary /
// imports.reviewValues / imports.setOverride / imports.createOptions (Review values) → imports.preview (plan) +
// imports.assertions (preview table) → imports.run (confirm; a worker executes the plan in batches) →
// imports.status / imports.assertions (overview) · imports.cancel · imports.delete (drafts) · imports.history.
//
// Ids: `importId` is the import mapping (the CSV layout bound to a destination), `jobId` the upload being imported
// (routes `…/import/{importId}/job/{jobId}`). Every job-level procedure takes `jobId`; both are client-mintable (I3).
// Destination = any entity definition: an object, or a list (collection-entry definition), where a list import
// matches or creates parent records through the entry's `parent_record` attribute, then creates or updates entries.
import { z } from 'zod';
import { actorSchema, idOrSlugSchema, pathSchema, timestampSchema, uuidSchema } from './common.ts';
import {
  attributeTypeSchema,
  currencyConfigurationSchema,
  numberConfigurationSchema,
  optionInputSchema,
  stageInputSchema,
} from './schema.ts';

/** Documented limits (import.md I2). */
export const IMPORT_MAX_COLUMNS = 100;
export const IMPORT_MAX_ROWS = 100_000;
/** Rows per imports.uploadRows call (the API body limit is 1 MB: send smaller chunks for wide files). */
export const IMPORT_UPLOAD_MAX_ROWS = 2000;
/** Distinct values per imports.reviewValues page. */
export const IMPORT_REVIEW_PAGE_MAX = 500;

export const importJobStatuses = [
  /** Rows are being uploaded. */
  'uploading',
  'upload-failed',
  /** All rows uploaded; mapping / review / preview. */
  'draft',
  /** Start import confirmed; queued for the worker. */
  'confirmed',
  /** The worker is (re)generating the plan before executing it. */
  'preparing',
  'executing',
  'completed',
  'canceled',
  'failed',
] as const;
export const importJobStatusSchema = z.enum(importJobStatuses);
export type ImportJobStatus = z.infer<typeof importJobStatusSchema>;

/** History labels (import.md I8): Uploading, Upload failed, Draft, Confirmed, Preparing import, In progress, Done… */
export const importJobStatusLabels: Record<ImportJobStatus, string> = {
  uploading: 'Uploading',
  'upload-failed': 'Upload failed',
  draft: 'Draft',
  confirmed: 'Confirmed',
  preparing: 'Preparing import',
  executing: 'In progress',
  completed: 'Done',
  canceled: 'Canceled',
  failed: 'Failed',
};

/** List imports: "For records already in the list": Add again (create) | Update existing (create-or-update). */
export const importListStrategySchema = z.enum(['create', 'create-or-update']);
export type ImportListStrategy = z.infer<typeof importListStrategySchema>;
/** Date / timestamp formats: ISO standard | American | European (I3, I4). */
export const importDateFormatSchema = z.enum(['iso', 'us', 'uk']);
export type ImportDateFormat = z.infer<typeof importDateFormatSchema>;
export const importDecimalSeparatorSchema = z.enum(['point', 'comma']);
export type ImportDecimalSeparator = z.infer<typeof importDecimalSeparatorSchema>;
/** Name attributes map to First / Last / Full (I3 "Person's name"). */
export const importNameFieldSchema = z.enum(['full-name', 'first-name', 'last-name']);
export type ImportNameField = z.infer<typeof importNameFieldSchema>;

/** The 18 per-row failure reasons with their UI text (I6). */
export const importFailureReasons = [
  'unknown-error',
  'entity-definition-not-found',
  'invalid-value',
  'attribute-definition-not-found',
  'matching-values-missing',
  'matching-attribute-definition-not-found',
  'matching-attribute-definition-not-unique',
  'matching-entity-instance-not-found',
  'matching-entity-instance-is-merging',
  'multiple-matching-entity-instances',
  'linked-record-not-found',
  'permission-denied',
  'required-value-not-provided',
  'unique-constraint-violation',
  'unsupported-attribute-type',
  'unique-value-attribute-type-not-supported',
  'particle-gate-violation',
  'retries-exceeded',
] as const;
export const importFailureReasonSchema = z.enum(importFailureReasons);
export type ImportFailureReason = z.infer<typeof importFailureReasonSchema>;
export const importFailureMessages: Record<ImportFailureReason, string> = {
  'unknown-error': 'An unknown error occurred',
  'entity-definition-not-found': 'Object not found',
  'invalid-value': 'Invalid value provided',
  'attribute-definition-not-found': 'Attribute not found',
  'matching-values-missing': 'Matching values missing',
  'matching-attribute-definition-not-found': 'Matching attribute not found',
  'matching-attribute-definition-not-unique': 'Matching attribute not unique',
  'matching-entity-instance-not-found': 'No matching record found',
  'matching-entity-instance-is-merging': 'The matched record is currently merging',
  'multiple-matching-entity-instances': 'Multiple matches found',
  'linked-record-not-found': 'The linked record was not found',
  'permission-denied': 'Permission denied',
  'required-value-not-provided': 'A required value was not provided',
  'unique-constraint-violation': 'Unique attribute conflict',
  'unsupported-attribute-type': 'Unsupported attribute type',
  'unique-value-attribute-type-not-supported': 'Matching attribute type does not support unique value lookup',
  'particle-gate-violation': 'Blocked due to object rules violation',
  'retries-exceeded': 'An unknown error occurred',
};

/** Per-row status of one strategy (I6 filter: Failed, Planned, Created, Updated, Skipped; plus canceled). */
export const importAssertionStatusSchema = z.enum(['planned', 'created', 'updated', 'skipped', 'failed', 'canceled']);
export type ImportAssertionStatus = z.infer<typeof importAssertionStatusSchema>;
/** What the plan expects for a row (preview icons: + create, ↻ update, ⊘ skip; fail = invalid row). */
export const importPlannedOutcomeSchema = z.enum(['create', 'update', 'skip', 'fail']);
export type ImportPlannedOutcome = z.infer<typeof importPlannedOutcomeSchema>;
/**
 * How a strategy writes its object: `create` (no unique attribute mapped: every row creates), `create-or-update`
 * (matched on a unique attribute, or for list entries on the parent record), `update` (matched on Record ID /
 * Entry ID: rows without a match fail).
 */
export const importStrategyModeSchema = z.enum(['create', 'create-or-update', 'update']);
export type ImportStrategyMode = z.infer<typeof importStrategyModeSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Shapes

export const importMappingSchema = z.object({
  id: uuidSchema,
  entityDefinitionId: uuidSchema,
  title: z.string(),
  sourceType: z.literal('csv'),
  listStrategy: importListStrategySchema,
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const importMappingPropertySchema = z.object({
  id: uuidSchema,
  columnIndex: z.number().int(),
  path: pathSchema,
  field: importNameFieldSchema.nullable(),
  /** Particle resolution type, e.g. 'date:value', 'text:uuid', 'personal-name:first-name'. */
  resolutionType: z.string(),
  attributeType: attributeTypeSchema,
  /** Index of the strategy (object) the column writes to; see ImportStrategy. */
  strategyIndex: z.number().int().nullable(),
  dateFormat: importDateFormatSchema.nullable(),
  timestampFormat: importDateFormatSchema.nullable(),
  decimalSeparator: importDecimalSeparatorSchema.nullable(),
});
export type ImportMappingProperty = z.infer<typeof importMappingPropertySchema>;

export const importColumnSchema = z.object({
  columnIndex: z.number().int(),
  header: z.string(),
  /** Up to 10 distinct non-empty samples (Data preview). */
  exampleValues: z.array(z.string()),
  /** The mapping property of the column, null = ignored. */
  propertyId: uuidSchema.nullable(),
});
export type ImportColumn = z.infer<typeof importColumnSchema>;

export const importStrategySchema = z.object({
  index: z.number().int(),
  entityDefinitionId: uuidSchema,
  /** Reference hops from the destination to this object; null for the destination itself. */
  path: pathSchema.nullable(),
  depth: z.number().int(),
  mode: importStrategyModeSchema,
  /** The attribute rows are matched on (unique attribute, Record/Entry ID, or a list entry's parent record). */
  matchingAttributeDefinitionId: uuidSchema.nullable(),
  /** True for the entries of a list import. */
  isListEntries: z.boolean(),
  mappingPropertyIds: z.array(uuidSchema),
  attributeDefinitionIds: z.array(uuidSchema),
  /** Plan counts (planned outcome) and, once running, the execution counts per status. */
  planned: z.object({
    create: z.number().int(),
    update: z.number().int(),
    skip: z.number().int(),
    fail: z.number().int(),
  }),
  statuses: z.record(importAssertionStatusSchema, z.number().int()),
});
export type ImportStrategy = z.infer<typeof importStrategySchema>;

export const importValidationIssueSchema = z.object({
  code: z.enum([
    'no-mapping',
    'duplicate-attribute',
    'multiple-on-multi-reference',
    'non-unique-on-multi-reference',
    'nested-too-deeply',
    'list-parent-required',
    'mixed-parent-objects',
    'unsupported-attribute',
  ]),
  message: z.string(),
  propertyIds: z.array(uuidSchema),
});
export type ImportValidationIssue = z.infer<typeof importValidationIssueSchema>;

export const importValidationSchema = z.object({
  /** Issues that block Continue (highlighted rows + messages). */
  blocking: z.array(importValidationIssueSchema),
  /**
   * "Import may add duplicate records": objects that are written without a unique attribute mapped, with the unique
   * attributes the user could map instead (non-blocking; the UI asks Go back / Continue with duplicates).
   */
  duplicateWarnings: z.array(
    z.object({
      strategyIndex: z.number().int(),
      entityDefinitionId: uuidSchema,
      uniqueAttributes: z.array(z.object({ path: pathSchema, title: z.string() })),
    }),
  ),
});
export type ImportValidation = z.infer<typeof importValidationSchema>;

export const importJobSchema = z.object({
  id: uuidSchema,
  importId: uuidSchema,
  entityDefinitionId: uuidSchema,
  sourceFileName: z.string(),
  columnCount: z.number().int(),
  rowCount: z.number().int(),
  uploadedRowCount: z.number().int(),
  status: importJobStatusSchema,
  statusLabel: z.string(),
  ingestionFailureReason: z.string().nullable(),
  timeZone: z.string(),
  planStatus: z.enum(['none', 'ready', 'stale']),
  plannedAt: timestampSchema.nullable(),
  /** "x / y" on the overview: executed assertions / all assertions (rows × strategies). */
  progress: z.object({ done: z.number().int(), total: z.number().int() }),
  failureReason: z.string().nullable(),
  confirmedBy: actorSchema.nullable(),
  confirmedAt: timestampSchema.nullable(),
  canceledBy: actorSchema.nullable(),
  canceledAt: timestampSchema.nullable(),
  startedExecutionAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  createdBy: actorSchema,
  createdAt: timestampSchema,
});
export type ImportJob = z.infer<typeof importJobSchema>;

/** Everything the wizard needs about one import (imports.status and the result of most mutations). */
export const importStatusSchema = z.object({
  mapping: importMappingSchema,
  job: importJobSchema,
  columns: z.array(importColumnSchema),
  properties: z.array(importMappingPropertySchema),
  validation: importValidationSchema,
  /** Strategies of the current mapping, with plan / execution counts once a plan exists. */
  strategies: z.array(importStrategySchema),
});
export type ImportStatus = z.infer<typeof importStatusSchema>;

// ---------------------------------------------------------------------------------------------------------------
// Procedures

/** Step 1 → Next: creates the mapping and the job (auto-maps columns whose header equals an attribute title). */
export const createImportInputSchema = z.object({
  importId: uuidSchema.optional(),
  jobId: uuidSchema.optional(),
  entityDefinitionId: idOrSlugSchema,
  fileName: z.string().trim().min(1).max(255),
  sourceType: z.literal('csv').default('csv'),
  /** The header row. */
  columns: z.array(z.string().max(1000)).min(1).max(IMPORT_MAX_COLUMNS),
  rowCount: z.number().int().min(1).max(IMPORT_MAX_ROWS),
  /** IANA zone used for timestamps without an offset in non-ISO formats (default UTC). */
  timeZone: z.string().min(1).max(64).optional(),
});
export type CreateImportInput = z.input<typeof createImportInputSchema>;
export const createImportOutputSchema = importStatusSchema.extend({ importId: uuidSchema, jobId: uuidSchema });
export type CreateImportOutput = z.infer<typeof createImportOutputSchema>;

/** Chunked raw rows (idempotent per row index); `final` (or reaching rowCount) completes the upload. */
export const uploadRowsInputSchema = z.object({
  jobId: uuidSchema,
  startRow: z
    .number()
    .int()
    .min(0)
    .max(IMPORT_MAX_ROWS - 1),
  rows: z.array(z.array(z.string().max(100_000)).max(IMPORT_MAX_COLUMNS)).max(IMPORT_UPLOAD_MAX_ROWS),
  final: z.boolean().optional(),
});
export type UploadRowsInput = z.input<typeof uploadRowsInputSchema>;
export const uploadRowsOutputSchema = z.object({
  jobId: uuidSchema,
  uploadedRowCount: z.number().int(),
  rowCount: z.number().int(),
  status: importJobStatusSchema,
});
export type UploadRowsOutput = z.infer<typeof uploadRowsOutputSchema>;

export const importJobRefSchema = z.object({ jobId: uuidSchema });
export type ImportJobRef = z.input<typeof importJobRefSchema>;

/** One attribute in the picker; references carry the attributes of the related object (drill-in, "Client 18 ›"). */
export interface MappableAttribute {
  path: z.infer<typeof pathSchema>;
  entityDefinitionId: string;
  attributeDefinitionId: string;
  title: string;
  type: z.infer<typeof attributeTypeSchema>;
  isMultiselect: boolean;
  isUnique: boolean;
  isRequired: boolean;
  isSystem: boolean;
  /** Record ID / Entry ID: mapping it makes the column a match key ("system attribute … will update"). */
  isMatchKey: boolean;
  /** personal-name: the parts the column can map to. */
  fields: ImportNameField[] | null;
  /** Record references: the related object and its mappable attributes (only unique ones for multi references). */
  related: {
    entityDefinitionId: string;
    singularNoun: string;
    pluralNoun: string;
    attributes: MappableAttribute[];
  } | null;
}
export const mappableAttributeSchema: z.ZodType<MappableAttribute> = z.lazy(() =>
  z.object({
    path: pathSchema,
    entityDefinitionId: uuidSchema,
    attributeDefinitionId: uuidSchema,
    title: z.string(),
    type: attributeTypeSchema,
    isMultiselect: z.boolean(),
    isUnique: z.boolean(),
    isRequired: z.boolean(),
    isSystem: z.boolean(),
    isMatchKey: z.boolean(),
    fields: z.array(importNameFieldSchema).nullable(),
    related: z
      .object({
        entityDefinitionId: uuidSchema,
        singularNoun: z.string(),
        pluralNoun: z.string(),
        attributes: z.array(mappableAttributeSchema),
      })
      .nullable(),
  }),
) as z.ZodType<MappableAttribute>;

export const mappablePropertiesOutputSchema = z.object({
  entityDefinitionId: uuidSchema,
  isList: z.boolean(),
  columns: z.array(importColumnSchema),
  /** Objects: one group. Lists: "<Parent object> attributes" (paths through parent_record), then "List attributes". */
  groups: z.array(
    z.object({
      key: z.enum(['record', 'parent-record', 'list']),
      title: z.string(),
      entityDefinitionId: uuidSchema,
      attributes: z.array(mappableAttributeSchema),
    }),
  ),
  /** Attribute types offered by "+ Create new attribute" (created on the destination: object or list). */
  creatableTypes: z.array(attributeTypeSchema),
});
export type MappablePropertiesOutput = z.infer<typeof mappablePropertiesOutputSchema>;

const formatConfig = {
  dateFormat: importDateFormatSchema.optional(),
  timestampFormat: importDateFormatSchema.optional(),
  decimalSeparator: importDecimalSeparatorSchema.optional(),
};

export const importColumnTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ignore') }),
  z.object({
    type: z.literal('attribute'),
    path: pathSchema,
    field: importNameFieldSchema.nullable().optional(),
    ...formatConfig,
  }),
  /** "+ Create new attribute": created on the destination (object attribute, or list attribute for lists). */
  z.object({
    type: z.literal('create-attribute'),
    attribute: z.object({
      id: uuidSchema,
      title: z.string().trim().min(1).max(200),
      type: attributeTypeSchema,
      isMultiselect: z.boolean().default(false),
      numberConfiguration: numberConfigurationSchema.optional(),
      currencyConfiguration: currencyConfigurationSchema.optional(),
      options: z.array(optionInputSchema).max(500).optional(),
      stages: z.array(stageInputSchema).max(100).optional(),
    }),
    ...formatConfig,
  }),
]);
export type ImportColumnTarget = z.input<typeof importColumnTargetSchema>;

/**
 * Map columns: changes only the listed columns. Re-sending a column with the same path (and field) keeps its
 * property id and overrides and only updates the format configuration (Date format / Decimal separator menus).
 */
export const setImportMappingInputSchema = z.object({
  jobId: uuidSchema,
  listStrategy: importListStrategySchema.optional(),
  columns: z
    .array(z.object({ columnIndex: z.number().int().min(0), target: importColumnTargetSchema }))
    .max(IMPORT_MAX_COLUMNS)
    .default([]),
});
export type SetImportMappingInput = z.input<typeof setImportMappingInputSchema>;

/** Review: one distinct raw value of a column. */
export const importReviewValueSchema = z.object({
  /** hex SHA-256 of the raw value (the override key). */
  hashedValue: z.string(),
  rawValue: z.string(),
  rowCount: z.number().int(),
  /**
   * mapped: parsed; empty: blank cell (skipped); invalid: could not be parsed (`errors`, will be skipped);
   * missing-options: select/status titles that do not exist (`missingOptions`; the known parts are imported);
   * overridden: the user fixed (`values`) or skipped (`values` = []) the value.
   */
  status: z.enum(['mapped', 'empty', 'invalid', 'missing-options', 'overridden']),
  needsReview: z.boolean(),
  /** Resolved values in the attribute's write form (a name part: the string). */
  values: z.array(z.unknown()),
  errors: z.array(z.string()),
  missingOptions: z.array(z.string()),
  override: z.object({ values: z.array(z.unknown()).nullable() }).nullable(),
});
export type ImportReviewValue = z.infer<typeof importReviewValueSchema>;

export const reviewValuesInputSchema = z.object({
  jobId: uuidSchema,
  propertyId: uuidSchema,
  group: z.enum(['all', 'needs-review', 'automatically-mapped']).default('all'),
  sort: z
    .object({ field: z.enum(['raw-value', 'row-count']), direction: z.enum(['asc', 'desc']) })
    .default({ field: 'raw-value', direction: 'asc' }),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(IMPORT_REVIEW_PAGE_MAX).default(100),
});
export type ReviewValuesInput = z.input<typeof reviewValuesInputSchema>;
export const reviewValuesOutputSchema = z.object({
  property: importMappingPropertySchema,
  /** Distinct values in the column, per group. */
  total: z.number().int(),
  needsReviewCount: z.number().int(),
  automaticallyMappedCount: z.number().int(),
  /** Select / status titles that do not exist ("+ Create N missing select options"). */
  missingOptions: z.array(z.string()),
  /** Distinct values of the requested group, sorted and paged. */
  matching: z.number().int(),
  values: z.array(importReviewValueSchema),
});
export type ReviewValuesOutput = z.infer<typeof reviewValuesOutputSchema>;

/** The Columns rail: an orange dot where values need review. */
export const reviewSummaryOutputSchema = z.object({
  properties: z.array(
    z.object({
      propertyId: uuidSchema,
      distinctCount: z.number().int(),
      needsReviewCount: z.number().int(),
      missingOptionCount: z.number().int(),
    }),
  ),
});
export type ReviewSummaryOutput = z.infer<typeof reviewSummaryOutputSchema>;

/**
 * Fix (values), skip, or revert (null) one distinct raw value; applies to every row with that value and is kept on
 * the mapping. Values use the property's write form: the attribute's value input (contracts valueInputSchemas),
 * a string for a name part.
 */
export const setImportOverrideInputSchema = z.object({
  jobId: uuidSchema,
  propertyId: uuidSchema,
  rawValue: z.string().max(100_000),
  override: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('values'), values: z.array(z.unknown()).max(100) }),
      z.object({ type: z.literal('skip') }),
    ])
    .nullable(),
});
export type SetImportOverrideInput = z.input<typeof setImportOverrideInputSchema>;

/** "Create missing select options / statuses" (all missing titles of the column unless `values` narrows them). */
export const createImportOptionsInputSchema = z.object({
  jobId: uuidSchema,
  propertyId: uuidSchema,
  values: z.array(z.string().min(1).max(200)).max(500).optional(),
});
export type CreateImportOptionsInput = z.input<typeof createImportOptionsInputSchema>;
export const createImportOptionsOutputSchema = z.object({
  created: z.array(z.object({ id: uuidSchema, title: z.string() })),
});
export type CreateImportOptionsOutput = z.infer<typeof createImportOptionsOutputSchema>;

/** One row of the preview / overview table of a strategy. */
export const importAssertionSchema = z.object({
  strategyIndex: z.number().int(),
  rowIndex: z.number().int(),
  plannedOutcome: importPlannedOutcomeSchema,
  status: importAssertionStatusSchema,
  matchedEntityInstanceIds: z.array(uuidSchema),
  entityInstanceIds: z.array(uuidSchema),
  failureReason: importFailureReasonSchema.nullable(),
  failureMessage: z.string().nullable(),
  /** Resolved values of the strategy's mapped attributes for this row (write form), by attribute id. */
  values: z.record(z.string(), z.array(z.unknown())),
});
export type ImportAssertion = z.infer<typeof importAssertionSchema>;

export const importPlanOutputSchema = z.object({
  jobId: uuidSchema,
  plannedAt: timestampSchema,
  strategies: z.array(importStrategySchema),
  /** "+ Up to N will be created · ↻ N will be updated · ⊘ N will be skipped" over all strategies. */
  totals: z.object({
    create: z.number().int(),
    update: z.number().int(),
    skip: z.number().int(),
    fail: z.number().int(),
  }),
  /** Invalid rows listed before the run (first 100). */
  invalidRows: z.array(importAssertionSchema),
});
export type ImportPlanOutput = z.infer<typeof importPlanOutputSchema>;

export const importAssertionsInputSchema = z.object({
  jobId: uuidSchema,
  strategyIndex: z.number().int().min(0),
  /** Overview filter (Failed, Planned, Created, Updated, Skipped). */
  statuses: z.array(importAssertionStatusSchema).max(6).optional(),
  plannedOutcomes: z.array(importPlannedOutcomeSchema).max(4).optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(500).default(100),
});
export type ImportAssertionsInput = z.input<typeof importAssertionsInputSchema>;
export const importAssertionsOutputSchema = z.object({
  total: z.number().int(),
  rows: z.array(importAssertionSchema),
});
export type ImportAssertionsOutput = z.infer<typeof importAssertionsOutputSchema>;

export const importHistoryInputSchema = z.object({
  /** Per object / list "Imports" tab; omitted = workspace import history. */
  entityDefinitionId: idOrSlugSchema.optional(),
  /** "Only imports by me". */
  onlyMine: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
  /** Cursor: createdAt of the last job of the previous page. */
  before: timestampSchema.optional(),
});
export type ImportHistoryInput = z.input<typeof importHistoryInputSchema>;
export const importHistoryOutputSchema = z.object({
  jobs: z.array(
    importJobSchema.extend({
      title: z.string(),
      counts: z.record(importAssertionStatusSchema, z.number().int()),
    }),
  ),
  nextBefore: timestampSchema.nullable(),
});
export type ImportHistoryOutput = z.infer<typeof importHistoryOutputSchema>;
