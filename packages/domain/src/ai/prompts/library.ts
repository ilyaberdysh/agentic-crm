// The prompts library (BACKLOG 10.03; ask-agentic §2.2–2.3, §11.2; internals §7.5): custom prompts with sharing
// levels, curated prompts saved to "My prompts", AI metadata (title, summary, icon, targets) filled after a save,
// and prompt generation from a description. Prompt chips in the composer resolve through `resolvePrompt`.
import {
  type AiPrompt,
  aiPromptTargets,
  type CreatePromptInput,
  createPromptInputSchema,
  type ListPromptsInput,
  listPromptsInputSchema,
  type PromptAccessLevel,
  type PromptSharing,
  type SharePromptInput,
  sharePromptInputSchema,
  type UpdatePromptInput,
  updatePromptInputSchema,
} from '@agentic-crm/contracts';
import type { AiPromptsTable, Selectable, Updateable } from '@agentic-crm/db';
import { badRequest, forbidden, notFound } from '../../errors.ts';
import { newId } from '../../ids.ts';
import type { Tx } from '../../tx.ts';
import { modelInfo } from '../llm.ts';
import { requireMember, userIdsOf, writeMemberSettings } from '../settings.ts';
import { CURATED_PROMPTS, type CuratedPrompt, curatedPrompt, DEFAULT_SAVED_CURATED } from './curated.ts';

type PromptRow = Selectable<AiPromptsTable>;

const RANK: Record<PromptAccessLevel, number> = { 'no-access': 0, 'read-only': 1, 'read-write': 2, 'full-access': 3 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const promptNotFound = (id: string) => notFound('Prompt not found', { prompt_id: id });

async function emitPrompts(tx: Tx, promptId: string | null, memberIds: string[] | null): Promise<void> {
  const audience = memberIds ? { userIds: await userIdsOf(tx, memberIds) } : null;
  if (promptId) tx.emit('ai-prompt', promptId, { promptId }, audience);
  tx.emit('ai-prompt-list', null, {}, audience);
}

async function accessOf(tx: Tx, row: PromptRow, memberId: string): Promise<PromptAccessLevel> {
  if (row.created_by_member_id === memberId) return 'full-access';
  const entry = await tx.db
    .selectFrom('ai_prompt_member_access')
    .select('access')
    .where('prompt_id', '=', row.id)
    .where('member_id', '=', memberId)
    .executeTakeFirst();
  return entry?.access ?? row.workspace_access;
}

function customView(row: PromptRow, access: PromptAccessLevel): AiPrompt {
  return {
    id: row.id,
    kind: 'custom',
    title: row.title,
    aiTitle: row.ai_title,
    summary: row.ai_summary,
    prompt: row.prompt,
    iconId: row.icon_id ?? row.ai_icon_id,
    iconColor: row.icon_color ?? row.ai_icon_color,
    targets: row.ai_targets.filter((t): t is (typeof aiPromptTargets)[number] =>
      (aiPromptTargets as readonly string[]).includes(t),
    ),
    categories: [],
    defaultModel: row.default_model,
    saved: true,
    savedCount: 0,
    createdByMemberId: row.created_by_member_id,
    access,
    createdAt: row.created_at,
  };
}

function curatedView(p: CuratedPrompt, saved: boolean, savedCount: number): AiPrompt {
  return {
    id: p.id,
    kind: 'curated',
    title: p.title,
    aiTitle: null,
    summary: p.summary,
    prompt: p.prompt,
    iconId: p.iconId,
    iconColor: p.iconColor,
    targets: p.targets.filter((t): t is (typeof aiPromptTargets)[number] =>
      (aiPromptTargets as readonly string[]).includes(t),
    ),
    categories: p.categories,
    defaultModel: null,
    saved,
    savedCount,
    createdByMemberId: null,
    access: 'read-only',
    createdAt: null,
  };
}

async function loadCustom(tx: Tx, promptId: string, options: { forUpdate?: boolean } = {}): Promise<PromptRow> {
  if (!UUID.test(promptId)) throw promptNotFound(promptId);
  let q = tx.db.selectFrom('ai_prompts').selectAll().where('id', '=', promptId).where('deleted_at', 'is', null);
  if (options.forUpdate) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw promptNotFound(promptId);
  return row;
}

async function requireAccess(tx: Tx, row: PromptRow, needed: PromptAccessLevel, memberId: string) {
  const access = await accessOf(tx, row, memberId);
  if (RANK[access] === 0) throw promptNotFound(row.id);
  if (RANK[access] < RANK[needed]) throw forbidden('You do not have permission to change this prompt');
  return access;
}

function assertModel(model: string | null | undefined): void {
  if (model && !modelInfo(model)) throw badRequest('VALIDATION_ERROR', `Unknown model "${model}"`);
}

async function savedCounts(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.db
    .selectFrom('ai_curated_prompt_saves')
    .select(['curated_id', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('curated_id')
    .execute();
  return new Map(rows.map((r) => [r.curated_id, Number(r.n)]));
}

export const promptOps = {
  /** Saves the default curated prompts the first time a member uses the library (ask-agentic §2.2). */
  async ensureDefaults(tx: Tx, memberId: string): Promise<void> {
    const settings = await tx.db
      .selectFrom('member_ai_settings')
      .select('curated_defaults_saved')
      .where('member_id', '=', memberId)
      .executeTakeFirst();
    if (settings?.curated_defaults_saved) return;
    await tx.db
      .insertInto('ai_curated_prompt_saves')
      .values(
        DEFAULT_SAVED_CURATED.map((id) => ({ member_id: memberId, curated_id: id, workspace_id: tx.workspaceId })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
    await writeMemberSettings(tx, memberId, { curated_defaults_saved: true });
  },

  async list(tx: Tx, input?: ListPromptsInput): Promise<{ prompts: AiPrompt[] }> {
    const data = listPromptsInputSchema.parse(input) ?? {};
    const scope = data.scope ?? 'mine';
    const memberId = requireMember(tx);
    await promptOps.ensureDefaults(tx, memberId);
    const query = data.query?.trim().toLowerCase();
    const matches = (p: AiPrompt) =>
      (!query || `${p.title ?? ''} ${p.aiTitle ?? ''} ${p.summary ?? ''}`.toLowerCase().includes(query)) &&
      (!data.category || p.categories.includes(data.category));
    const out: AiPrompt[] = [];
    if (scope !== 'curated') {
      const rows = await tx.db
        .selectFrom('ai_prompts')
        .selectAll()
        .where('deleted_at', 'is', null)
        .where('is_transient', '=', false)
        .orderBy('created_at', 'desc')
        .orderBy('id')
        .execute();
      for (const row of rows) {
        const own = row.created_by_member_id === memberId;
        if (scope === 'mine' && !own) continue;
        if (scope === 'shared' && own) continue;
        const access = await accessOf(tx, row, memberId);
        if (RANK[access] === 0) continue;
        out.push(customView(row, access));
      }
    }
    if (scope !== 'shared') {
      const saves = await tx.db
        .selectFrom('ai_curated_prompt_saves')
        .select(['curated_id', 'created_at'])
        .where('member_id', '=', memberId)
        .orderBy('created_at')
        .execute();
      const saved = new Set(saves.map((s) => s.curated_id));
      const counts = await savedCounts(tx);
      const curated =
        scope === 'mine'
          ? saves.map((s) => curatedPrompt(s.curated_id)).filter((p): p is CuratedPrompt => p !== undefined)
          : [...CURATED_PROMPTS].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
      for (const p of curated) out.push(curatedView(p, saved.has(p.id), counts.get(p.id) ?? 0));
    }
    return { prompts: out.filter(matches) };
  },

  async get(tx: Tx, promptId: string): Promise<AiPrompt> {
    const memberId = requireMember(tx);
    const curated = curatedPrompt(promptId);
    if (curated) {
      const saved = await tx.db
        .selectFrom('ai_curated_prompt_saves')
        .select('curated_id')
        .where('member_id', '=', memberId)
        .where('curated_id', '=', promptId)
        .executeTakeFirst();
      return curatedView(curated, saved !== undefined, (await savedCounts(tx)).get(promptId) ?? 0);
    }
    const row = await loadCustom(tx, promptId);
    const access = await accessOf(tx, row, memberId);
    if (RANK[access] === 0) throw promptNotFound(promptId);
    return customView(row, access);
  },

  /** manual / customize (generate goes through the service: it calls the model first, then `insertGenerated`). */
  async create(tx: Tx, input: CreatePromptInput): Promise<AiPrompt> {
    const data = createPromptInputSchema.parse(input);
    const memberId = requireMember(tx);
    const id = data.id ?? newId();
    const existing = await tx.db.selectFrom('ai_prompts').selectAll().where('id', '=', id).executeTakeFirst();
    if (existing) {
      if (existing.created_by_member_id !== memberId) throw promptNotFound(id);
      return customView(existing, 'full-access');
    }
    let values: { title: string | null; prompt: string; icon_id?: string | null; icon_color?: string | null };
    let defaultModel: string | null = null;
    if (data.mode === 'manual') {
      assertModel(data.defaultModel);
      values = {
        title: data.title?.trim() || null,
        prompt: data.prompt,
        icon_id: data.iconId ?? null,
        icon_color: data.iconColor ?? null,
      };
      defaultModel = data.defaultModel ?? null;
    } else if (data.mode === 'customize') {
      const curated = curatedPrompt(data.curatedPromptId);
      if (!curated) throw promptNotFound(data.curatedPromptId);
      values = { title: curated.title, prompt: curated.prompt, icon_id: curated.iconId, icon_color: curated.iconColor };
    } else {
      throw badRequest('VALIDATION_ERROR', 'Generated prompts are created by prompts.create in the service');
    }
    const row = await tx.db
      .insertInto('ai_prompts')
      .values({
        id,
        workspace_id: tx.workspaceId,
        ...values,
        default_model: defaultModel,
        created_by_member_id: memberId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitPrompts(tx, id, null);
    return customView(row, 'full-access');
  },

  /** A transient draft written by "Generate" (opened in the editor; saving clears is_transient). */
  async insertGenerated(tx: Tx, id: string, generated: { title: string; prompt: string }): Promise<AiPrompt> {
    const memberId = requireMember(tx);
    const row = await tx.db
      .insertInto('ai_prompts')
      .values({
        id,
        workspace_id: tx.workspaceId,
        title: generated.title.slice(0, 200) || null,
        prompt: generated.prompt.slice(0, 20_000) || 'Untitled prompt',
        is_transient: true,
        created_by_member_id: memberId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitPrompts(tx, id, [memberId]);
    return customView(row, 'full-access');
  },

  async update(tx: Tx, input: UpdatePromptInput): Promise<AiPrompt> {
    const data = updatePromptInputSchema.parse(input);
    const memberId = requireMember(tx);
    const row = await loadCustom(tx, data.promptId, { forUpdate: true });
    const access = await requireAccess(tx, row, 'read-write', memberId);
    assertModel(data.defaultModel);
    const patch: Updateable<AiPromptsTable> = { is_transient: false, updated_at: tx.now };
    if (data.title !== undefined) patch.title = data.title?.trim() || null;
    if (data.prompt !== undefined) patch.prompt = data.prompt;
    if (data.iconId !== undefined) patch.icon_id = data.iconId;
    if (data.iconColor !== undefined) patch.icon_color = data.iconColor;
    if (data.defaultModel !== undefined) patch.default_model = data.defaultModel;
    const updated = await tx.db
      .updateTable('ai_prompts')
      .set(patch)
      .where('id', '=', row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await emitPrompts(tx, row.id, null);
    return customView(updated, access);
  },

  async delete(tx: Tx, promptId: string): Promise<{ id: string }> {
    const memberId = requireMember(tx);
    if (curatedPrompt(promptId)) {
      await promptOps.unsave(tx, promptId);
      return { id: promptId };
    }
    const row = await loadCustom(tx, promptId, { forUpdate: true });
    await requireAccess(tx, row, 'full-access', memberId);
    await tx.db.updateTable('ai_prompts').set({ deleted_at: tx.now }).where('id', '=', row.id).execute();
    await emitPrompts(tx, row.id, null);
    return { id: row.id };
  },

  async sharing(tx: Tx, promptId: string): Promise<PromptSharing> {
    const memberId = requireMember(tx);
    const row = await loadCustom(tx, promptId);
    await requireAccess(tx, row, 'read-only', memberId);
    const entries = await tx.db
      .selectFrom('ai_prompt_member_access')
      .select(['member_id', 'access'])
      .where('prompt_id', '=', row.id)
      .orderBy('member_id')
      .execute();
    return {
      promptId: row.id,
      workspaceAccess: row.workspace_access,
      members: [
        { memberId: row.created_by_member_id, access: 'full-access' as const },
        ...entries
          .filter((e) => e.member_id !== row.created_by_member_id)
          .map((e) => ({ memberId: e.member_id, access: e.access })),
      ],
    };
  },

  /** Share popover: workspace level and per-member levels ("No access" removes the member's entry). */
  async share(tx: Tx, input: SharePromptInput): Promise<PromptSharing> {
    const data = sharePromptInputSchema.parse(input);
    const memberId = requireMember(tx);
    const row = await loadCustom(tx, data.promptId, { forUpdate: true });
    await requireAccess(tx, row, 'full-access', memberId);
    if (data.workspaceAccess) {
      await tx.db
        .updateTable('ai_prompts')
        .set({ workspace_access: data.workspaceAccess, updated_at: tx.now })
        .where('id', '=', row.id)
        .execute();
    }
    for (const m of data.members ?? []) {
      if (m.memberId === row.created_by_member_id) continue;
      if (m.access === 'no-access') {
        await tx.db
          .deleteFrom('ai_prompt_member_access')
          .where('prompt_id', '=', row.id)
          .where('member_id', '=', m.memberId)
          .execute();
        continue;
      }
      const member = await tx.db
        .selectFrom('workspace_members')
        .select('id')
        .where('id', '=', m.memberId)
        .executeTakeFirst();
      if (!member) throw badRequest('VALIDATION_ERROR', 'Unknown workspace member', { member_id: m.memberId });
      await tx.db
        .insertInto('ai_prompt_member_access')
        .values({ prompt_id: row.id, member_id: m.memberId, workspace_id: tx.workspaceId, access: m.access })
        .onConflict((oc) => oc.columns(['prompt_id', 'member_id']).doUpdateSet({ access: m.access }))
        .execute();
    }
    await emitPrompts(tx, row.id, null);
    return promptOps.sharing(tx, row.id);
  },

  /** "Add to my prompts" for a curated prompt. */
  async save(tx: Tx, curatedId: string): Promise<AiPrompt> {
    const memberId = requireMember(tx);
    const curated = curatedPrompt(curatedId);
    if (!curated) throw promptNotFound(curatedId);
    await tx.db
      .insertInto('ai_curated_prompt_saves')
      .values({ member_id: memberId, curated_id: curatedId, workspace_id: tx.workspaceId })
      .onConflict((oc) => oc.doNothing())
      .execute();
    await emitPrompts(tx, null, [memberId]);
    return promptOps.get(tx, curatedId);
  },

  async unsave(tx: Tx, curatedId: string): Promise<{ id: string }> {
    const memberId = requireMember(tx);
    await promptOps.ensureDefaults(tx, memberId);
    await tx.db
      .deleteFrom('ai_curated_prompt_saves')
      .where('member_id', '=', memberId)
      .where('curated_id', '=', curatedId)
      .execute();
    await emitPrompts(tx, null, [memberId]);
    return { id: curatedId };
  },

  /** AI metadata of a custom prompt (title, summary, icon, targets), written after the save. */
  async writeMetadata(
    tx: Tx,
    promptId: string,
    meta: { title: string; summary: string; icon: string; color: string; targets: string[] },
  ): Promise<void> {
    await tx.db
      .updateTable('ai_prompts')
      .set({
        ai_title: meta.title.slice(0, 200),
        ai_summary: meta.summary.slice(0, 1000),
        ai_icon_id: meta.icon.slice(0, 64),
        ai_icon_color: meta.color.slice(0, 32),
        ai_targets: meta.targets.filter((t) => (aiPromptTargets as readonly string[]).includes(t)),
      })
      .where('id', '=', promptId)
      .execute();
    await emitPrompts(tx, promptId, null);
  },
};

/** A prompt chip of the composer → its title, body and preferred model (null when missing or not readable). */
export async function resolvePrompt(
  tx: Tx,
  memberId: string,
  promptId: string,
): Promise<{ title: string; prompt: string; defaultModel: string | null } | null> {
  const curated = curatedPrompt(promptId);
  if (curated) return { title: curated.title, prompt: curated.prompt, defaultModel: null };
  if (!UUID.test(promptId)) return null;
  const row = await tx.db
    .selectFrom('ai_prompts')
    .selectAll()
    .where('id', '=', promptId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!row || RANK[await accessOf(tx, row, memberId)] === 0) return null;
  return { title: row.title ?? row.ai_title ?? 'Untitled prompt', prompt: row.prompt, defaultModel: row.default_model };
}
