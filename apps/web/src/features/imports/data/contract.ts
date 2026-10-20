// The import backend contract the wizard codes against (research/architecture/decisions/slice4-contracts.md:
// `imports.create / uploadRows / mappableProperties / setMapping / reviewValues / setOverride / createOptions /
// preview / run / status / cancel / history`). Shapes follow C2 import.md §I7 (mapping → mapping properties with
// overrides keyed by the raw value's hash; job → raw rows, mappable columns, per-column resolution, plan → strategies →
// per-row assertions). The app uses `server.ts` (the `imports.*` procedures); `fake.ts` (in-memory) backs the unit
// tests of the wizard model.
import type { Path } from '@agentic-crm/contracts';

/** Attio's job states (U-C2-10 full enum unknown): ingesting → waiting (draft) → confirmed → executing → completed. */
export type ImportJobStatus =
  | 'ingesting'
  | 'upload-failed'
  | 'waiting'
  | 'confirmed'
  | 'executing'
  | 'completed'
  | 'canceled'
  | 'failed';

/** List imports: "For records already in the list" — Add again (create) / Update existing (create-or-update). */
export type ListStrategy = 'create' | 'create-or-update';
/** ISO standard / American / European (I3 `config__date_format`). */
export type DateFormat = 'iso' | 'us' | 'uk';
export type DecimalSeparator = 'point' | 'comma';
/** Personal-name parts a column can map to ("Person's name" sub-picker). */
export type NameField = 'first_name' | 'last_name' | 'full_name';

export interface PropertyConfig {
  dateFormat: DateFormat | null;
  timestampFormat: DateFormat | null;
  decimalSeparator: DecimalSeparator | null;
}

/** A CSV column (Attio "mappable property"): header, index and unique sample values for the data preview. */
export interface ImportColumn {
  index: number;
  title: string;
  exampleValues: string[];
}

/** Column → attribute (Attio "import mapping property"). Unmapped (ignored) columns have no property. */
export interface MappingProperty {
  /** Client-minted id; the review-values route param. */
  id: string;
  columnIndex: number;
  /** Hops from the destination definition (2 hops for linked objects, e.g. Client › Domains or Parent record › Code). */
  path: Path;
  field: NameField | null;
  config: PropertyConfig;
}

export interface ImportProgress {
  done: number;
  total: number;
}

/** Outcome counts of one strategy (overview summary line). */
export interface StrategyStatistics {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  canceled: number;
}

/** One import: its mapping (reusable CSV layout) and the job (this upload). */
export interface ImportJob {
  /** Import mapping id (route `$importMappingId`). */
  importId: string;
  /** Import job id (route `$importJobId`). */
  jobId: string;
  /** Destination object or list (collection-entry definition, same id as the list). */
  entityDefinitionId: string;
  fileName: string;
  fileSize: number;
  sourceType: 'csv';
  columnCount: number;
  rowCount: number;
  uploadedRowCount: number;
  status: ImportJobStatus;
  ingestionFailureReason: string | null;
  listStrategy: ListStrategy;
  columns: ImportColumn[];
  mapping: MappingProperty[];
  createdBy: string | null;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  canceledBy: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  /** Assertions done / total across strategies while executing. */
  progress: ImportProgress;
  /** Per strategy entity definition id. */
  statistics: Record<string, StrategyStatistics>;
}

// ---- review values ---------------------------------------------------------------------------------------------------

/** One parsed part of a raw cell (multi-selects split into several). Values are write forms (`ValueInput.value`). */
export type ResolvedPart =
  | { type: 'value'; value: unknown }
  | { type: 'error'; message: string }
  /** A select option / status title that does not exist ("Value doesn't exist and will not be imported"). */
  | { type: 'missing-option'; title: string };

/** Skip the value (`{skip: true}`) or replace it with these write-form values. */
export type ValueOverride = { skip: true } | { values: unknown[] };

/** A distinct raw value of a column (Attio "resolution", addressed by the SHA-256 of the raw value). */
export interface DistinctValue {
  hash: string;
  raw: string;
  rowCount: number;
  /** Server resolution; [] = empty cell (Skipped). */
  resolved: ResolvedPart[];
  override: ValueOverride | null;
}

export interface ReviewValuesResult {
  propertyId: string;
  status: 'processing' | 'completed';
  /** 0–100 while processing ("Processing column ({n}%)…"). */
  progress: number;
  values: DistinctValue[];
  /** Unknown option / status titles ("Create N missing select option(s)"). */
  missingOptions: string[];
}

/** The Columns rail: which mapped columns still have values to review (orange dot). */
export type ReviewSummary = Array<{ propertyId: string; needsReview: boolean }>;

// ---- plan, run, overview --------------------------------------------------------------------------------------------

export type PlanOutcome = 'create' | 'update' | 'skip';
export type RowStatus = 'planned' | 'created' | 'updated' | 'skipped' | 'failed' | 'canceled';

/** Attio's assertion failure reasons (import.md §I6). */
export type FailureReason =
  | 'unknown-error'
  | 'entity-definition-not-found'
  | 'invalid-value'
  | 'attribute-definition-not-found'
  | 'matching-values-missing'
  | 'matching-attribute-definition-not-found'
  | 'matching-attribute-definition-not-unique'
  | 'matching-entity-instance-not-found'
  | 'matching-entity-instance-is-merging'
  | 'multiple-matching-entity-instances'
  | 'linked-record-not-found'
  | 'permission-denied'
  | 'required-value-not-provided'
  | 'unique-constraint-violation'
  | 'unsupported-attribute-type'
  | 'unique-value-attribute-type-not-supported'
  | 'particle-gate-violation'
  | 'retries-exceeded';

/** One row of a strategy (Attio "assertion"). `values` are write forms keyed by attribute id of the strategy object. */
export interface PlanRow {
  /** 0-based data row of the file. */
  row: number;
  outcome: PlanOutcome;
  /** Matched record / entry (update), or the written one after the run. */
  entityInstanceId: string | null;
  values: Record<string, unknown[]>;
  status: RowStatus;
  failureReason: FailureReason | null;
}

/** One object written by the import: the destination, a linked object, or a list's parent object. */
export interface PlanStrategy {
  id: string;
  entityDefinitionId: string;
  kind: 'records' | 'entries';
  /** null for the destination; the reference hop for linked / parent objects. */
  path: Path | null;
  /** Unique attribute rows are matched by (Record ID, a unique attribute), null = always create. */
  matchingAttributeId: string | null;
  /** Attribute ids of the strategy object written by mapped columns, in column order. */
  attributeIds: string[];
  counts: { create: number; update: number; skip: number };
  total: number;
  /** The requested range of rows. */
  rows: PlanRow[];
}

/** A row that will not be imported (every mapped value empty or invalid) — listed before the run (BACKLOG §4 acc. 4). */
export interface InvalidRow {
  row: number;
  reason: string;
}

export interface ImportPlan {
  status: 'planning' | 'ready';
  strategies: PlanStrategy[];
  invalidRows: InvalidRow[];
}

// ---- history ----------------------------------------------------------------------------------------------------------

export interface ImportHistoryQuery {
  entityDefinitionId?: string;
  onlyMine?: boolean;
}

// ---- backend ----------------------------------------------------------------------------------------------------------

export interface CreateImportInput {
  /** Client-minted ids (idempotent create, I3). */
  importId: string;
  jobId: string;
  entityDefinitionId: string;
  fileName: string;
  fileSize: number;
  sourceType: 'csv';
  columns: ImportColumn[];
  rowCount: number;
  /** Auto-mapping computed client-side, saved with the draft (I2 step 3). */
  mapping: MappingProperty[];
}

export interface SetMappingInput {
  jobId: string;
  /** Columns to (re)map: a property, or null to ignore the column. */
  columns?: Array<{ columnIndex: number; property: MappingProperty | null }>;
  /** Per-property config changes (date format, decimal separator…). */
  configs?: Array<{ propertyId: string; config: Partial<PropertyConfig> }>;
  listStrategy?: ListStrategy;
}

/** Job-level calls are keyed by the job id (`$importJobId`); jobs carry their mapping id (`importId`) for routes. */
export interface ImportsBackend {
  /** 'server' (tRPC) or 'fake' (in-memory, unit tests). */
  readonly kind: 'server' | 'fake';
  create(input: CreateImportInput): Promise<ImportJob>;
  /** Appends raw rows (chunked, in order); `final` on the last chunk. The job leaves `ingesting` once all are in. */
  uploadRows(input: {
    jobId: string;
    start: number;
    rows: string[][];
    final?: boolean;
  }): Promise<{ uploadedRowCount: number }>;
  mappableProperties(jobId: string): Promise<ImportColumn[]>;
  setMapping(input: SetMappingInput): Promise<ImportJob>;
  reviewValues(input: { jobId: string; propertyId: string }): Promise<ReviewValuesResult>;
  reviewSummary(jobId: string): Promise<ReviewSummary>;
  /** Fix / skip (`override`) or revert (`null`) one distinct raw value (`raw`, addressed by `hash`). */
  setOverride(input: {
    jobId: string;
    propertyId: string;
    hash: string;
    raw: string;
    override: ValueOverride | null;
  }): Promise<ReviewValuesResult>;
  createOptions(input: { jobId: string; propertyId: string; values: string[] }): Promise<ReviewValuesResult>;
  preview(input: { jobId: string; range?: { start: number; size: number } }): Promise<ImportPlan>;
  run(jobId: string): Promise<ImportJob>;
  status(jobId: string): Promise<ImportJob>;
  cancel(jobId: string): Promise<ImportJob>;
  /** Deletes a draft (not run yet). Imports that have been run cannot be deleted. */
  remove(jobId: string): Promise<void>;
  history(query: ImportHistoryQuery): Promise<ImportJob[]>;
}

export class ImportNotFoundError extends Error {
  constructor(readonly jobId: string) {
    super('Import not found');
    this.name = 'ImportNotFoundError';
  }
}
