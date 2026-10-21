// The import backend calls the `imports.*` procedures. The server
// answers `imports.status` → {mapping, job, columns, properties, validation, strategies}; job-level procedures take
// `jobId`; review values carry `hashedValue` / `rawValue` / `status`; `preview` (a mutation) generates the plan and
// `assertions` pages its rows; `reviewSummary` drives the orange dots of the Columns rail. Everything is translated
// into the wizard's contract (contract.ts) here.
import type { ImportColumnTarget } from '@agentic-crm/contracts';
import {
  api,
  httpStatusOf,
  inWorkspace,
  noteAcceptAfter,
  type RouterOutputs,
  type WorkspaceRef,
} from '../../../data/trpc';
import { splitName } from '../../attributes/values/parse';
import type {
  ImportColumn,
  ImportJob,
  ImportJobStatus,
  ImportPlan,
  ImportsBackend,
  InvalidRow,
  MappingProperty,
  NameField,
  PlanRow,
  PlanStrategy,
  ResolvedPart,
  ReviewSummary,
  ReviewValuesResult,
  StrategyStatistics,
  ValueOverride,
} from './contract';
import { ImportNotFoundError } from './contract';

// ---- server shapes ---------------------------------------------------------------------------------------------------

type ServerStatus = RouterOutputs['imports']['status'];
type ServerJob = ServerStatus['job'];
type ServerProperty = ServerStatus['properties'][number];
type ServerStrategy = ServerStatus['strategies'][number];
type ServerReview = RouterOutputs['imports']['reviewValues'];
type ServerAssertion = RouterOutputs['imports']['assertions']['rows'][number];
type ServerField = NonNullable<ServerProperty['field']>;

// ---- translation ------------------------------------------------------------------------------------------------------

const FIELD_IN: Record<ServerField, NameField> = {
  'full-name': 'full_name',
  'first-name': 'first_name',
  'last-name': 'last_name',
};
const FIELD_OUT: Record<NameField, ServerField> = {
  full_name: 'full-name',
  first_name: 'first-name',
  last_name: 'last-name',
};

const STATUS_IN: Record<ServerJob['status'], ImportJobStatus> = {
  uploading: 'ingesting',
  'upload-failed': 'upload-failed',
  draft: 'waiting',
  confirmed: 'confirmed',
  preparing: 'confirmed',
  executing: 'executing',
  completed: 'completed',
  canceled: 'canceled',
  failed: 'failed',
};

const propertyIn = (p: ServerProperty): MappingProperty => ({
  id: p.id,
  columnIndex: p.columnIndex,
  path: p.path,
  field: p.field ? FIELD_IN[p.field] : null,
  config: { dateFormat: p.dateFormat, timestampFormat: p.timestampFormat, decimalSeparator: p.decimalSeparator },
});

function statisticsIn(strategies: ServerStrategy[]): Record<string, StrategyStatistics> {
  const out: Record<string, StrategyStatistics> = {};
  for (const st of strategies) {
    const s = st.statuses;
    out[st.entityDefinitionId] = {
      created: s.created ?? 0,
      updated: s.updated ?? 0,
      skipped: s.skipped ?? 0,
      failed: s.failed ?? 0,
      canceled: s.canceled ?? 0,
    };
  }
  return out;
}

function jobIn(job: ServerJob, extra?: Partial<ServerStatus>): ImportJob {
  return {
    importId: job.importId,
    jobId: job.id,
    entityDefinitionId: job.entityDefinitionId,
    fileName: job.sourceFileName,
    fileSize: 0,
    sourceType: 'csv',
    columnCount: job.columnCount,
    rowCount: job.rowCount,
    uploadedRowCount: job.uploadedRowCount,
    status: STATUS_IN[job.status] ?? 'waiting',
    ingestionFailureReason: job.ingestionFailureReason,
    listStrategy: extra?.mapping?.listStrategy ?? 'create',
    columns: (extra?.columns ?? []).map((c) => ({
      index: c.columnIndex,
      title: c.header,
      exampleValues: c.exampleValues,
    })),
    mapping: (extra?.properties ?? []).map(propertyIn).sort((a, b) => a.columnIndex - b.columnIndex),
    createdBy: job.createdBy.id,
    createdAt: job.createdAt,
    confirmedBy: job.confirmedBy?.id ?? null,
    confirmedAt: job.confirmedAt,
    canceledBy: job.canceledBy?.id ?? null,
    canceledAt: job.canceledAt,
    completedAt: job.completedAt,
    progress: job.progress,
    statistics: statisticsIn(extra?.strategies ?? []),
  };
}

const statusIn = (res: ServerStatus): ImportJob => jobIn(res.job, res);

/** Name parts travel as strings; the wizard's views expect personal-name objects. */
function valueIn(property: ServerProperty | undefined, value: unknown): unknown {
  if (property?.attributeType !== 'personal-name' || typeof value !== 'string') return value;
  if (property.field === 'first-name') return { firstName: value };
  if (property.field === 'last-name') return { lastName: value };
  return splitName(value);
}

function valueOut(property: ServerProperty | undefined, value: unknown): unknown {
  if (property?.attributeType !== 'personal-name' || typeof value !== 'object' || value === null) return value;
  const v = value as { firstName?: string; lastName?: string; fullName?: string };
  if (property.field === 'first-name') return v.firstName ?? '';
  if (property.field === 'last-name') return v.lastName ?? '';
  return v.fullName ?? [v.firstName, v.lastName].filter(Boolean).join(' ');
}

function reviewIn(res: ServerReview): ReviewValuesResult {
  const p = res.property;
  return {
    propertyId: p.id,
    status: 'completed',
    progress: 100,
    missingOptions: res.missingOptions,
    values: res.values.map((v) => {
      const values = v.values.map((x) => valueIn(p, x));
      let resolved: ResolvedPart[];
      if (v.status === 'empty') resolved = [];
      else if (v.status === 'invalid') resolved = v.errors.map((message) => ({ type: 'error' as const, message }));
      else
        resolved = [
          ...values.map((value) => ({ type: 'value' as const, value })),
          ...v.missingOptions.map((title) => ({ type: 'missing-option' as const, title })),
        ];
      const override: ValueOverride | null = v.override
        ? v.override.values && v.override.values.length > 0
          ? { values: v.override.values.map((x) => valueIn(p, x)) }
          : { skip: true }
        : null;
      return { hash: v.hashedValue, raw: v.rawValue, rowCount: v.rowCount, resolved, override };
    }),
  };
}

const PAGE = 500;

/** Rows that will not be imported: the plan's failing rows, and destination rows skipped for lack of values. */
function invalidRowsOf(failing: ServerAssertion[], destinationRows: PlanRow[]): InvalidRow[] {
  const out: InvalidRow[] = failing.map((a) => ({
    row: a.rowIndex,
    reason: a.failureMessage ?? a.failureReason ?? 'Invalid row',
  }));
  for (const r of destinationRows) {
    if (r.outcome === 'skip' && !out.some((x) => x.row === r.row))
      out.push({ row: r.row, reason: 'Every mapped value is empty or invalid' });
  }
  return out.sort((a, b) => a.row - b.row);
}

const rowIn = (a: ServerAssertion): PlanRow => ({
  row: a.rowIndex,
  outcome: a.plannedOutcome === 'fail' ? 'skip' : a.plannedOutcome,
  entityInstanceId: a.entityInstanceIds[0] ?? a.matchedEntityInstanceIds[0] ?? null,
  values: a.values,
  status: a.status,
  failureReason: a.failureReason,
});

// ---- backend ---------------------------------------------------------------------------------------------------------

export function createServerImportsBackend(ws: WorkspaceRef): ImportsBackend {
  const call = inWorkspace(ws);
  /** A job the server does not know (deleted draft, another workspace) → ImportNotFoundError (wizard: "not found"). */
  const read = async <T>(jobId: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (httpStatusOf(error) === 404) throw new ImportNotFoundError(jobId);
      throw error;
    }
  };
  const settle = <T extends { seq?: string | null }>(res: T): T => {
    noteAcceptAfter(ws.id, res.seq ?? null);
    return res;
  };
  /** The last status per job (format edits re-send the column's path and field). */
  const last = new Map<string, ServerStatus>();
  const status = async (jobId: string) => {
    const res = await read(jobId, () => api.imports.status.query({ jobId }, call));
    last.set(jobId, res);
    return res;
  };
  const remember = (res: ServerStatus & { seq?: string | null }) => {
    settle(res);
    last.set(res.job.id, res);
    return statusIn(res);
  };
  const review = async (jobId: string, propertyId: string): Promise<ReviewValuesResult> =>
    reviewIn(await read(jobId, () => api.imports.reviewValues.query({ jobId, propertyId, limit: PAGE }, call)));
  const assertions = async (jobId: string, strategyIndex: number, start: number, size: number) => {
    const rows: ServerAssertion[] = [];
    let total = 0;
    for (let offset = start; offset < start + size; offset += PAGE) {
      const page = await read(jobId, () =>
        api.imports.assertions.query(
          { jobId, strategyIndex, offset, limit: Math.min(PAGE, start + size - offset) },
          call,
        ),
      );
      total = page.total;
      rows.push(...page.rows);
      if (page.rows.length === 0 || offset + PAGE >= page.total) break;
    }
    return { total, rows };
  };

  return {
    kind: 'server',

    async create(input) {
      const res = await api.imports.create.mutate(
        {
          importId: input.importId,
          jobId: input.jobId,
          entityDefinitionId: input.entityDefinitionId,
          fileName: input.fileName,
          sourceType: 'csv',
          columns: input.columns.map((c) => c.title),
          rowCount: input.rowCount,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        call,
      );
      return { ...remember(res), fileSize: input.fileSize };
    },

    async uploadRows({ jobId, start, rows, final }) {
      const res = settle(
        await api.imports.uploadRows.mutate({ jobId, startRow: start, rows, ...(final ? { final } : {}) }, call),
      );
      return { uploadedRowCount: res.uploadedRowCount };
    },

    async mappableProperties(jobId): Promise<ImportColumn[]> {
      const res = await read(jobId, () => api.imports.mappableProperties.query({ jobId }, call));
      return res.columns.map((c) => ({ index: c.columnIndex, title: c.header, exampleValues: c.exampleValues }));
    },

    async setMapping(input) {
      const columns: { columnIndex: number; target: ImportColumnTarget }[] = [];
      for (const c of input.columns ?? []) {
        const p = c.property;
        columns.push({
          columnIndex: c.columnIndex,
          target: p
            ? {
                type: 'attribute',
                path: p.path,
                field: p.field ? FIELD_OUT[p.field] : null,
                ...(p.config.dateFormat ? { dateFormat: p.config.dateFormat } : {}),
                ...(p.config.timestampFormat ? { timestampFormat: p.config.timestampFormat } : {}),
                ...(p.config.decimalSeparator ? { decimalSeparator: p.config.decimalSeparator } : {}),
              }
            : { type: 'ignore' },
        });
      }
      if (input.configs?.length) {
        // Re-sending a column with the same path and field keeps its property (and overrides): only the format changes.
        const current = last.get(input.jobId) ?? (await status(input.jobId));
        for (const c of input.configs) {
          const p = current.properties.find((x) => x.id === c.propertyId);
          if (!p) continue;
          columns.push({
            columnIndex: p.columnIndex,
            target: {
              type: 'attribute',
              path: p.path,
              field: p.field,
              ...(c.config.dateFormat ? { dateFormat: c.config.dateFormat } : {}),
              ...(c.config.timestampFormat ? { timestampFormat: c.config.timestampFormat } : {}),
              ...(c.config.decimalSeparator ? { decimalSeparator: c.config.decimalSeparator } : {}),
            },
          });
        }
      }
      return remember(
        await api.imports.setMapping.mutate(
          { jobId: input.jobId, ...(input.listStrategy ? { listStrategy: input.listStrategy } : {}), columns },
          call,
        ),
      );
    },

    reviewValues: ({ jobId, propertyId }) => review(jobId, propertyId),

    async reviewSummary(jobId): Promise<ReviewSummary> {
      const res = await read(jobId, () => api.imports.reviewSummary.query({ jobId }, call));
      return res.properties.map((p) => ({
        propertyId: p.propertyId,
        needsReview: p.needsReviewCount > 0 || p.missingOptionCount > 0,
      }));
    },

    async setOverride({ jobId, propertyId, raw, override }) {
      const property = (last.get(jobId) ?? (await status(jobId))).properties.find((p) => p.id === propertyId);
      settle(
        await api.imports.setOverride.mutate(
          {
            jobId,
            propertyId,
            rawValue: raw,
            override: override
              ? 'skip' in override
                ? { type: 'skip' }
                : { type: 'values', values: override.values.map((v) => valueOut(property, v)) }
              : null,
          },
          call,
        ),
      );
      return review(jobId, propertyId);
    },

    async createOptions({ jobId, propertyId, values }) {
      settle(await api.imports.createOptions.mutate({ jobId, propertyId, values }, call));
      return review(jobId, propertyId);
    },

    async preview({ jobId, range }): Promise<ImportPlan> {
      const start = range?.start ?? 0;
      const size = range?.size ?? PAGE;
      const current = await status(jobId);
      if (current.job.status === 'uploading') return { status: 'planning', strategies: [], invalidRows: [] };
      let strategies = current.strategies;
      let invalid: ServerAssertion[] = [];
      if (current.job.status === 'draft') {
        // Preview is a mutation: it (re)generates the plan of the draft.
        const plan = settle(await api.imports.preview.mutate({ jobId }, call));
        strategies = plan.strategies;
        invalid = plan.invalidRows;
      }
      const out: PlanStrategy[] = [];
      for (const st of strategies) {
        const page = await assertions(jobId, st.index, start, size);
        out.push({
          id: String(st.index),
          entityDefinitionId: st.entityDefinitionId,
          kind: st.isListEntries ? 'entries' : 'records',
          path: st.path,
          matchingAttributeId: st.matchingAttributeDefinitionId,
          attributeIds: st.attributeDefinitionIds,
          counts: { create: st.planned.create, update: st.planned.update, skip: st.planned.skip + st.planned.fail },
          total: page.total,
          rows: page.rows.map(rowIn),
        });
      }
      return { status: 'ready', strategies: out, invalidRows: invalidRowsOf(invalid, out[0]?.rows ?? []) };
    },

    run: async (jobId) => remember(await api.imports.run.mutate({ jobId }, call)),
    status: async (jobId) => statusIn(await status(jobId)),
    cancel: async (jobId) => remember(await api.imports.cancel.mutate({ jobId }, call)),
    async remove(jobId) {
      settle(await api.imports.delete.mutate({ jobId }, call));
      last.delete(jobId);
    },
    async history(query) {
      const res = await api.imports.history.query({ ...query, limit: 100 }, call);
      return res.jobs.map((j) => jobIn(j));
    },
  };
}
