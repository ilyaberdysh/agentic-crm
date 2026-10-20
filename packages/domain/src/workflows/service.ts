// workflows.* (BACKLOG 8.01–8.05, 8.10; G README §2–3, internal-api §1, §3, §6): the index, transient creation,
// header edits, the draft (blocks, paths, Organize), validation with per-input issues, the variable picker, publish
// (commit the draft into an immutable version + activate), enable / disable, discard draft and restore (fork a version
// into a new draft), version history, settings (timezone, failure notifications), duplicate and delete.
// Every edit goes to the draft only; the immutable versions never change.
import {
  type BlockIssue,
  blockDefinition,
  type ConnectBlocksInput,
  type CreateWorkflowInput,
  connectBlocksInputSchema,
  createWorkflowInputSchema,
  type DeleteBlockInput,
  type DiscardDraftInput,
  type DisconnectBlocksInput,
  type DuplicateWorkflowInput,
  deleteBlockInputSchema,
  discardDraftInputSchema,
  disconnectBlocksInputSchema,
  duplicateWorkflowInputSchema,
  type GetWorkflowInput,
  getWorkflowInputSchema,
  type ListWorkflowsInput,
  listWorkflowsInputSchema,
  type OrganizeBlocksInput,
  organizeBlocksInputSchema,
  type Position,
  type PublishWorkflowInput,
  type PutBlockInput,
  publishWorkflowInputSchema,
  putBlockInputSchema,
  type RestoreVersionInput,
  restoreVersionInputSchema,
  type UpdateWorkflowInput,
  type UpdateWorkflowSettingsInput,
  updateWorkflowInputSchema,
  updateWorkflowSettingsInputSchema,
  type VariablesInput,
  variablesInputSchema,
  type WfType,
  WORKFLOW_LIMITS,
  type Workflow,
  type WorkflowBlock,
  type WorkflowIdInput,
  type WorkflowPath,
  type WorkflowVersion,
  type WorkflowVersionSummary,
  workflowIdInputSchema,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, conflict, DomainError } from '../errors.ts';
import { newId } from '../ids.ts';
import { isAdminCaller } from '../permissions/admin.ts';
import { grantDefaultsOnCreate } from '../permissions/service.ts';
import { isValidTimeZone } from '../time.ts';
import type { Tx } from '../tx.ts';
import { activateVersion, deactivate } from './activation.ts';
import {
  attributeType,
  type BlockRow,
  type Graph,
  isListDef,
  loadGraph,
  loadTypeEnv,
  outcomesOf,
  type Typing,
  typing,
  upstreamOf,
} from './graph.ts';
import {
  accessOf,
  copyVersionContent,
  latestPublishedVersion,
  loadWorkflow,
  requireFlag,
  toBlock,
  toPath,
  toVersion,
  toVersionSummaries,
  toWorkflow,
  toWorkflows,
  UNTITLED,
  type WorkflowRow,
} from './model.ts';
import { checklistOf, validateGraph } from './validate.ts';

const stateConflict = (message: string, details: Record<string, unknown> = {}) =>
  conflict('WORKFLOW_STATE_CONFLICT', message, details);

function emitWorkflow(tx: Tx, workflowId: string): void {
  tx.emit('workflow', workflowId, { workflowId });
  tx.emit('workflow-list', null);
}

async function typed(tx: Tx, graph: Graph): Promise<Typing> {
  return typing(graph, await loadTypeEnv(tx));
}

/** Marks a draft edit: the workflow stops being transient and clients refetch it. */
async function touch(tx: Tx, row: WorkflowRow): Promise<void> {
  await tx.db
    .updateTable('workflows')
    .set({ is_transient: false, updated_at: tx.now })
    .where('id', '=', row.id)
    .execute();
  emitWorkflow(tx, row.id);
}

async function editable(tx: Tx, workflowId: string): Promise<WorkflowRow> {
  const row = await loadWorkflow(tx, workflowId, { forUpdate: true });
  await requireFlag(tx, row, 'update_workflow');
  return row;
}

async function versionOf(tx: Tx, row: WorkflowRow, versionId: string | undefined) {
  const id = versionId ?? row.draft_version_id;
  const v = await tx.db
    .selectFrom('workflow_versions')
    .selectAll()
    .where('id', '=', id)
    .where('workflow_id', '=', row.id)
    .executeTakeFirst();
  if (!v) throw badRequest('VALIDATION_ERROR', 'Unknown workflow version', { workflow_version_id: id });
  return v;
}

async function versionDetail(tx: Tx, row: WorkflowRow, versionId?: string): Promise<WorkflowVersion> {
  const v = await versionOf(tx, row, versionId);
  const t = await typed(tx, await loadGraph(tx, v.id));
  const [summary] = await toVersionSummaries(tx, row, [v]);
  return toVersion(summary as WorkflowVersionSummary, t, validateGraph(t));
}

async function blockView(tx: Tx, row: WorkflowRow, blockId: string): Promise<WorkflowBlock> {
  const t = await typed(tx, await loadGraph(tx, row.draft_version_id));
  const block = t.graph.blocks.get(blockId) as BlockRow;
  return toBlock(t, block, validateGraph(t).get(blockId) ?? []);
}

/** Creates the draft version row of a workflow. */
async function insertDraft(tx: Tx, workflowId: string, id: string, base: string | null, restoredFrom: string | null) {
  await tx.db
    .insertInto('workflow_versions')
    .values({
      id,
      workspace_id: tx.workspaceId,
      workflow_id: workflowId,
      type: 'draft',
      base_version_id: base,
      restored_from_version_id: restoredFrom,
      published_at: null,
      published_by: null,
      activation_status: null,
      activated_at: null,
      deactivated_at: null,
      created_by: jsonb(tx.ctx.actor),
    })
    .execute();
}

/** Replaces the draft by a copy of `sourceVersionId` (discard changes, restore a version). */
async function forkIntoDraft(tx: Tx, row: WorkflowRow, sourceVersionId: string, draftId: string, restored: boolean) {
  if (draftId === row.draft_version_id) throw badRequest('VALIDATION_ERROR', 'The new draft needs a new id');
  await insertDraft(tx, row.id, draftId, sourceVersionId, restored ? sourceVersionId : null);
  await copyVersionContent(tx, sourceVersionId, draftId, row.id);
  await tx.db
    .updateTable('workflows')
    .set({ draft_version_id: draftId, updated_at: tx.now })
    .where('id', '=', row.id)
    .execute();
  // The replaced draft is never referenced by runs (they run immutable versions).
  await tx.db.deleteFrom('workflow_versions').where('id', '=', row.draft_version_id).execute();
  emitWorkflow(tx, row.id);
}

/** Left-to-right layout: columns 270 px apart by depth from the triggers, rows 150 px apart (README §3 Organize). */
function autoLayout(graph: Graph): Map<string, Position> {
  const depth = new Map<string, number>();
  const bySource = new Map<string, string[]>();
  for (const p of graph.paths)
    bySource.set(p.source_block_id, [...(bySource.get(p.source_block_id) ?? []), p.target_block_id]);
  const blocks = [...graph.blocks.values()];
  const queue = blocks.filter((b) => b.block_type === 'trigger').map((b) => b.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const target of bySource.get(id) ?? []) {
      if (depth.has(target)) continue;
      depth.set(target, (depth.get(id) ?? 0) + 1);
      queue.push(target);
    }
  }
  let maxDepth = Math.max(0, ...depth.values());
  for (const b of blocks) if (!depth.has(b.id)) depth.set(b.id, ++maxDepth);
  const rows = new Map<number, number>();
  const out = new Map<string, Position>();
  for (const b of blocks) {
    const column = depth.get(b.id) as number;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    out.set(b.id, { x: column * 270, y: row * 150 });
  }
  return out;
}

export interface VariablePicker {
  blocks: {
    blockId: string;
    slug: string;
    title: string;
    distance: number;
    outcomes: { slug: string; label: string; outputs: { key: string; label: string; type: WfType }[] | null }[];
  }[];
  definitions: {
    id: string;
    kind: 'object' | 'list';
    title: string;
    attributes: {
      id: string;
      apiSlug: string;
      title: string;
      attributeType: string;
      isMultiselect: boolean;
      type: WfType;
    }[];
  }[];
}

export const workflowOps = {
  async list(tx: Tx, input: ListWorkflowsInput = {}): Promise<{ workflows: Workflow[] }> {
    const data = listWorkflowsInputSchema.parse(input);
    const admin = data.admin === true && (await isAdminCaller(tx));
    if (data.admin && !admin) throw badRequest('VALIDATION_ERROR', 'Only workspace admins can list every workflow');
    let ids: string[] | null = null;
    if (data.actionFor) {
      const slug =
        data.actionFor.kind === 'record'
          ? 'on-record-action'
          : data.actionFor.kind === 'list-entry'
            ? 'on-list-entry-action'
            : 'on-note-action';
      const env = await loadTypeEnv(tx);
      const defId = data.actionFor.entityDefinitionId ? (env.def(data.actionFor.entityDefinitionId)?.id ?? null) : null;
      const rows = await tx.db
        .selectFrom('workflow_triggers')
        .select('workflow_id')
        .where('slug', '=', slug)
        .$if(defId !== null, (q) => q.where('entity_definition_id', '=', defId as string))
        .execute();
      ids = rows.map((r) => r.workflow_id);
      if (ids.length === 0) return { workflows: [] };
    }
    const rows = await tx.db
      .selectFrom('workflows')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('is_transient', '=', false)
      .$if(!data.includeArchived, (q) => q.where('is_archived', '=', false))
      .$if(ids !== null, (q) => q.where('id', 'in', ids as string[]))
      .$if(data.actionFor !== undefined, (q) => q.where('status', '=', 'live'))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    const createdBy = data.createdByMemberIds ? new Set(data.createdByMemberIds) : null;
    const filtered = rows.filter((r) => {
      if (!createdBy) return true;
      const actor = r.created_by as { type?: string; id?: string };
      return actor.type === 'workspace-member' && createdBy.has(actor.id ?? '');
    });
    const access = await accessOf(
      tx,
      filtered.map((r) => r.id),
    );
    const visible = admin ? filtered : filtered.filter((r) => access.get(r.id)?.flags.read_workflow);
    return { workflows: await toWorkflows(tx, visible) };
  },

  async get(tx: Tx, input: GetWorkflowInput): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const data = getWorkflowInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId);
    await requireFlag(tx, row, 'read_workflow');
    return { workflow: await toWorkflow(tx, row), version: await versionDetail(tx, row, data.versionId) };
  },

  /** "New workflow": a transient draft (hidden from lists until its first edit). Replays answer the stored one. */
  async create(tx: Tx, input: CreateWorkflowInput): Promise<Workflow> {
    const data = createWorkflowInputSchema.parse(input);
    const existing = await tx.db.selectFrom('workflows').selectAll().where('id', '=', data.id).executeTakeFirst();
    if (existing) {
      if (existing.deleted_at !== null)
        throw conflict('ID_CONFLICT', 'This workflow id belonged to a deleted workflow');
      await requireFlag(tx, existing, 'read_workflow');
      return toWorkflow(tx, existing);
    }
    const draftId = data.draftVersionId ?? newId();
    const title = data.title?.trim() ? data.title.trim() : null;
    await tx.db
      .insertInto('workflows')
      .values({
        id: data.id,
        workspace_id: tx.workspaceId,
        title,
        description: null,
        ai_title: null,
        ai_description: null,
        is_transient: title === null,
        draft_version_id: draftId,
        active_version_id: null,
        first_set_live_at: null,
        last_published_at: null,
        last_status_change_at: null,
        last_run_failed_at: null,
        timezone: null,
        created_by: jsonb(tx.ctx.actor),
        deleted_at: null,
      })
      .execute();
    await insertDraft(tx, data.id, draftId, null, null);
    // Workspace: Full access; the creator: Full access (internal-api §6, X-06).
    await grantDefaultsOnCreate(tx, 'workflow', data.id);
    const member = actingMemberId(tx.ctx);
    if (member) {
      // Failure notifications are on by default for the creator (README §3.6).
      await tx.db
        .insertInto('workflow_notification_subscriptions')
        .values({ id: newId(), workspace_id: tx.workspaceId, workflow_id: data.id, member_id: member })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    emitWorkflow(tx, data.id);
    return toWorkflow(tx, await loadWorkflow(tx, data.id));
  },

  async update(tx: Tx, input: UpdateWorkflowInput): Promise<Workflow> {
    const data = updateWorkflowInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    if (data.timezone && !isValidTimeZone(data.timezone)) {
      throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timezone}"`);
    }
    if (data.isArchived === true && row.status === 'live') await deactivate(tx, row);
    await tx.db
      .updateTable('workflows')
      .set({
        ...(data.title !== undefined ? { title: data.title?.trim() ? data.title.trim() : null } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() ? data.description : null } : {}),
        ...(data.isArchived !== undefined ? { is_archived: data.isArchived } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone ?? null } : {}),
        ...(data.maxCreditsPerRun !== undefined ? { max_credits_per_run: data.maxCreditsPerRun } : {}),
        ...(data.dismissedCycleWarning !== undefined ? { dismissed_cycle_warning: data.dismissedCycleWarning } : {}),
        is_transient: false,
        updated_at: tx.now,
      })
      .where('id', '=', row.id)
      .execute();
    emitWorkflow(tx, row.id);
    return toWorkflow(tx, await loadWorkflow(tx, row.id));
  },

  /** Discard a transient workflow or delete a workflow that never ran (README §3.4). */
  async delete(tx: Tx, input: WorkflowIdInput): Promise<{ deleted: boolean }> {
    const data = workflowIdInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId, { forUpdate: true });
    await requireFlag(tx, row, 'delete_workflow');
    if (row.status === 'live') throw stateConflict('You must disable this workflow before deleting it');
    if (row.run_count > 0) throw stateConflict('Workflows that have been run cannot be deleted');
    await deactivate(tx, row);
    await tx.db
      .updateTable('workflows')
      .set({ deleted_at: tx.now, updated_at: tx.now })
      .where('id', '=', row.id)
      .execute();
    await tx.db.deleteFrom('workflow_notification_subscriptions').where('workflow_id', '=', row.id).execute();
    await tx.db
      .deleteFrom('favorites')
      .where('favorite_type', '=', 'workflow')
      .where('target_id', '=', row.id)
      .execute();
    emitWorkflow(tx, row.id);
    return { deleted: true };
  },

  /** Commit the draft into a new immutable version and make it live (publish / "Publish changes"). */
  async publish(tx: Tx, input: PublishWorkflowInput): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const data = publishWorkflowInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const t = await typed(tx, await loadGraph(tx, row.draft_version_id));
    const issues = validateGraph(t);
    const checklist = checklistOf(t.graph, issues);
    if (checklist.errorCount > 0 || checklist.messages.length > 0) {
      const message =
        checklist.errorCount > 0
          ? `Please fix the ${checklist.errorCount} errors in the workflow and try again.`
          : (checklist.messages[0] as string);
      throw badRequest('WORKFLOW_INVALID', message, {
        checklist,
        issues: Object.fromEntries([...issues.entries()].filter(([, list]) => list.length > 0)),
      });
    }
    const versionId = data.versionId ?? newId();
    const clash = await tx.db
      .selectFrom('workflow_versions')
      .select('id')
      .where('id', '=', versionId)
      .executeTakeFirst();
    if (clash) throw conflict('ID_CONFLICT', 'This version id is already used', { workflow_version_id: versionId });
    await tx.db
      .insertInto('workflow_versions')
      .values({
        id: versionId,
        workspace_id: tx.workspaceId,
        workflow_id: row.id,
        type: 'immutable',
        base_version_id: row.draft_version_id,
        restored_from_version_id: null,
        published_at: tx.now,
        published_by: jsonb(tx.ctx.actor),
        activation_status: 'activating',
        activated_at: null,
        deactivated_at: null,
        created_by: jsonb(tx.ctx.actor),
      })
      .execute();
    await copyVersionContent(tx, row.draft_version_id, versionId, row.id);
    await tx.db
      .updateTable('workflow_versions')
      .set({ base_version_id: versionId, restored_from_version_id: null })
      .where('id', '=', row.draft_version_id)
      .execute();
    await activateVersion(tx, row, versionId, { published: true, now: tx.now });
    emitWorkflow(tx, row.id);
    const after = await loadWorkflow(tx, row.id);
    return { workflow: await toWorkflow(tx, after), version: await versionDetail(tx, after, versionId) };
  },

  /** Live switch on: re-activate the latest published version. */
  async enable(tx: Tx, input: WorkflowIdInput): Promise<Workflow> {
    const data = workflowIdInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    if (row.status === 'live') return toWorkflow(tx, row);
    const latest = await latestPublishedVersion(tx, row.id);
    if (!latest) throw stateConflict('Publish this workflow before enabling it');
    if (row.is_archived) {
      await tx.db.updateTable('workflows').set({ is_archived: false }).where('id', '=', row.id).execute();
    }
    await activateVersion(tx, row, latest.id, { now: tx.now });
    emitWorkflow(tx, row.id);
    return toWorkflow(tx, await loadWorkflow(tx, row.id));
  },

  /** Live switch off: pauses immediately; runs in progress continue on their version. */
  async disable(tx: Tx, input: WorkflowIdInput): Promise<Workflow> {
    const data = workflowIdInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    if (row.status === 'live') await deactivate(tx, row);
    emitWorkflow(tx, row.id);
    return toWorkflow(tx, await loadWorkflow(tx, row.id));
  },

  /** "Discard changes": the draft becomes a copy of the latest published version. */
  async discardDraft(tx: Tx, input: DiscardDraftInput): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const data = discardDraftInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const latest = await latestPublishedVersion(tx, row.id);
    if (!latest) throw stateConflict('This workflow has never been published');
    await forkIntoDraft(tx, row, latest.id, data.draftVersionId ?? newId(), false);
    const after = await loadWorkflow(tx, row.id);
    return { workflow: await toWorkflow(tx, after), version: await versionDetail(tx, after) };
  },

  async versions(tx: Tx, input: WorkflowIdInput): Promise<{ versions: WorkflowVersionSummary[] }> {
    const data = workflowIdInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId);
    await requireFlag(tx, row, 'read_workflow');
    const versions = await tx.db
      .selectFrom('workflow_versions')
      .selectAll()
      .where('workflow_id', '=', row.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .execute();
    // Current draft first, then published versions newest first.
    versions.sort((a, b) => (a.type === b.type ? 0 : a.type === 'draft' ? -1 : 1));
    return { versions: await toVersionSummaries(tx, row, versions) };
  },

  /** "Restore this version": forks the version into a new draft (labelled "restored from"). */
  async restoreVersion(tx: Tx, input: RestoreVersionInput): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const data = restoreVersionInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const source = await versionOf(tx, row, data.versionId);
    if (source.type !== 'immutable') throw badRequest('VALIDATION_ERROR', 'Only published versions can be restored');
    await forkIntoDraft(tx, row, source.id, data.draftVersionId ?? newId(), true);
    const after = await loadWorkflow(tx, row.id);
    return { workflow: await toWorkflow(tx, after), version: await versionDetail(tx, after) };
  },

  async updateSettings(tx: Tx, input: UpdateWorkflowSettingsInput): Promise<Workflow> {
    const data = updateWorkflowSettingsInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId, { forUpdate: true });
    if (data.timezone !== undefined) {
      await requireFlag(tx, row, 'update_workflow');
      if (data.timezone && !isValidTimeZone(data.timezone)) {
        throw badRequest('VALIDATION_ERROR', `Unknown time zone "${data.timezone}"`);
      }
      await tx.db
        .updateTable('workflows')
        .set({ timezone: data.timezone ?? null, updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
    }
    if (data.failureNotifications !== undefined) {
      await requireFlag(tx, row, 'read_workflow');
      const member = actingMemberId(tx.ctx);
      if (!member) throw badRequest('VALIDATION_ERROR', 'Only workspace members can subscribe to failures');
      if (data.failureNotifications) {
        await tx.db
          .insertInto('workflow_notification_subscriptions')
          .values({ id: newId(), workspace_id: tx.workspaceId, workflow_id: row.id, member_id: member })
          .onConflict((oc) => oc.doNothing())
          .execute();
      } else {
        await tx.db
          .deleteFrom('workflow_notification_subscriptions')
          .where('workflow_id', '=', row.id)
          .where('member_id', '=', member)
          .execute();
      }
    }
    emitWorkflow(tx, row.id);
    return toWorkflow(tx, await loadWorkflow(tx, row.id));
  },

  /** "Duplicate workflow": a new draft "Copy of <title>" with the source's draft, not live, no runs. */
  async duplicate(tx: Tx, input: DuplicateWorkflowInput): Promise<Workflow> {
    const data = duplicateWorkflowInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId);
    await requireFlag(tx, row, 'read_workflow');
    const id = data.targetWorkflowId ?? newId();
    const title = `Copy of ${row.title?.trim() ? row.title : (row.ai_title ?? UNTITLED)}`;
    const created = await workflowOps.create(tx, { id, title });
    const copy = await loadWorkflow(tx, created.id);
    await copyVersionContent(tx, row.draft_version_id, copy.draft_version_id, copy.id);
    await tx.db
      .updateTable('workflows')
      .set({
        ai_title: row.ai_title,
        ai_description: row.ai_description,
        description: row.description,
        timezone: row.timezone,
        is_transient: false,
      })
      .where('id', '=', copy.id)
      .execute();
    return toWorkflow(tx, await loadWorkflow(tx, copy.id));
  },

  // -------------------------------------------------------------------------------------------------------------
  // Blocks and paths (draft only)

  /** Create or update a block; a different slug replaces the block in place ("Replace trigger / step"). */
  async putBlock(tx: Tx, input: PutBlockInput): Promise<{ block: WorkflowBlock; workflow: Workflow }> {
    const data = putBlockInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const def = blockDefinition(data.slug);
    if (!def) throw badRequest('VALIDATION_ERROR', `Unknown block "${data.slug}"`);
    const existing = await tx.db
      .selectFrom('workflow_blocks')
      .selectAll()
      .where('version_id', '=', row.draft_version_id)
      .where('id', '=', data.blockId)
      .executeTakeFirst();
    const replacing = existing !== undefined && existing.slug !== data.slug;
    if ((!existing || replacing) && !def.available) {
      throw badRequest('VALIDATION_ERROR', 'This block is not available yet', {
        slug: data.slug,
        reason: def.unavailableReason ?? null,
      });
    }
    const config = data.config ?? (replacing || !existing ? { type: 'object' as const, entries: {} } : undefined);
    if (!existing) {
      const count = await tx.db
        .selectFrom('workflow_blocks')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('version_id', '=', row.draft_version_id)
        .executeTakeFirst();
      if (Number(count?.n ?? 0) >= WORKFLOW_LIMITS.maxBlocks) {
        throw conflict('OVER_USAGE_LIMIT', `Workflows can have a maximum of ${WORKFLOW_LIMITS.maxBlocks} blocks`, {
          limit: WORKFLOW_LIMITS.maxBlocks,
        });
      }
      await tx.db
        .insertInto('workflow_blocks')
        .values({
          version_id: row.draft_version_id,
          id: data.blockId,
          workspace_id: tx.workspaceId,
          workflow_id: row.id,
          block_type: def.blockType,
          slug: def.slug,
          block_version: data.blockVersion ?? def.version,
          description: data.description ?? null,
          position: jsonb(data.position ?? { x: 0, y: 0 }),
          config: jsonb(config),
          created_by: jsonb(tx.ctx.actor),
        })
        .execute();
    } else {
      if (replacing && existing.block_type !== def.blockType) {
        throw badRequest(
          'VALIDATION_ERROR',
          `A ${existing.block_type} can only be replaced by another ${existing.block_type}`,
        );
      }
      await tx.db
        .updateTable('workflow_blocks')
        .set({
          ...(replacing ? { slug: def.slug, block_version: data.blockVersion ?? def.version } : {}),
          ...(!replacing && data.blockVersion !== undefined ? { block_version: data.blockVersion } : {}),
          ...(data.description !== undefined ? { description: data.description ?? null } : {}),
          ...(data.position !== undefined ? { position: jsonb(data.position) } : {}),
          ...(config !== undefined ? { config: jsonb(config) } : {}),
          updated_at: tx.now,
        })
        .where('version_id', '=', row.draft_version_id)
        .where('id', '=', data.blockId)
        .execute();
      if (replacing) {
        // Paths from outcomes the new block does not have are dropped.
        const t = await typed(tx, await loadGraph(tx, row.draft_version_id));
        const outcomes = new Set(outcomesOf(t, t.graph.blocks.get(data.blockId) as BlockRow).map((o) => o.slug));
        const stale = t.graph.paths.filter(
          (p) => p.source_block_id === data.blockId && !outcomes.has(p.source_outcome),
        );
        if (stale.length > 0) {
          await tx.db
            .deleteFrom('workflow_paths')
            .where('version_id', '=', row.draft_version_id)
            .where(
              'id',
              'in',
              stale.map((p) => p.id),
            )
            .execute();
        }
      }
    }
    await touch(tx, row);
    return {
      block: await blockView(tx, row, data.blockId),
      workflow: await toWorkflow(tx, await loadWorkflow(tx, row.id)),
    };
  },

  async deleteBlock(tx: Tx, input: DeleteBlockInput): Promise<{ workflow: Workflow }> {
    const data = deleteBlockInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    await tx.db
      .deleteFrom('workflow_paths')
      .where('version_id', '=', row.draft_version_id)
      .where((eb) => eb.or([eb('source_block_id', '=', data.blockId), eb('target_block_id', '=', data.blockId)]))
      .execute();
    await tx.db
      .deleteFrom('workflow_blocks')
      .where('version_id', '=', row.draft_version_id)
      .where('id', '=', data.blockId)
      .execute();
    await touch(tx, row);
    return { workflow: await toWorkflow(tx, await loadWorkflow(tx, row.id)) };
  },

  async connect(tx: Tx, input: ConnectBlocksInput): Promise<{ path: WorkflowPath; workflow: Workflow }> {
    const data = connectBlocksInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const t = await typed(tx, await loadGraph(tx, row.draft_version_id));
    const source = t.graph.blocks.get(data.sourceBlockId);
    const target = t.graph.blocks.get(data.targetBlockId);
    if (!source || !target) throw badRequest('VALIDATION_ERROR', 'Both blocks must exist in the draft');
    if (target.block_type === 'trigger')
      throw badRequest('VALIDATION_ERROR', 'A trigger cannot be the target of a path');
    if (source.id === target.id) throw badRequest('VALIDATION_ERROR', 'A block cannot connect to itself');
    if (!outcomesOf(t, source).some((o) => o.slug === data.outcome)) {
      throw badRequest('VALIDATION_ERROR', `Unknown outcome "${data.outcome}"`, { outcome: data.outcome });
    }
    const existing = t.graph.paths.find(
      (p) => p.source_block_id === source.id && p.source_outcome === data.outcome && p.target_block_id === target.id,
    );
    let path = existing;
    if (!path) {
      const id = data.pathId ?? newId();
      await tx.db
        .insertInto('workflow_paths')
        .values({
          version_id: row.draft_version_id,
          id,
          workspace_id: tx.workspaceId,
          workflow_id: row.id,
          source_block_id: source.id,
          source_outcome: data.outcome,
          target_block_id: target.id,
        })
        .execute();
      path = (await loadGraph(tx, row.draft_version_id)).paths.find((p) => p.id === id);
      await touch(tx, row);
    }
    return {
      path: toPath(path as Graph['paths'][number]),
      workflow: await toWorkflow(tx, await loadWorkflow(tx, row.id)),
    };
  },

  async disconnect(tx: Tx, input: DisconnectBlocksInput): Promise<{ workflow: Workflow }> {
    const data = disconnectBlocksInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const deleted = await tx.db
      .deleteFrom('workflow_paths')
      .where('version_id', '=', row.draft_version_id)
      .where('id', '=', data.pathId)
      .executeTakeFirst();
    if (Number(deleted.numDeletedRows) > 0) await touch(tx, row);
    return { workflow: await toWorkflow(tx, await loadWorkflow(tx, row.id)) };
  },

  /** Organize blocks (automatic layout) or multi-drag moves; answers the previous positions for Undo. */
  async organize(
    tx: Tx,
    input: OrganizeBlocksInput,
  ): Promise<{
    positions: { blockId: string; position: Position }[];
    previous: { blockId: string; position: Position }[];
    changed: boolean;
  }> {
    const data = organizeBlocksInputSchema.parse(input);
    const row = await editable(tx, data.workflowId);
    const graph = await loadGraph(tx, row.draft_version_id);
    const target = data.positions
      ? new Map(data.positions.filter((p) => graph.blocks.has(p.blockId)).map((p) => [p.blockId, p.position]))
      : autoLayout(graph);
    const previous: { blockId: string; position: Position }[] = [];
    const positions: { blockId: string; position: Position }[] = [];
    let changed = false;
    for (const [blockId, position] of target) {
      const block = graph.blocks.get(blockId) as BlockRow;
      previous.push({ blockId, position: block.position });
      positions.push({ blockId, position });
      if (block.position.x === position.x && block.position.y === position.y) continue;
      changed = true;
      await tx.db
        .updateTable('workflow_blocks')
        .set({ position: jsonb(position), updated_at: tx.now })
        .where('version_id', '=', row.draft_version_id)
        .where('id', '=', blockId)
        .execute();
    }
    if (changed) await touch(tx, row);
    return { positions, previous, changed };
  },

  /** The variable picker of a block: upstream blocks (nearest first) with typed outputs, plus the attribute lists. */
  async variables(tx: Tx, input: VariablesInput): Promise<VariablePicker> {
    const data = variablesInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId);
    await requireFlag(tx, row, 'read_workflow');
    const v = await versionOf(tx, row, data.versionId);
    const t = await typed(tx, await loadGraph(tx, v.id));
    if (!t.graph.blocks.has(data.blockId))
      throw badRequest('VALIDATION_ERROR', 'Unknown block', { block_id: data.blockId });
    const upstream = upstreamOf(t.graph, data.blockId);
    const blocks: VariablePicker['blocks'] = [];
    const defIds = new Set<string>();
    const collect = (type: WfType) => {
      if (type.kind === 'array') collect(type.of);
      else if (type.kind === 'record' && type.entityDefinitionId) defIds.add(type.entityDefinitionId);
    };
    for (const [blockId, outcomes] of [...upstream.outcomes.entries()].sort(
      (a, b) => (upstream.distance.get(a[0]) ?? 0) - (upstream.distance.get(b[0]) ?? 0),
    )) {
      const block = t.graph.blocks.get(blockId);
      if (!block) continue;
      const resolved = outcomesOf(t, block).filter((o) => outcomes.has(o.slug));
      for (const o of resolved) for (const out of o.outputs ?? []) collect(out.type);
      blocks.push({
        blockId,
        slug: block.slug,
        title: blockDefinition(block.slug)?.title ?? block.slug,
        distance: upstream.distance.get(blockId) ?? 0,
        outcomes: resolved,
      });
    }
    // Referenced definitions, transitively through record references (drilling, B.7).
    const queue = [...defIds];
    while (queue.length > 0) {
      const def = t.env.def(queue.shift() as string);
      for (const attr of def?.attrs ?? []) {
        const type = attributeType(attr);
        const single = type.kind === 'array' ? type.of : type;
        if (single.kind === 'record' && single.entityDefinitionId && !defIds.has(single.entityDefinitionId)) {
          defIds.add(single.entityDefinitionId);
          queue.push(single.entityDefinitionId);
        }
      }
    }
    const definitions: VariablePicker['definitions'] = [];
    for (const id of defIds) {
      const def = t.env.def(id);
      if (!def) continue;
      definitions.push({
        id: def.id,
        kind: isListDef(def) ? 'list' : 'object',
        title: isListDef(def) ? (t.env.listNames.get(def.id) ?? def.pluralNoun) : def.singularNoun,
        attributes: def.attrs
          .filter((a) => !a.isArchived)
          .map((a) => ({
            id: a.id,
            apiSlug: a.apiSlug,
            title: a.title,
            attributeType: a.type,
            isMultiselect: a.isMultiselect,
            type: attributeType(a),
          })),
      });
    }
    return { blocks, definitions };
  },

  /** Issues of the draft (Checklist panel). */
  async validate(
    tx: Tx,
    input: WorkflowIdInput,
  ): Promise<{ issues: Record<string, BlockIssue[]>; messages: string[] }> {
    const data = workflowIdInputSchema.parse(input);
    const row = await loadWorkflow(tx, data.workflowId);
    await requireFlag(tx, row, 'read_workflow');
    const t = await typed(tx, await loadGraph(tx, row.draft_version_id));
    const issues = validateGraph(t);
    return { issues: Object.fromEntries(issues), messages: checklistOf(t.graph, issues).messages };
  },
};

/** For the permissions resource kind (Share popover, admin page). */
export async function loadWorkflowResource(tx: Tx, ref: string): Promise<{ id: string; name: string }> {
  try {
    const row = await loadWorkflow(tx, ref);
    return { id: row.id, name: row.title?.trim() ? row.title : (row.ai_title ?? UNTITLED) };
  } catch (err) {
    if (err instanceof DomainError) {
      throw new DomainError(404, 'NOT_FOUND', 'The requested workflow could not be found', {
        resource_kind: 'workflow',
        resource_id: ref,
      });
    }
    throw err;
  }
}
