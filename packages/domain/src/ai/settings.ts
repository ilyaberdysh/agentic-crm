// Ask Agentic settings (BACKLOG 10.04; ask-agentic §11.1, §11.3; internals §8.2–8.3): the member's (web search
// permission, share downvoted messages, default model, personal context) and the workspace's (custom context, the
// limit on workspace credits for Ask Agentic, model overrides per tier). Rows are created on first write.
import {
  type AiMemberSettings,
  type AiWorkspaceSettings,
  type UpdateAiMemberSettingsInput,
  type UpdateAiWorkspaceSettingsInput,
  updateAiMemberSettingsInputSchema,
  updateAiWorkspaceSettingsInputSchema,
} from '@agentic-crm/contracts';
import { jsonb } from '@agentic-crm/db';
import { actingMemberId } from '../context.ts';
import { badRequest, forbidden } from '../errors.ts';
import { requireAdminCaller } from '../permissions/admin.ts';
import type { Tx } from '../tx.ts';
import { modelInfo } from './llm.ts';

export function requireMember(tx: Tx): string {
  const id = actingMemberId(tx.ctx);
  if (!id) throw forbidden('Ask Agentic is available to workspace members only');
  return id;
}

/** Audience of a member's personal resources (their auth user). */
export async function userIdsOf(tx: Tx, memberIds: string[]): Promise<string[]> {
  if (memberIds.length === 0) return [];
  const rows = await tx.db.selectFrom('workspace_members').select('user_id').where('id', 'in', memberIds).execute();
  return rows.map((r) => r.user_id);
}

function assertModel(model: string | null | undefined, field: string): void {
  if (model && !modelInfo(model)) {
    throw badRequest('VALIDATION_ERROR', `Unknown model "${model}"`, { field });
  }
}

export async function memberSettingsOf(tx: Tx, memberId: string): Promise<AiMemberSettings> {
  const row = await tx.db
    .selectFrom('member_ai_settings')
    .selectAll()
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  return {
    memberId,
    allowWebSearch: row?.allow_web_search ?? 'always-ask',
    shareThreadFeedback: row?.share_thread_feedback ?? 'always-ask',
    defaultModel: row?.default_model ?? null,
    customContext: row?.custom_context ?? null,
  };
}

export async function workspaceSettingsOf(tx: Tx): Promise<AiWorkspaceSettings> {
  const row = await tx.db
    .selectFrom('workspace_ai_settings')
    .selectAll()
    .where('workspace_id', '=', tx.workspaceId)
    .executeTakeFirst();
  const models = (row?.models ?? {}) as Record<string, string | null | undefined>;
  return {
    customContext: row?.custom_context ?? null,
    askWorkspaceCreditsLimit: row?.ask_workspace_credits_limit ?? null,
    models: { ask: models.ask ?? null, bulk: models.bulk ?? null, fast: models.fast ?? null },
  };
}

/** Writes member settings fields (upsert). */
export async function writeMemberSettings(
  tx: Tx,
  memberId: string,
  patch: {
    allow_web_search?: AiMemberSettings['allowWebSearch'];
    share_thread_feedback?: AiMemberSettings['shareThreadFeedback'];
    default_model?: string | null;
    custom_context?: string | null;
    curated_defaults_saved?: boolean;
  },
): Promise<void> {
  await tx.db
    .insertInto('member_ai_settings')
    .values({ member_id: memberId, workspace_id: tx.workspaceId, ...patch })
    .onConflict((oc) => oc.column('member_id').doUpdateSet({ ...patch, updated_at: tx.now }))
    .execute();
}

export const aiSettingsOps = {
  /** Personal › Ask Agentic. */
  async getMember(tx: Tx): Promise<AiMemberSettings> {
    return memberSettingsOf(tx, requireMember(tx));
  },

  async updateMember(tx: Tx, input: UpdateAiMemberSettingsInput): Promise<AiMemberSettings> {
    const data = updateAiMemberSettingsInputSchema.parse(input);
    const memberId = requireMember(tx);
    assertModel(data.defaultModel, 'defaultModel');
    const patch: Parameters<typeof writeMemberSettings>[2] = {};
    if (data.allowWebSearch !== undefined) patch.allow_web_search = data.allowWebSearch;
    if (data.shareThreadFeedback !== undefined) patch.share_thread_feedback = data.shareThreadFeedback;
    if (data.defaultModel !== undefined) patch.default_model = data.defaultModel;
    if (data.customContext !== undefined) patch.custom_context = data.customContext?.trim() || null;
    if (Object.keys(patch).length === 0) throw badRequest('VALIDATION_ERROR', 'Nothing to update');
    await writeMemberSettings(tx, memberId, patch);
    tx.emit('ai-settings', null, { memberId }, { userIds: await userIdsOf(tx, [memberId]) });
    return memberSettingsOf(tx, memberId);
  },

  /** Workspace › Ask Agentic (everyone reads the context; admins change it). */
  async getWorkspace(tx: Tx): Promise<AiWorkspaceSettings> {
    return workspaceSettingsOf(tx);
  },

  async updateWorkspace(tx: Tx, input: UpdateAiWorkspaceSettingsInput): Promise<AiWorkspaceSettings> {
    const data = updateAiWorkspaceSettingsInputSchema.parse(input);
    await requireAdminCaller(tx, 'Only workspace admins can change Ask Agentic workspace settings');
    const current = await workspaceSettingsOf(tx);
    for (const [tier, model] of Object.entries(data.models ?? {})) assertModel(model, `models.${tier}`);
    const models = { ...current.models, ...(data.models ?? {}) };
    const values = {
      custom_context: data.customContext !== undefined ? data.customContext?.trim() || null : current.customContext,
      ask_workspace_credits_limit:
        data.askWorkspaceCreditsLimit !== undefined ? data.askWorkspaceCreditsLimit : current.askWorkspaceCreditsLimit,
      models: jsonb(models),
    };
    await tx.db
      .insertInto('workspace_ai_settings')
      .values({ workspace_id: tx.workspaceId, ...values })
      .onConflict((oc) => oc.column('workspace_id').doUpdateSet({ ...values, updated_at: tx.now }))
      .execute();
    tx.emit('ai-settings', null, { scope: 'workspace' });
    tx.emit('credit-usage', null, {});
    return workspaceSettingsOf(tx);
  },
};
