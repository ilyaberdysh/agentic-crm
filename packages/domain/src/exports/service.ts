// View export (BACKLOG 4.08; export.md E1–E3). exports.create freezes the saved view (filter, sorts, columns —
// kanban: the grouping attribute first, then the card attributes) and queues `export.run` in the same transaction
// (D-10). The worker materialises a snapshot of the view's query, reads and formats the rows chunk by chunk
// (progress), writes the CSV to S3 and marks the export complete; downloads use signed URLs (5 minutes).
import {
  type CreateExportInput,
  type CreateExportOutput,
  createExportInputSchema,
  type ExportDownloadUrlOutput,
  type ExportJob,
  type Path,
  type Predicate,
  type Sort,
} from '@agentic-crm/contracts';
import { type Database, type EntityDefinitionExportsTable, jsonb, type Selectable } from '@agentic-crm/db';
import { memberAudience, recordLabels, toActor } from '../collab/common.ts';
import { actingMemberId, memberContext, type ServiceContext, systemContext } from '../context.ts';
import { DomainError, notFound } from '../errors.ts';
import { newId } from '../ids.ts';
import type { JobQueue } from '../jobs/queue.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../schema/model.ts';
import type { ObjectStorage } from '../storage/s3.ts';
import { isValidTimeZone } from '../time.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { readValue } from '../values/codecs.ts';
import { walkPath } from '../views/resolve.ts';
import { CHUNK_SIZE, viewOps } from '../views/service.ts';
import { exportFormulaInjectionPrefix } from '../workspace/service.ts';
import { csvBytes, csvLine } from './csv.ts';
import { type ColumnFormat, type ExportFormatSettings, type FormatLookups, formatCell } from './format.ts';

type ExportRow = Selectable<EntityDefinitionExportsTable>;

export const EXPORT_DOWNLOAD_TTL_SECONDS = 5 * 60;
export const EXPORT_CONTENT_TYPE = 'text/csv; charset=utf-8';

interface FrozenColumn {
  title: string | null;
  path: Path;
  field: string | null;
  displayConfiguration: ColumnFormat;
}

export interface ExportDeps {
  jobs: JobQueue;
  storage: ObjectStorage;
}

function toExport(row: ExportRow): ExportJob {
  return {
    id: row.id,
    entityDefinitionId: row.entity_definition_id,
    viewId: row.view_id,
    format: 'csv',
    title: row.title,
    fileName: row.file_name,
    status: row.status,
    progress: row.progress,
    failureReason: (row.failure_reason as ExportJob['failureReason']) ?? null,
    rowCount: row.row_count,
    locale: row.locale,
    timeZone: row.time_zone,
    createdBy: toActor(row.created_by),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function requireExport(tx: Tx, exportId: string, lock = false): Promise<ExportRow> {
  const row = await tx.db
    .selectFrom('entity_definition_exports')
    .selectAll()
    .where('id', '=', exportId)
    .$if(lock, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!row) throw notFound('The requested export could not be found', { export_id: exportId });
  return row;
}

async function touchExport(tx: Tx, row: { id: string; entity_definition_id: string; created_by: unknown }) {
  const creator = toActor(row.created_by);
  const audience = creator.type === 'workspace-member' && creator.id ? await memberAudience(tx, creator.id) : null;
  tx.emit('entity-definition-export', row.id, { entityDefinitionId: row.entity_definition_id }, audience);
}

function canonicalLocale(locale: string | null | undefined): string | null {
  if (!locale) return null;
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? null;
  } catch {
    return null;
  }
}

const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'Export';

/** The definition's record label attribute (display name), as recordLabels() reads it. */
function labelAttr(def: DefInfo): AttrDef | undefined {
  const id = def.epithetPath?.[0]?.attributeDefinitionId ?? def.bySlug.get('name')?.id;
  return id ? def.byId.get(id) : undefined;
}

const isParentRecordAttr = (a: AttrDef) =>
  a.apiSlug === 'parent_record' || a.systemAttributeType === 'entry-parent-record';

export const exportOps = {
  async create(tx: Tx, deps: ExportDeps, input: CreateExportInput): Promise<CreateExportOutput> {
    const data = createExportInputSchema.parse(input);
    if (data.exportId) {
      const existing = await tx.db
        .selectFrom('entity_definition_exports')
        .selectAll()
        .where('id', '=', data.exportId)
        .executeTakeFirst();
      if (existing) return { exportId: existing.id, export: toExport(existing) };
    }
    const view = await viewOps.get(tx, data.viewId);
    const def = await loadDefinition(tx, view.entityDefinitionId);
    const columns: FrozenColumn[] = [];
    const seen = new Set<string>();
    const add = (c: FrozenColumn) => {
      const key = `${JSON.stringify(c.path)}:${c.field ?? ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      columns.push(c);
    };
    // Kanban: the grouping attribute first, then the card attributes (the view's columns).
    const groupBy = view.type === 'kanban' ? (view.kanban?.groupBy ?? view.kanbanPivotPath) : null;
    if (groupBy) add({ title: null, path: groupBy, field: null, displayConfiguration: {} });
    for (const c of view.columns) {
      add({
        title: c.title,
        path: c.path,
        field: c.field,
        displayConfiguration: c.displayConfiguration as ColumnFormat,
      });
    }
    const memberId = actingMemberId(tx.ctx);
    const prefs = memberId
      ? await tx.db
          .selectFrom('member_preferences')
          .select(['locale', 'time_zone'])
          .where('member_id', '=', memberId)
          .executeTakeFirst()
      : undefined;
    const locale = canonicalLocale(data.locale) ?? canonicalLocale(prefs?.locale) ?? 'en-US';
    const zoneCandidate = data.timeZone ?? prefs?.time_zone ?? 'UTC';
    const timeZone = isValidTimeZone(zoneCandidate) ? zoneCandidate : 'UTC';
    const id = data.exportId ?? newId();
    // "<List or object name> - <View title> Export" (export.md E3): a list is named by its collection.
    const list =
      def.entityType === 'collection-entry'
        ? await tx.db.selectFrom('collections').select('name').where('id', '=', def.id).executeTakeFirst()
        : undefined;
    const name = `${list?.name ?? def.pluralNoun} - ${view.title}`;
    await tx.db
      .insertInto('entity_definition_exports')
      .values({
        id,
        workspace_id: tx.workspaceId,
        entity_definition_id: def.id,
        view_id: view.id,
        title: `${name} Export`,
        file_name: `${safeFileName(name)}.csv`,
        filter: jsonb(view.filter),
        sorts: jsonb(
          view.sorts.map(({ path, field, direction }) => ({ path, direction, ...(field ? { field } : {}) })),
        ),
        attributes: jsonb(columns),
        locale,
        time_zone: timeZone,
        created_by: jsonb(tx.ctx.actor),
        created_at: tx.now,
        updated_at: tx.now,
      })
      .execute();
    await deps.jobs.send(tx, 'export.run', { workspaceId: tx.workspaceId, exportId: id }, { singletonKey: id });
    const row = await requireExport(tx, id);
    await touchExport(tx, row);
    return { exportId: id, export: toExport(row) };
  },

  async status(tx: Tx, exportId: string): Promise<ExportJob> {
    return toExport(await requireExport(tx, exportId));
  },

  async downloadUrl(tx: Tx, deps: ExportDeps, exportId: string): Promise<ExportDownloadUrlOutput> {
    const row = await requireExport(tx, exportId);
    if (row.status !== 'complete' || !row.object_key) {
      throw new DomainError(409, 'EXPORT_NOT_READY', 'The export has not completed', {
        export_id: row.id,
        status: row.status,
      });
    }
    const url = deps.storage.presignGet(row.object_key, {
      expiresInSeconds: EXPORT_DOWNLOAD_TTL_SECONDS,
      filename: row.file_name,
      disposition: 'attachment',
      contentType: EXPORT_CONTENT_TYPE,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
      fileName: row.file_name,
    };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Worker

interface PreparedColumn {
  header: string;
  /** null = a column whose attribute no longer exists (left blank). */
  defs: DefInfo[] | null;
  attrs: AttrDef[];
  field: string | null;
  format: ColumnFormat;
}

async function prepareColumns(tx: Tx, def: DefInfo, columns: FrozenColumn[]): Promise<PreparedColumn[]> {
  const out: PreparedColumn[] = [];
  for (const c of columns) {
    try {
      const { defs, attrs } = await walkPath(tx, def, c.path);
      const last = attrs[attrs.length - 1] as AttrDef;
      const header =
        c.title ??
        attrs
          .map((a) => (isParentRecordAttr(a) ? null : a.title))
          .filter(Boolean)
          .join(' › ');
      out.push({ header: header || last.title, defs, attrs, field: c.field, format: c.displayConfiguration ?? {} });
    } catch {
      out.push({ header: c.title ?? 'Deleted attribute', defs: null, attrs: [], field: c.field, format: {} });
    }
  }
  return out;
}

/** Current values of `attr` on instances, in display order, as read forms. */
async function readAttr(tx: Tx, attr: AttrDef, instanceIds: string[]): Promise<Map<string, unknown[]>> {
  const out = new Map<string, unknown[]>();
  if (instanceIds.length === 0) return out;
  if (attr.systemAttributeType === 'id') {
    for (const id of instanceIds) out.set(id, [id]);
    return out;
  }
  const rows = await tx.db
    .selectFrom('attribute_values')
    .selectAll()
    .where('instance_id', 'in', instanceIds)
    .where('attribute_id', '=', attr.id)
    .where('active_until', 'is', null)
    .orderBy('instance_id')
    .orderBy('sort_order')
    .orderBy('active_from')
    .orderBy('id')
    .execute();
  for (const r of rows) out.set(r.instance_id, [...(out.get(r.instance_id) ?? []), readValue(attr.type, r)]);
  return out;
}

/** Values at the end of a path for each row: references are followed (all targets, in order). */
async function readPath(tx: Tx, column: PreparedColumn, ids: string[]): Promise<Map<string, unknown[]>> {
  let frontier = new Map<string, string[]>(ids.map((id) => [id, [id]]));
  for (let i = 0; i < column.attrs.length - 1; i++) {
    const attr = column.attrs[i] as AttrDef;
    const all = [...new Set([...frontier.values()].flat())];
    const refs = await readAttr(tx, attr, all);
    const next = new Map<string, string[]>();
    for (const [row, instances] of frontier) {
      next.set(
        row,
        instances.flatMap((inst) =>
          (refs.get(inst) ?? []).map((v) => (v as { entityInstanceId: string }).entityInstanceId),
        ),
      );
    }
    frontier = next;
  }
  const last = column.attrs[column.attrs.length - 1] as AttrDef;
  const values = await readAttr(tx, last, [...new Set([...frontier.values()].flat())]);
  return new Map([...frontier].map(([row, instances]) => [row, instances.flatMap((inst) => values.get(inst) ?? [])]));
}

async function buildLines(
  tx: Tx,
  def: DefInfo,
  columns: PreparedColumn[],
  ids: string[],
  settings: ExportFormatSettings,
): Promise<string[]> {
  const isList = def.entityType === 'collection-entry';
  const parentAttr = isList ? def.attrs.find(isParentRecordAttr) : undefined;
  const parents = parentAttr ? await readAttr(tx, parentAttr, ids) : new Map<string, unknown[]>();
  const parentOf = (id: string) =>
    (parents.get(id)?.[0] as { entityDefinitionId: string; entityInstanceId: string } | undefined) ?? null;
  const cells = await Promise.all(columns.map((c) => (c.defs ? readPath(tx, c, ids) : Promise.resolve(new Map()))));

  // Lookups: option / stage titles, member names, record labels (the rows' own labels too).
  const optionAttrIds = [
    ...new Set(
      columns.flatMap((c) => c.attrs.filter((a) => a.type === 'select' || a.type === 'pipeline').map((a) => a.id)),
    ),
  ];
  const options = new Map<string, string>();
  if (optionAttrIds.length > 0) {
    const rows = await tx.db
      .selectFrom('select_options')
      .select(['id', 'title'])
      .where('attribute_id', 'in', optionAttrIds)
      .execute();
    for (const r of rows) options.set(r.id, r.title);
  }
  const memberRows = await tx.db
    .selectFrom('workspace_members')
    .select(['id', 'first_name', 'last_name', 'email_address'])
    .execute();
  const members = new Map(
    memberRows.map((m) => [m.id, [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.email_address]),
  );
  const refs: { entityDefinitionId: string; entityInstanceId: string }[] = [];
  columns.forEach((c, i) => {
    if (c.attrs.at(-1)?.type !== 'entity-reference') return;
    for (const values of (cells[i] as Map<string, unknown[]>).values()) {
      for (const v of values) refs.push(v as { entityDefinitionId: string; entityInstanceId: string });
    }
  });
  for (const id of ids) {
    const parent = parentOf(id);
    if (parent) refs.push(parent);
    else if (!isList) refs.push({ entityDefinitionId: def.id, entityInstanceId: id });
  }
  const labels = await recordLabels(tx, refs);
  const lookups: FormatLookups = {
    optionTitle: (id) => options.get(id),
    memberName: (id) => members.get(id),
    recordLabel: (id) => labels.get(id) ?? undefined,
  };
  return ids.map((id) => {
    const parent = parentOf(id);
    const head = isList
      ? [id, parent?.entityInstanceId ?? '', parent ? (labels.get(parent.entityInstanceId) ?? '') : '']
      : [id, labels.get(id) ?? ''];
    const rest = columns.map((c, i) => {
      if (!c.defs) return '';
      const values = (cells[i] as Map<string, unknown[]>).get(id) ?? [];
      return formatCell(c.attrs.at(-1) as AttrDef, values, c.field, c.format, lookups, settings);
    });
    return csvLine([...head, ...rest], settings.formulaPrefix === true);
  });
}

function headerLine(def: DefInfo, columns: PreparedColumn[], parentDef: DefInfo | null, protect = false): string {
  if (def.entityType === 'collection-entry') {
    return csvLine(
      ['Entry ID', 'Record ID', parentDef?.singularNoun ?? 'Record', ...columns.map((c) => c.header)],
      protect,
    );
  }
  return csvLine(['Record ID', labelAttr(def)?.title ?? def.singularNoun, ...columns.map((c) => c.header)], protect);
}

function exportContext(row: { workspace_id: string; created_by: unknown }): ServiceContext {
  const creator = toActor(row.created_by);
  return creator.type === 'workspace-member' && creator.id
    ? memberContext(row.workspace_id, creator.id)
    : systemContext(row.workspace_id, 'export');
}

/** Runs one export to completion (idempotent: a finished export is left alone). */
export async function executeExport(
  database: Database,
  storage: ObjectStorage,
  workspaceId: string,
  exportId: string,
): Promise<ExportJob> {
  const sys = systemContext(workspaceId, 'export');
  const start = await runInWorkspace(database, sys, async (tx) => {
    const row = await requireExport(tx, exportId, true);
    if (row.status === 'complete' || row.status === 'failed') return { row, run: false };
    await tx.db
      .updateTable('entity_definition_exports')
      .set({ status: 'in-progress', progress: 0, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await touchExport(tx, row);
    return { row, run: true };
  });
  if (!start.run) return toExport(start.row);
  const ctx = exportContext(start.row);
  const settings: ExportFormatSettings = {
    locale: start.row.locale,
    timeZone: start.row.time_zone,
    formulaPrefix: await runInWorkspace(database, sys, (tx) => exportFormulaInjectionPrefix(tx)),
  };
  // The view's query as the exporting member (dynamic filters such as "current member" resolve to them).
  const snapshot = await runInWorkspace(database, ctx, (tx) =>
    viewOps.query(tx, {
      entityDefinitionId: start.row.entity_definition_id,
      filter: (start.row.filter ?? null) as Predicate | null,
      sorts: (start.row.sorts ?? []) as Sort[],
      timeZone: start.row.time_zone,
      initialRange: { start: 0, size: 0 },
    }),
  );
  if (snapshot.total === 0) {
    return runInWorkspace(database, sys, async (tx) => {
      await tx.db
        .updateTable('entity_definition_exports')
        .set({
          status: 'failed',
          failure_reason: 'instance-count-zero',
          row_count: 0,
          updated_at: tx.now,
          completed_at: tx.now,
        })
        .where('id', '=', exportId)
        .execute();
      const row = await requireExport(tx, exportId);
      await touchExport(tx, row);
      return toExport(row);
    });
  }
  const lines: string[] = [];
  for (let offset = 0; offset < snapshot.total; offset += CHUNK_SIZE) {
    const chunk = await runInWorkspace(database, ctx, async (tx) => {
      const def = await loadDefinition(tx, start.row.entity_definition_id);
      const columns = await prepareColumns(tx, def, (start.row.attributes ?? []) as unknown as FrozenColumn[]);
      if (offset === 0) {
        const parentAttr = def.attrs.find(isParentRecordAttr);
        const parentId = parentAttr?.config.entityReferenceConfiguration?.allowedEntityDefinitionIds?.[0];
        const parentDef = parentId ? await loadDefinition(tx, parentId).catch(() => null) : null;
        lines.push(headerLine(def, columns, parentDef, settings.formulaPrefix === true));
      }
      const { ids } = await viewOps.chunk(tx, { snapshotId: snapshot.snapshotId, start: offset, size: CHUNK_SIZE });
      return buildLines(tx, def, columns, ids, settings);
    });
    lines.push(...chunk);
    const done = Math.min(snapshot.total, offset + CHUNK_SIZE);
    await runInWorkspace(database, sys, async (tx) => {
      const row = await requireExport(tx, exportId);
      await tx.db
        .updateTable('entity_definition_exports')
        .set({ progress: Math.min(99, Math.floor((done / snapshot.total) * 100)), updated_at: tx.now })
        .where('id', '=', exportId)
        .execute();
      await touchExport(tx, row);
    });
  }
  const bytes = csvBytes(lines);
  const key = `exports/${workspaceId}/${exportId}.csv`;
  await storage.put(key, bytes, EXPORT_CONTENT_TYPE);
  return runInWorkspace(database, sys, async (tx) => {
    await tx.db
      .updateTable('entity_definition_exports')
      .set({
        status: 'complete',
        progress: 100,
        row_count: lines.length - 1,
        content_size: bytes.byteLength,
        object_key: key,
        updated_at: tx.now,
        completed_at: tx.now,
      })
      .where('id', '=', exportId)
      .execute();
    const row = await requireExport(tx, exportId);
    await touchExport(tx, row);
    return toExport(row);
  });
}

/** After the last retry: "Failed to export". */
export async function failExport(database: Database, workspaceId: string, exportId: string): Promise<void> {
  await runInWorkspace(database, systemContext(workspaceId, 'export'), async (tx) => {
    const row = await requireExport(tx, exportId, true);
    if (row.status === 'complete' || row.status === 'failed') return;
    await tx.db
      .updateTable('entity_definition_exports')
      .set({ status: 'failed', failure_reason: 'unknown-error', updated_at: tx.now, completed_at: tx.now })
      .where('id', '=', exportId)
      .execute();
    await touchExport(tx, row);
  });
}
