// Workflow rows → contract shapes, access resolution (resource kind 'workflow', B.12), version hashing for
// "unpublished changes", and version copies (commit / fork).
import { createHash } from 'node:crypto';
import {
  type AccessScope,
  type BlockIssue,
  blockDefinition,
  kindFlagsForScope,
  type Workflow,
  type WorkflowBlock,
  type WorkflowPath,
  type WorkflowVersion,
  type WorkflowVersionSummary,
} from '@agentic-crm/contracts';
import { jsonb, type Selectable, sql, type WorkflowsTable, type WorkflowVersionsTable } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { forbidden, notFound } from '../errors.ts';
import { loadResourceGrants } from '../permissions/grants.ts';
import { effectiveAccess, principalOf } from '../permissions/resolve.ts';
import { subjectOf } from '../permissions.ts';
import type { Tx } from '../tx.ts';
import { type BlockRow, type Graph, loadGraph, outcomesOf, type Typing } from './graph.ts';
import { type Checklist, checklistOf } from './validate.ts';

export type WorkflowRow = Selectable<WorkflowsTable>;
export type VersionRow = Selectable<WorkflowVersionsTable>;

export const UNTITLED = 'Untitled Workflow';

export const workflowNotFound = (id: string) =>
  notFound('The requested Workflow could not be found', { workflow_id: id });

export async function loadWorkflow(tx: Tx, id: string, options: { forUpdate?: boolean } = {}): Promise<WorkflowRow> {
  const row = await tx.db
    .selectFrom('workflows')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .$if(options.forUpdate === true, (q) => q.forUpdate())
    .executeTakeFirst();
  if (!row) throw workflowNotFound(id);
  return row;
}

export type WorkflowFlag =
  | 'administrate_workflow_permissions'
  | 'read_workflow'
  | 'update_workflow'
  | 'delete_workflow';

export interface WorkflowAccess {
  level: AccessScope;
  flags: Record<string, boolean>;
}

/** The caller's effective access to workflows (workspace / team / member grants; trusted callers: full). */
export async function accessOf(tx: Tx, workflowIds: string[]): Promise<Map<string, WorkflowAccess>> {
  const out = new Map<string, WorkflowAccess>();
  if (workflowIds.length === 0) return out;
  const grants = await loadResourceGrants(tx, 'workflow', workflowIds);
  const principal = await principalOf(tx, await subjectOf(tx));
  for (const id of workflowIds) {
    const { level } = effectiveAccess('workflow', grants.get(id), principal);
    out.set(id, { level, flags: kindFlagsForScope('workflow', level) });
  }
  return out;
}

/** Throws 404 when the caller cannot see the workflow, 403 when the flag is missing. */
export async function requireFlag(tx: Tx, row: WorkflowRow, flag: WorkflowFlag): Promise<WorkflowAccess> {
  const access = (await accessOf(tx, [row.id])).get(row.id) as WorkflowAccess;
  if (!access.flags.read_workflow) throw workflowNotFound(row.id);
  if (!access.flags[flag]) {
    throw forbidden('You do not have permission to do this', { workflow_id: row.id, action: flag });
  }
  return access;
}

// ---------------------------------------------------------------------------------------------------------------
// Hashing (draft vs latest published)

export function graphHash(graph: Graph): string {
  const blocks = [...graph.blocks.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((b) => [b.id, b.slug, b.block_version, b.description, b.position, b.config]);
  const paths = graph.paths
    .map((p) => [p.source_block_id, p.source_outcome, p.target_block_id])
    .sort((a, b) => (a.join() < b.join() ? -1 : 1));
  return createHash('sha256')
    .update(JSON.stringify([blocks, paths]))
    .digest('hex');
}

export async function latestPublishedVersion(tx: Tx, workflowId: string): Promise<VersionRow | undefined> {
  return tx.db
    .selectFrom('workflow_versions')
    .selectAll()
    .where('workflow_id', '=', workflowId)
    .where('type', '=', 'immutable')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export async function hasUnpublishedChanges(tx: Tx, row: WorkflowRow, draft?: Graph): Promise<boolean> {
  const graph = draft ?? (await loadGraph(tx, row.draft_version_id));
  const latest = await latestPublishedVersion(tx, row.id);
  if (!latest) return graph.blocks.size > 0;
  return graphHash(graph) !== graphHash(await loadGraph(tx, latest.id));
}

// ---------------------------------------------------------------------------------------------------------------
// Shapes

export async function toWorkflows(tx: Tx, rows: WorkflowRow[]): Promise<Workflow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const memberId = actingMemberId(tx.ctx);
  const [access, favorites, subscriptions, triggers, latest] = await Promise.all([
    accessOf(tx, ids),
    memberId
      ? tx.db
          .selectFrom('favorites')
          .select('target_id')
          .where('member_id', '=', memberId)
          .where('favorite_type', '=', 'workflow')
          .where('target_id', 'in', ids)
          .execute()
      : [],
    memberId
      ? tx.db
          .selectFrom('workflow_notification_subscriptions')
          .select('workflow_id')
          .where('member_id', '=', memberId)
          .where('workflow_id', 'in', ids)
          .execute()
      : [],
    tx.db
      .selectFrom('workflow_blocks')
      .select(['version_id', 'slug'])
      .where(
        'version_id',
        'in',
        rows.map((r) => r.draft_version_id),
      )
      .where('block_type', '=', 'trigger')
      .execute(),
    sql<{ workflow_id: string; id: string }>`
      SELECT DISTINCT ON (workflow_id) workflow_id, id FROM workflow_versions
      WHERE workflow_id = ANY(${ids}::uuid[]) AND type = 'immutable'
      ORDER BY workflow_id, created_at DESC, id DESC`.execute(tx.db),
  ]);
  const favs = new Set(favorites.map((f) => f.target_id));
  const subs = new Set(subscriptions.map((s) => s.workflow_id));
  const latestOf = new Map(latest.rows.map((r) => [r.workflow_id, r.id]));
  const out: Workflow[] = [];
  for (const r of rows) {
    const a = access.get(r.id) as WorkflowAccess;
    out.push({
      id: r.id,
      workspaceId: r.workspace_id,
      title: r.title,
      displayTitle: r.title?.trim() ? r.title : (r.ai_title ?? UNTITLED),
      description: r.description,
      aiTitle: r.ai_title,
      aiDescription: r.ai_description,
      status: r.status,
      isTransient: r.is_transient,
      isArchived: r.is_archived,
      draftVersionId: r.draft_version_id,
      activeVersionId: r.active_version_id,
      latestPublishedVersionId: latestOf.get(r.id) ?? null,
      firstSetLiveAt: r.first_set_live_at,
      lastPublishedAt: r.last_published_at,
      lastStatusChangeAt: r.last_status_change_at,
      lastRunFailedAt: r.last_run_failed_at,
      timezone: r.timezone,
      maxCreditsPerRun: r.max_credits_per_run,
      dismissedCycleWarning: r.dismissed_cycle_warning,
      runCount: r.run_count,
      isFavorite: favs.has(r.id),
      triggerSlugs: triggers.filter((t) => t.version_id === r.draft_version_id).map((t) => t.slug),
      hasUnpublishedChanges: await hasUnpublishedChanges(tx, r),
      access: { level: a.level, flags: a.flags },
      failureNotifications: subs.has(r.id),
      createdBy: r.created_by as Workflow['createdBy'],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  return out;
}

export async function toWorkflow(tx: Tx, row: WorkflowRow): Promise<Workflow> {
  return (await toWorkflows(tx, [row]))[0] as Workflow;
}

export function toBlock(t: Typing, block: BlockRow, issues: BlockIssue[]): WorkflowBlock {
  const def = blockDefinition(block.slug);
  return {
    id: block.id,
    versionId: block.version_id,
    blockType: block.block_type,
    slug: block.slug,
    blockVersion: block.block_version,
    title: def?.title ?? block.slug,
    category: def?.category ?? 'misc',
    description: block.description,
    position: block.position,
    config: block.config,
    outcomes: outcomesOf(t, block),
    cost: def?.cost ?? { type: 'free' },
    issues,
    createdAt: block.created_at,
    updatedAt: block.updated_at,
  };
}

export function toPath(p: Graph['paths'][number]): WorkflowPath {
  return {
    id: p.id,
    versionId: p.version_id,
    sourceBlockId: p.source_block_id,
    outcome: p.source_outcome,
    targetBlockId: p.target_block_id,
    createdAt: p.created_at,
  };
}

export function versionStatus(
  row: WorkflowRow,
  v: VersionRow,
  latestId: string | null,
): WorkflowVersionSummary['status'] {
  if (v.type === 'draft') return 'draft';
  if (row.active_version_id === v.id) return 'live';
  if (row.status === 'paused' && latestId === v.id) return 'paused';
  return 'superseded';
}

export async function toVersionSummaries(
  tx: Tx,
  row: WorkflowRow,
  versions: VersionRow[],
): Promise<WorkflowVersionSummary[]> {
  const latest = await latestPublishedVersion(tx, row.id);
  const publishedAt = new Map(versions.map((v) => [v.id, v.published_at]));
  const restoredIds = versions.map((v) => v.restored_from_version_id).filter((id): id is string => id !== null);
  if (restoredIds.length > 0) {
    const rows = await tx.db
      .selectFrom('workflow_versions')
      .select(['id', 'published_at'])
      .where('id', 'in', restoredIds)
      .execute();
    for (const r of rows) publishedAt.set(r.id, r.published_at);
  }
  return versions.map((v) => ({
    id: v.id,
    type: v.type,
    status: versionStatus(row, v, latest?.id ?? null),
    baseVersionId: v.base_version_id,
    restoredFrom: v.restored_from_version_id
      ? { versionId: v.restored_from_version_id, publishedAt: publishedAt.get(v.restored_from_version_id) ?? null }
      : null,
    publishedAt: v.published_at,
    publishedBy: (v.published_by as WorkflowVersionSummary['publishedBy']) ?? null,
    createdAt: v.created_at,
  }));
}

export function toVersion(
  summary: WorkflowVersionSummary,
  t: Typing,
  issues: Map<string, BlockIssue[]>,
): WorkflowVersion {
  const checklist: Checklist = checklistOf(t.graph, issues);
  return {
    ...summary,
    blocks: [...t.graph.blocks.values()].map((b) => toBlock(t, b, issues.get(b.id) ?? [])),
    paths: t.graph.paths.map(toPath),
    checklist,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Version copies

/** Copies blocks (same ids) and paths (new ids) of one version into another. */
export async function copyVersionContent(tx: Tx, fromVersionId: string, toVersionId: string, workflowId: string) {
  const actor = jsonb(tx.ctx.actor);
  await sql`
    INSERT INTO workflow_blocks (version_id, id, workspace_id, workflow_id, block_type, slug, block_version,
      description, position, config, created_by, created_at, updated_at)
    SELECT ${toVersionId}::uuid, b.id, b.workspace_id, ${workflowId}::uuid, b.block_type, b.slug, b.block_version,
      b.description, b.position, b.config, ${actor}::jsonb, b.created_at, b.updated_at
    FROM workflow_blocks b WHERE b.version_id = ${fromVersionId}::uuid`.execute(tx.db);
  await sql`
    INSERT INTO workflow_paths (version_id, id, workspace_id, workflow_id, source_block_id, source_outcome,
      target_block_id, created_at)
    SELECT ${toVersionId}::uuid, gen_random_uuid(), p.workspace_id, ${workflowId}::uuid, p.source_block_id,
      p.source_outcome, p.target_block_id, p.created_at
    FROM workflow_paths p WHERE p.version_id = ${fromVersionId}::uuid`.execute(tx.db);
}
