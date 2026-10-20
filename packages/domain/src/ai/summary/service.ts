// AI record summary (BACKLOG 10.07; D README §2.5 item 4): one cached summary per record, generated from the
// record's values and recent activity on request ("Generate" / "Regenerate") with the bulk model, charged to the
// member as Ask Agentic spend. `get` never calls the model; it reports `stale` when a value changed afterwards.
import { type RecordSummary, type RecordSummaryInput, recordSummaryInputSchema } from '@agentic-crm/contracts';
import { type Database, sql } from '@agentic-crm/db';
import { noteOps } from '../../collab/notes.ts';
import { taskOps } from '../../collab/tasks.ts';
import type { ServiceContext } from '../../context.ts';
import { notFound } from '../../errors.ts';
import type { Policies } from '../../permissions.ts';
import { loadDefinition } from '../../schema/model.ts';
import { runInWorkspace, type Tx } from '../../tx.ts';
import { creditOps } from '../credits/ledger.ts';
import { type LlmClient, workspaceModelFor } from '../llm.ts';
import { documentText, renderRecords } from '../render.ts';
import { requireMember } from '../settings.ts';

async function target(tx: Tx, policies: Policies, input: RecordSummaryInput) {
  const data = recordSummaryInputSchema.parse(input);
  let def: Awaited<ReturnType<typeof loadDefinition>>;
  try {
    def = await loadDefinition(tx, data.recordRef.entityDefinitionId);
  } catch {
    throw notFound('The requested record could not be found');
  }
  await policies.assertCan(tx, def.id, 'read_entity_instance');
  const live = await tx.db
    .selectFrom('entity_instances')
    .select(['id', 'archived_at', 'merged_at'])
    .where('id', '=', data.recordRef.entityInstanceId)
    .where('entity_definition_id', '=', def.id)
    .executeTakeFirst();
  if (!live || live.archived_at || live.merged_at) {
    throw notFound('The requested record could not be found', { entity_instance_id: data.recordRef.entityInstanceId });
  }
  return { def, id: live.id };
}

async function view(tx: Tx, defId: string, id: string): Promise<RecordSummary> {
  const row = await tx.db
    .selectFrom('record_ai_summaries')
    .selectAll()
    .where('entity_instance_id', '=', id)
    .executeTakeFirst();
  if (!row) return { entityDefinitionId: defId, entityInstanceId: id, summary: null };
  const { rows } = await sql<{ changed: string | null }>`
    SELECT max(greatest(active_from, coalesce(active_until, active_from))) AS changed
    FROM attribute_values WHERE instance_id = ${id}::uuid`.execute(tx.db);
  const changed = rows[0]?.changed ?? null;
  return {
    entityDefinitionId: defId,
    entityInstanceId: id,
    summary: {
      text: row.summary,
      model: row.model,
      generatedAt: row.generated_at,
      creditCost: row.credit_cost,
      stale: changed !== null && changed > row.generated_at,
    },
  };
}

export const recordSummaryOps = {
  async get(tx: Tx, policies: Policies, input: RecordSummaryInput): Promise<RecordSummary> {
    const { def, id } = await target(tx, policies, input);
    return view(tx, def.id, id);
  },

  async regenerate(
    deps: { database: Database; policies: Policies; llm: LlmClient },
    ctx: ServiceContext,
    input: RecordSummaryInput,
  ): Promise<RecordSummary> {
    const run = <T>(fn: (tx: Tx) => Promise<T>) => runInWorkspace(deps.database, ctx, fn);
    const prepared = await run(async (tx) => {
      const memberId = requireMember(tx);
      const { def, id } = await target(tx, deps.policies, input);
      await creditOps.assertAvailable(tx, { memberId, spend: 'ask' });
      const [record] = await renderRecords(tx, def, [id], { withValues: true });
      const notes = await noteOps
        .list(tx, deps, { record: { entityDefinitionId: def.id, entityInstanceId: id }, limit: 5 })
        .catch(() => ({ notes: [] }));
      const tasks = await taskOps
        .list(tx, deps, {
          groupBy: 'none',
          showCompleted: false,
          filter: { records: { operator: 'is', records: [{ entityDefinitionId: def.id, entityInstanceId: id }] } },
          limit: 10,
        })
        .catch(() => ({ groups: [] }));
      const context = {
        record,
        recent_notes: notes.notes.map((n) => ({
          title: n.title,
          created_at: n.createdAt,
          excerpt: documentText(n.content).slice(0, 600),
        })),
        open_tasks: tasks.groups.flatMap((g) => g.tasks).map((t) => ({ body: t.content.text, due: t.deadlineAt })),
      };
      return { memberId, def, id, context, model: await workspaceModelFor(tx, 'record-summary') };
    });
    const res = await deps.llm.complete({
      purpose: 'record-summary',
      model: prepared.model,
      system:
        'You write the summary card of a CRM record: 3–5 short sentences in plain prose on who or what this is, the ' +
        'state of the relationship, and what needs attention next. Use only the data given; no headings or lists.',
      messages: [{ role: 'user', content: JSON.stringify(prepared.context) }],
      maxTokens: 8000,
    });
    return run(async (tx) => {
      const charged = await creditOps.charge(tx, {
        source: 'record-summary',
        memberId: prepared.memberId,
        spend: 'ask',
        usage: res.usage,
        ref: { type: 'record', id: prepared.id },
      });
      const values = {
        entity_definition_id: prepared.def.id,
        summary: res.text.trim(),
        model: res.usage.model || prepared.model,
        credit_cost: charged.credits,
        generated_by_member_id: prepared.memberId,
        generated_at: tx.now,
      };
      await tx.db
        .insertInto('record_ai_summaries')
        .values({ entity_instance_id: prepared.id, workspace_id: tx.workspaceId, ...values })
        .onConflict((oc) => oc.column('entity_instance_id').doUpdateSet(values))
        .execute();
      tx.emit('record-ai-summary', prepared.def.id, {
        entityDefinitionId: prepared.def.id,
        entityInstanceIds: [prepared.id],
      });
      return view(tx, prepared.def.id, prepared.id);
    });
  },
};
