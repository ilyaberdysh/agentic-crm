// In-memory import backend for the unit tests of the wizard model (the UI uses server.ts). It implements the same
// contract as the server: jobs, raw rows, mapping, per-column resolution (model/resolve.ts), overrides by raw-value
// hash, plans (model/plan.ts) and the run, which writes through a `FakeSource` (test fixtures).
import type {
  AttributeDefinition,
  PathHop,
  PipelineStage,
  SelectOption,
  WorkspaceMember,
} from '@agentic-crm/contracts';
import type { SchemaIndex } from '../../views/schemaIndex';
import { buildPlan, matchKeysOf, planShapes, type StrategyShape } from '../model/plan';
import { effectiveValues, missingOptionsOf, needsReview, resolveRaw } from '../model/resolve';
import {
  type CreateImportInput,
  type DistinctValue,
  type FailureReason,
  type ImportColumn,
  type ImportHistoryQuery,
  type ImportJob,
  ImportNotFoundError,
  type ImportPlan,
  type ImportsBackend,
  type MappingProperty,
  type PlanRow,
  type ReviewValuesResult,
  type SetMappingInput,
  type StrategyStatistics,
  type ValueOverride,
} from './contract';

/** Schema reads and record writes the fake needs (live: tRPC; tests: fixtures). */
export interface FakeSource {
  memberId(): string | null;
  /** Schema over the destination plus the definitions its paths reach. */
  index(destinationId: string, extraDefinitionIds: string[]): Promise<SchemaIndex>;
  options(attribute: AttributeDefinition): Promise<SelectOption[]>;
  stages(attribute: AttributeDefinition): Promise<PipelineStage[]>;
  members(): Promise<WorkspaceMember[]>;
  createOptions(attribute: AttributeDefinition, titles: string[]): Promise<void>;
  /** Existing records holding these match keys in a unique (or id) attribute: key → record id. */
  findExisting(attribute: AttributeDefinition, keys: string[]): Promise<Map<string, string>>;
  /** Existing entries of these parent records in a list: parent id → entry id. */
  findEntries(listId: string, parentIds: string[]): Promise<Map<string, string>>;
  createRecord(entityDefinitionId: string, values: Record<string, unknown[]>): Promise<string>;
  updateRecord(entityDefinitionId: string, entityInstanceId: string, values: Record<string, unknown[]>): Promise<void>;
  addEntry(
    listId: string,
    parent: { entityDefinitionId: string; entityInstanceId: string },
    values: Record<string, unknown[]>,
  ): Promise<string>;
  /** Maps a write error to the failure reasons. */
  failureOf(error: unknown): FailureReason;
  /** Called after a run touched these definitions (cache invalidation). */
  afterRun?(entityDefinitionIds: string[]): void;
  /** Persistence (best effort). */
  load?(): string | null;
  save?(data: string): void;
}

interface Stored {
  job: ImportJob;
  rows: string[][];
  /** propertyId → hash → override (on the mapping, reusable across jobs). */
  overrides: Record<string, Record<string, ValueOverride>>;
  /** The plan the run executes (rows with statuses after the run). */
  plan: ImportPlan | null;
}

/** Stable short hash of a raw value (the server uses SHA-256; the UI treats it as opaque). */
export function hashRaw(raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();
const PERSIST_LIMIT = 1_500_000;

function statisticsOf(plan: ImportPlan): Record<string, StrategyStatistics> {
  const out: Record<string, StrategyStatistics> = {};
  for (const s of plan.strategies) {
    const st = (out[s.entityDefinitionId] ??= { created: 0, updated: 0, skipped: 0, failed: 0, canceled: 0 });
    for (const r of s.rows) {
      if (r.status === 'created') st.created++;
      else if (r.status === 'updated') st.updated++;
      else if (r.status === 'skipped') st.skipped++;
      else if (r.status === 'failed') st.failed++;
      else if (r.status === 'canceled') st.canceled++;
    }
  }
  return out;
}

export function createFakeImportsBackend(source: FakeSource): ImportsBackend {
  const store = new Map<string, Stored>();
  const canceling = new Set<string>();

  try {
    const raw = source.load?.();
    if (raw) for (const s of JSON.parse(raw) as Stored[]) store.set(s.job.jobId, s);
  } catch {
    // corrupt persisted state: start empty
  }

  const persist = () => {
    if (!source.save) return;
    try {
      const all = [...store.values()];
      let data = JSON.stringify(all);
      // Too big for storage: keep metadata only (drafts of big files are not resumable after a reload).
      if (data.length > PERSIST_LIMIT) data = JSON.stringify(all.map((s) => ({ ...s, rows: [], plan: null })));
      if (data.length <= PERSIST_LIMIT) source.save(data);
    } catch {
      // quota: not persisted
    }
  };

  const get = (jobId: string): Stored => {
    const s = store.get(jobId);
    if (!s) throw new ImportNotFoundError(jobId);
    return s;
  };

  const touch = (s: Stored) => {
    s.plan = s.job.status === 'waiting' ? null : s.plan;
    persist();
    return clone(s.job);
  };

  const indexFor = async (job: ImportJob) => {
    const first = await source.index(job.entityDefinitionId, []);
    // Definitions reached by mapped paths (linked objects, a list's parent object) and every reference target.
    const extra = new Set<string>();
    for (const a of first.attributes(job.entityDefinitionId) ?? []) {
      const t = first.targetOf(a);
      if (t) extra.add(t);
    }
    return extra.size > 0 ? source.index(job.entityDefinitionId, [...extra]) : first;
  };

  const leafOf = (index: SchemaIndex, p: MappingProperty) => index.attribute(p.path[p.path.length - 1] as PathHop);

  /** Distinct values of a column with their resolution. */
  const resolveColumn = async (s: Stored, index: SchemaIndex, p: MappingProperty): Promise<DistinctValue[]> => {
    const attribute = leafOf(index, p);
    const counts = new Map<string, number>();
    for (const row of s.rows) {
      const raw = row[p.columnIndex] ?? '';
      const key = raw.trim();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (!attribute) return [];
    const [options, stages, members] = await Promise.all([
      attribute.type === 'select' ? source.options(attribute) : Promise.resolve(undefined),
      attribute.type === 'pipeline' ? source.stages(attribute) : Promise.resolve(undefined),
      attribute.type === 'actor-reference' ? source.members() : Promise.resolve(undefined),
    ]);
    const overrides = s.overrides[p.id] ?? {};
    return [...counts].map(([raw, rowCount]) => {
      const hash = hashRaw(raw);
      return {
        hash,
        raw,
        rowCount,
        resolved: resolveRaw(attribute, raw, { options, stages, members, config: p.config, field: p.field }),
        override: overrides[hash] ?? null,
      };
    });
  };

  const review = async (s: Stored, propertyId: string): Promise<ReviewValuesResult> => {
    const p = s.job.mapping.find((m) => m.id === propertyId);
    if (!p) throw new ImportNotFoundError(s.job.jobId);
    const index = await indexFor(s.job);
    const values = await resolveColumn(s, index, p);
    return { propertyId, status: 'completed', progress: 100, values, missingOptions: missingOptionsOf(values) };
  };

  /** The full plan with existing-record lookups. */
  const computePlan = async (s: Stored): Promise<ImportPlan> => {
    const index = await indexFor(s.job);
    const shapes = planShapes(s.job, index);
    const resolved = new Map<string, Map<string, DistinctValue>>();
    for (const p of s.job.mapping) {
      const values = await resolveColumn(s, index, p);
      resolved.set(p.id, new Map(values.map((v) => [v.raw, v])));
    }
    const valuesFor = (p: MappingProperty, raw: string) => {
      const v = resolved.get(p.id)?.get(raw.trim());
      return v ? effectiveValues(v) : [];
    };
    const issuesFor = (p: MappingProperty, raw: string) => {
      const v = resolved.get(p.id)?.get(raw.trim());
      if (!v || !needsReview(v)) return [];
      return v.resolved.flatMap((part) =>
        part.type === 'error'
          ? [part.message]
          : part.type === 'missing-option'
            ? [`"${part.title}" doesn't exist and will not be imported`]
            : [],
      );
    };
    const existing = new Map<string, Map<string, string>>();
    for (const shape of shapes) {
      if (!shape.matchingAttribute) continue;
      const keys = [...matchKeysOf(index, shape, { rows: s.rows, valuesFor })];
      existing.set(shape.id, keys.length > 0 ? await source.findExisting(shape.matchingAttribute, keys) : new Map());
    }
    let existingEntries: Map<string, string> | undefined;
    const parent = shapes.find((x) => x.id === 'parent');
    if (parent && s.job.listStrategy === 'create-or-update') {
      const parentIds = [...(existing.get('parent')?.values() ?? [])];
      existingEntries =
        parentIds.length > 0 ? await source.findEntries(s.job.entityDefinitionId, parentIds) : new Map();
    }
    return buildPlan(index, shapes, {
      rows: s.rows,
      valuesFor,
      issuesFor,
      existing,
      existingEntries,
      listStrategy: s.job.listStrategy,
      columnTitle: (i) => s.job.columns[i]?.title ?? `Column ${i + 1}`,
    });
  };

  const slice = (plan: ImportPlan, range?: { start: number; size: number }): ImportPlan => {
    const start = range?.start ?? 0;
    const size = range?.size ?? 500;
    return {
      ...plan,
      strategies: plan.strategies.map((st) => ({ ...st, rows: st.rows.slice(start, start + size) })),
    };
  };

  /** Executes the confirmed plan: linked / parent objects first, then the destination rows. */
  const execute = async (s: Stored) => {
    const plan = s.plan;
    if (!plan) return;
    const index = await indexFor(s.job);
    const shapes = planShapes(s.job, index);
    const shapeOf = new Map<string, StrategyShape>(shapes.map((x) => [x.id, x]));
    const root = plan.strategies[0];
    const others = plan.strategies.slice(1);
    s.job.status = 'executing';
    s.job.progress = { done: 0, total: plan.strategies.reduce((n, st) => n + st.rows.length, 0) };
    persist();
    const tick = () => {
      s.job.progress.done += 1;
      s.job.statistics = statisticsOf(plan);
    };
    /** Records created by this run per strategy and match key (duplicates in the file are merged). */
    const createdByKey = new Map<string, Map<string, string>>();
    const runRow = async (strategyId: string, row: PlanRow, extra: Record<string, unknown[]> = {}) => {
      const strategy = plan.strategies.find((x) => x.id === strategyId);
      const shape = shapeOf.get(strategyId);
      if (!strategy || !shape) return;
      if (canceling.has(s.job.jobId)) {
        row.status = 'canceled';
        return tick();
      }
      if (row.outcome === 'skip') {
        row.status = 'skipped';
        return tick();
      }
      const values = { ...row.values, ...extra };
      const keyAttr = shape.matchingAttribute;
      const key = keyAttr ? JSON.stringify(values[keyAttr.id]?.[0] ?? null) : null;
      const seen = key ? createdByKey.get(strategyId)?.get(key) : undefined;
      try {
        if (row.outcome === 'update' && row.entityInstanceId) {
          await source.updateRecord(strategy.entityDefinitionId, row.entityInstanceId, values);
          row.status = 'updated';
        } else if (seen) {
          await source.updateRecord(strategy.entityDefinitionId, seen, values);
          row.entityInstanceId = seen;
          row.status = 'updated';
        } else if (strategy.kind === 'entries') {
          const parentShape = shapeOf.get('parent');
          const link = parentShape?.linkAttribute;
          const parentRef = link ? (values[link.id]?.[0] as { entityInstanceId?: string } | undefined) : undefined;
          if (!parentShape || !parentRef?.entityInstanceId)
            throw Object.assign(new Error('parent'), { reason: 'linked-record-not-found' });
          const { [link?.id ?? '']: _parent, ...entryValues } = values;
          row.entityInstanceId = await source.addEntry(
            strategy.entityDefinitionId,
            { entityDefinitionId: parentShape.entityDefinitionId, entityInstanceId: parentRef.entityInstanceId },
            entryValues,
          );
          row.status = 'created';
        } else {
          row.entityInstanceId = await source.createRecord(strategy.entityDefinitionId, values);
          row.status = 'created';
          if (key && keyAttr) {
            const m = createdByKey.get(strategyId) ?? new Map<string, string>();
            m.set(key, row.entityInstanceId);
            createdByKey.set(strategyId, m);
          }
        }
        row.failureReason = null;
      } catch (error) {
        row.status = 'failed';
        row.failureReason = (error as { reason?: FailureReason }).reason ?? source.failureOf(error);
      }
      tick();
    };

    for (const st of others) for (const row of st.rows) await runRow(st.id, row);
    if (root) {
      for (const row of root.rows) {
        const extra: Record<string, unknown[]> = {};
        for (const st of others) {
          const shape = shapeOf.get(st.id);
          const linked = st.rows.find((r) => r.row === row.row);
          if (
            shape?.linkAttribute &&
            linked?.entityInstanceId &&
            (linked.status === 'created' || linked.status === 'updated')
          )
            extra[shape.linkAttribute.id] = [
              { entityInstanceId: linked.entityInstanceId, entityDefinitionId: st.entityDefinitionId },
            ];
        }
        await runRow(root.id, row, extra);
      }
    }
    s.job.statistics = statisticsOf(plan);
    if (canceling.has(s.job.jobId)) {
      s.job.status = 'canceled';
      canceling.delete(s.job.jobId);
    } else {
      s.job.status = 'completed';
      s.job.completedAt = now();
    }
    persist();
    source.afterRun?.(plan.strategies.map((st) => st.entityDefinitionId));
  };

  const backend: ImportsBackend = {
    kind: 'fake',

    async create(input: CreateImportInput) {
      const existing = store.get(input.jobId);
      if (existing) return clone(existing.job);
      const job: ImportJob = {
        importId: input.importId,
        jobId: input.jobId,
        entityDefinitionId: input.entityDefinitionId,
        fileName: input.fileName,
        fileSize: input.fileSize,
        sourceType: 'csv',
        columnCount: input.columns.length,
        rowCount: input.rowCount,
        uploadedRowCount: 0,
        status: 'ingesting',
        ingestionFailureReason: null,
        listStrategy: 'create',
        columns: input.columns,
        mapping: input.mapping,
        createdBy: source.memberId(),
        createdAt: now(),
        confirmedBy: null,
        confirmedAt: null,
        canceledBy: null,
        canceledAt: null,
        completedAt: null,
        progress: { done: 0, total: 0 },
        statistics: {},
      };
      store.set(job.jobId, { job, rows: [], overrides: {}, plan: null });
      persist();
      return clone(job);
    },

    async uploadRows({ jobId, start, rows }) {
      const s = get(jobId);
      for (let i = 0; i < rows.length; i++) s.rows[start + i] = rows[i] as string[];
      s.job.uploadedRowCount = Math.max(s.job.uploadedRowCount, start + rows.length);
      if (s.job.uploadedRowCount >= s.job.rowCount && s.job.status === 'ingesting') s.job.status = 'waiting';
      persist();
      return { uploadedRowCount: s.job.uploadedRowCount };
    },

    async mappableProperties(jobId): Promise<ImportColumn[]> {
      return clone(get(jobId).job.columns);
    },

    async setMapping(input: SetMappingInput) {
      const s = get(input.jobId);
      let mapping = [...s.job.mapping];
      for (const c of input.columns ?? []) {
        mapping = mapping.filter((m) => m.columnIndex !== c.columnIndex);
        if (c.property) mapping.push(c.property);
      }
      mapping.sort((a, b) => a.columnIndex - b.columnIndex);
      for (const c of input.configs ?? []) {
        mapping = mapping.map((m) => (m.id === c.propertyId ? { ...m, config: { ...m.config, ...c.config } } : m));
      }
      s.job.mapping = mapping;
      if (input.listStrategy) s.job.listStrategy = input.listStrategy;
      return touch(s);
    },

    async reviewValues({ jobId, propertyId }) {
      return review(get(jobId), propertyId);
    },

    async reviewSummary(jobId) {
      const s = get(jobId);
      const out = [];
      for (const p of s.job.mapping) {
        const r = await review(s, p.id);
        out.push({ propertyId: p.id, needsReview: r.values.some(needsReview) || r.missingOptions.length > 0 });
      }
      return out;
    },

    async setOverride({ jobId, propertyId, hash, override }) {
      const s = get(jobId);
      const byHash = { ...(s.overrides[propertyId] ?? {}) };
      if (override) byHash[hash] = override;
      else delete byHash[hash];
      s.overrides[propertyId] = byHash;
      s.plan = null;
      persist();
      return review(s, propertyId);
    },

    async createOptions({ jobId, propertyId, values }) {
      const s = get(jobId);
      const p = s.job.mapping.find((m) => m.id === propertyId);
      if (!p) throw new ImportNotFoundError(jobId);
      const index = await indexFor(s.job);
      const attribute = leafOf(index, p);
      if (attribute) await source.createOptions(attribute, values);
      s.plan = null;
      return review(s, propertyId);
    },

    async preview({ jobId, range }) {
      const s = get(jobId);
      if (s.job.status === 'ingesting') return { status: 'planning', strategies: [], invalidRows: [] };
      if (!s.plan || s.job.status === 'waiting') {
        s.plan = await computePlan(s);
        persist();
      }
      return clone(slice(s.plan, range));
    },

    async run(jobId) {
      const s = get(jobId);
      if (s.job.status !== 'waiting') return clone(s.job);
      s.plan = await computePlan(s);
      s.job.status = 'confirmed';
      s.job.confirmedBy = source.memberId();
      s.job.confirmedAt = now();
      s.job.progress = { done: 0, total: s.plan.strategies.reduce((n, st) => n + st.rows.length, 0) };
      s.job.statistics = statisticsOf(s.plan);
      persist();
      void execute(s).catch(() => {
        s.job.status = 'completed';
        s.job.completedAt = now();
        persist();
      });
      return clone(s.job);
    },

    async status(jobId) {
      return clone(get(jobId).job);
    },

    async cancel(jobId) {
      const s = get(jobId);
      if (s.job.status === 'confirmed' || s.job.status === 'executing') canceling.add(jobId);
      if (s.job.status !== 'completed' && s.job.status !== 'canceled') {
        s.job.canceledBy = source.memberId();
        s.job.canceledAt = now();
        if (s.job.status !== 'executing' && s.job.status !== 'confirmed') s.job.status = 'canceled';
      }
      persist();
      return clone(s.job);
    },

    async remove(jobId) {
      const s = get(jobId);
      if (s.job.confirmedAt) throw new Error('Imports that have been run cannot be deleted.');
      store.delete(jobId);
      persist();
    },

    async history(query: ImportHistoryQuery) {
      const me = source.memberId();
      return [...store.values()]
        .map((s) => s.job)
        .filter((j) => !query.entityDefinitionId || j.entityDefinitionId === query.entityDefinitionId)
        .filter((j) => !query.onlyMine || j.createdBy === me)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(clone);
    },
  };
  return backend;
}
