// Activation (internal-api §3 activate / deactivate): the active version's triggers become rows of
// workflow_triggers (matched by the trigger fan-out; listed by the record / list-entry / note "Run workflow" entry
// points) and its recurring schedules rows of workflow_schedules (started by the worker's minute tick). Deactivation
// removes them; runs in progress continue on their version.
import { newId } from '../ids.ts';
import type { Tx } from '../tx.ts';
import { nextCronRun, scheduleOf } from './cron.ts';
import { type BlockRow, definitionRef, entryOf, loadGraph } from './graph.ts';
import type { WorkflowRow } from './model.ts';

function attributeIdOf(block: BlockRow): string | null {
  const expr = entryOf(block.config, 'attribute');
  if (!expr) return null;
  if (expr.type === 'agentic-crm-attribute') return expr.attributeDefinitionId;
  if (expr.type === 'string' && expr.value) return expr.value;
  return null;
}

async function removeTriggers(tx: Tx, workflowId: string): Promise<void> {
  await tx.db.deleteFrom('workflow_triggers').where('workflow_id', '=', workflowId).execute();
  await tx.db.deleteFrom('workflow_schedules').where('workflow_id', '=', workflowId).execute();
}

/** Makes `versionId` the live version of the workflow (deactivating the previous one). */
export async function activateVersion(
  tx: Tx,
  row: WorkflowRow,
  versionId: string,
  options: { published?: boolean; now: string },
): Promise<void> {
  if (row.active_version_id && row.active_version_id !== versionId) {
    await tx.db
      .updateTable('workflow_versions')
      .set({ activation_status: 'deactivated', deactivated_at: tx.now })
      .where('id', '=', row.active_version_id)
      .execute();
  }
  await removeTriggers(tx, row.id);
  const graph = await loadGraph(tx, versionId);
  for (const block of graph.blocks.values()) {
    if (block.block_type !== 'trigger') continue;
    let entityDefinitionId = definitionRef(entryOf(block.config, 'object') ?? entryOf(block.config, 'list'));
    if (entityDefinitionId && !/^[0-9a-f-]{36}$/i.test(entityDefinitionId)) {
      // Slugs in configs resolve to ids (the fan-out matches ids).
      const def = await tx.db
        .selectFrom('entity_definitions')
        .select('id')
        .where('api_slug', '=', entityDefinitionId)
        .executeTakeFirst();
      entityDefinitionId = def?.id ?? null;
    }
    await tx.db
      .insertInto('workflow_triggers')
      .values({
        id: newId(),
        workspace_id: tx.workspaceId,
        workflow_id: row.id,
        version_id: versionId,
        block_id: block.id,
        slug: block.slug,
        entity_definition_id: entityDefinitionId,
        attribute_id: attributeIdOf(block),
      })
      .execute();
    if (block.slug === 'on-recurring-schedule') {
      const schedule = scheduleOf(block.config);
      if ('error' in schedule) continue;
      const next = nextCronRun(schedule.cron, schedule.timeZone, options.now);
      if (!next) continue;
      await tx.db
        .insertInto('workflow_schedules')
        .values({
          id: newId(),
          workspace_id: tx.workspaceId,
          workflow_id: row.id,
          version_id: versionId,
          block_id: block.id,
          cron: schedule.cron,
          timezone: schedule.timeZone,
          next_run_at: next,
        })
        .execute();
    }
  }
  await tx.db
    .updateTable('workflow_versions')
    .set({ activation_status: 'completed', activated_at: tx.now, deactivated_at: null })
    .where('id', '=', versionId)
    .execute();
  await tx.db
    .updateTable('workflows')
    .set({
      status: 'live',
      active_version_id: versionId,
      first_set_live_at: row.first_set_live_at ?? tx.now,
      ...(options.published ? { last_published_at: tx.now } : {}),
      last_status_change_at: row.status === 'live' ? row.last_status_change_at : tx.now,
      is_transient: false,
      updated_at: tx.now,
    })
    .where('id', '=', row.id)
    .execute();
}

/** Pauses the workflow: no new runs; runs in progress continue. */
export async function deactivate(tx: Tx, row: WorkflowRow): Promise<void> {
  await removeTriggers(tx, row.id);
  if (row.active_version_id) {
    await tx.db
      .updateTable('workflow_versions')
      .set({ activation_status: 'deactivated', deactivated_at: tx.now })
      .where('id', '=', row.active_version_id)
      .execute();
  }
  await tx.db
    .updateTable('workflows')
    .set({
      status: row.status === 'draft' ? 'draft' : 'paused',
      active_version_id: null,
      last_status_change_at: tx.now,
      updated_at: tx.now,
    })
    .where('id', '=', row.id)
    .execute();
}
