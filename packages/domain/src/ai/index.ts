// Slice-10 AI services (S10-ASK) wired for createDomain(): Ask Agentic threads and turns (with the in-process turn
// runner and stream hub), models, settings, the prompts library, credits usage and ledger, AI record summaries.
// Every method is one workspace transaction (I1) except those that call the model: they keep LLM calls outside
// transactions and start turn runs only after the transaction that created them committed.
import {
  AI_TOOL_LABELS,
  type AiModelsOutput,
  type AiReplySuggestions,
  type AiTurn,
  type AiTurnFeedbackInput,
  type AllowWebSearchInput,
  type ApproveAiToolInput,
  aiPromptTargets,
  aiTargetModelChoice,
  type CreateAiThreadInput,
  type CreatePromptInput,
  type CreditsLedgerInput,
  type CreditsUsageInput,
  createPromptInputSchema,
  type DenyAiToolInput,
  type ListAiThreadsInput,
  type ListPromptsInput,
  parseAiTargetModelChoice,
  type RecordSummaryInput,
  type RenameAiThreadInput,
  type RetryAiTurnInput,
  type SendAiTurnInput,
  type SharePromptInput,
  type UpdateAiMemberSettingsInput,
  type UpdateAiWorkspaceSettingsInput,
  type UpdatePromptInput,
} from '@agentic-crm/contracts';
import type { Database } from '@agentic-crm/db';
import { actingMemberId, type ServiceContext } from '../context.ts';
import { DomainError, forbidden } from '../errors.ts';
import { newId } from '../ids.ts';
import type { ModelGateway } from '../model-gateway/gateway.ts';
import type { Policies } from '../permissions.ts';
import { runInWorkspace, type Tx } from '../tx.ts';
import { AiTurnHub } from './chat/hub.ts';
import { loadTurn, loadTurnView } from './chat/model.ts';
import { type RunnerDeps, startTurn } from './chat/runner.ts';
import { type ChatEffects, chatOps } from './chat/service.ts';
import { creditOps } from './credits/ledger.ts';
import { AI_MODELS, type LlmClient, workspaceModelFor } from './llm.ts';
import { promptOps } from './prompts/library.ts';
import { aiSettingsOps, requireMember } from './settings.ts';
import { recordSummaryOps } from './summary/service.ts';

export { type AiStreamEnvelope, AiTurnHub } from './chat/hub.ts';
export {
  type CreditBalance,
  type CreditChargeInput,
  type CreditSpend,
  creditOps,
  creditsExhausted,
} from './credits/ledger.ts';
export { AI_TOOLS } from './tools/catalog.ts';
export { AI_WORKFLOW_HANDLERS } from './workflows/blocks.ts';

export interface AiWiring {
  database: Database;
  policies: Policies;
  llm: LlmClient;
  modelGateway: ModelGateway;
  /** Stream fan-out (apps/api forwards it to SSE and the thread rooms); defaults to a private hub. */
  hub?: AiTurnHub;
}

const PROMPT_ICONS = [
  'search',
  'student-hat',
  'dollar-circle',
  'suitcase',
  'checkbox',
  'mic',
  'bubble',
  'handshake',
  'lightning',
  'rocket',
  'calendar',
  'chart-arrow-up',
  'sun',
  'email',
  'pie-chart',
  'note',
] as const;
const PROMPT_COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'] as const;

export function createAiServices(wiring: AiWiring) {
  const { database, policies, llm, modelGateway } = wiring;
  const hub = wiring.hub ?? new AiTurnHub();
  const running: RunnerDeps['running'] = new Map();
  const runnerDeps: RunnerDeps = { database, policies, llm, modelGateway, hub, running };
  const run = <T>(ctx: ServiceContext, fn: (tx: Tx) => Promise<T>) => runInWorkspace(database, ctx, fn);
  /**
   * The same caller without the transport's receipt: follow-up reads and best-effort writes after the main write
   * must not overwrite the receipt's seq (runInWorkspace resets it per transaction).
   */
  const quiet = (ctx: ServiceContext): ServiceContext => {
    const { receipt: _receipt, ...rest } = ctx;
    return rest;
  };

  const memberOf = (ctx: ServiceContext) => {
    const id = actingMemberId(ctx);
    if (!id) throw forbidden('Ask Agentic is available to workspace members only');
    return id;
  };

  /** After commit: abort canceled runs (publishing their final state) and start / resume turns. */
  async function apply(ctx: ServiceContext, effects: ChatEffects): Promise<void> {
    for (const turnId of effects.canceled) {
      running.get(turnId)?.abort.abort();
      const turn = await run(quiet(ctx), (tx) => loadTurnView(tx, turnId));
      hub.publish({
        workspaceId: ctx.workspaceId,
        threadId: turn.threadId,
        turnId,
        event: { type: 'turn', seq: hub.nextSeq(), turn },
      });
      hub.publish({
        workspaceId: ctx.workspaceId,
        threadId: turn.threadId,
        turnId,
        event: { type: 'done', seq: hub.nextSeq(), turnId, status: 'canceled' },
      });
    }
    for (const turnId of effects.start) void startTurn(runnerDeps, ctx.workspaceId, memberOf(ctx), turnId);
  }

  /** AI metadata of a custom prompt (title, summary, icon, targets); best effort, charged as Ask spend. */
  async function fillPromptMetadata(caller: ServiceContext, promptId: string): Promise<void> {
    if (!llm.configured) return;
    const ctx = quiet(caller);
    const memberId = memberOf(ctx);
    try {
      const prompt = await run(ctx, async (tx) => {
        await creditOps.assertAvailable(tx, { memberId, spend: 'ask' });
        return promptOps.get(tx, promptId);
      });
      const res = await llm.complete({
        purpose: 'prompt-metadata',
        model: await run(ctx, (tx) => workspaceModelFor(tx, 'prompt-metadata')),
        system:
          'You label saved prompts of a CRM assistant. Give a title (max 6 words), a one-sentence summary, an icon, ' +
          'a colour and the pages the prompt applies to.',
        messages: [{ role: 'user', content: prompt.prompt.slice(0, 8000) }],
        outputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string' },
            icon: { type: 'string', enum: [...PROMPT_ICONS] },
            color: { type: 'string', enum: [...PROMPT_COLORS] },
            targets: { type: 'array', items: { type: 'string', enum: [...aiPromptTargets] } },
          },
          required: ['title', 'summary', 'icon', 'color', 'targets'],
          additionalProperties: false,
        },
        maxTokens: 4000,
      });
      const meta = res.json as {
        title: string;
        summary: string;
        icon: string;
        color: string;
        targets: string[];
      } | null;
      await run(ctx, async (tx) => {
        await creditOps.charge(tx, {
          source: 'prompt-metadata',
          memberId,
          spend: 'ask',
          usage: res.usage,
          ref: { type: 'ai-prompt', id: promptId },
        });
        if (meta) await promptOps.writeMetadata(tx, promptId, meta);
      });
    } catch (err) {
      if (err instanceof DomainError) return; // out of credits / provider down: the prompt keeps its own fields
      throw err;
    }
  }

  return {
    ai: {
      /** The stream hub (apps/api: SSE route and thread rooms). */
      hub,
      threads: {
        list: (ctx: ServiceContext, input?: ListAiThreadsInput) => run(ctx, (tx) => chatOps.listThreads(tx, input)),
        get: (ctx: ServiceContext, threadId: string) =>
          run(ctx, (tx) => chatOps.getThread(tx, threadId, (id) => running.has(id))),
        create: (ctx: ServiceContext, input: CreateAiThreadInput = {}) =>
          run(ctx, (tx) => chatOps.createThread(tx, input)),
        rename: (ctx: ServiceContext, input: RenameAiThreadInput) => run(ctx, (tx) => chatOps.renameThread(tx, input)),
        delete: async (ctx: ServiceContext, threadId: string) => {
          const result = await run(ctx, (tx) => chatOps.deleteThread(tx, threadId, modelGateway));
          for (const id of result.canceled) running.get(id)?.abort.abort();
          return { id: result.id };
        },
      },
      turns: {
        /** Creates the user turn and the executing assistant turn; the answer streams (SSE / room / hub). */
        send: async (ctx: ServiceContext, input: SendAiTurnInput) => {
          const result = await run(ctx, (tx) => chatOps.send(tx, policies, input, modelGateway));
          await apply(ctx, result);
          return { threadId: result.threadId, userTurnId: result.userTurnId, turnId: result.turnId };
        },
        get: (ctx: ServiceContext, turnId: string) =>
          run(ctx, async (tx) => {
            await loadTurn(tx, turnId, requireMember(tx));
            return loadTurnView(tx, turnId);
          }),
        approve: async (ctx: ServiceContext, input: ApproveAiToolInput): Promise<AiTurn> => {
          const result = await run(ctx, (tx) => chatOps.approve(tx, input));
          await apply(ctx, result);
          return result.turn;
        },
        deny: async (ctx: ServiceContext, input: DenyAiToolInput): Promise<AiTurn> => {
          const result = await run(ctx, (tx) => chatOps.deny(tx, input));
          await apply(ctx, result);
          return result.turn;
        },
        retry: async (ctx: ServiceContext, input: RetryAiTurnInput) => {
          const result = await run(ctx, (tx) => chatOps.retry(tx, input, modelGateway));
          await apply(ctx, result);
          return { turnId: result.turnId };
        },
        cancel: async (ctx: ServiceContext, turnId: string): Promise<AiTurn> => {
          const result = await run(ctx, (tx) => chatOps.cancel(tx, turnId, modelGateway));
          await apply(ctx, result);
          return run(quiet(ctx), (tx) => loadTurnView(tx, turnId));
        },
        feedback: (ctx: ServiceContext, input: AiTurnFeedbackInput) => run(ctx, (tx) => chatOps.feedback(tx, input)),
        /** Up to 3 reply suggestions under a completed answer (generated once, cached on the turn). */
        suggestions: async (ctx: ServiceContext, turnId: string): Promise<AiReplySuggestions> => {
          const memberId = memberOf(ctx);
          const state = await run(ctx, async (tx) => {
            const { turn } = await loadTurn(tx, turnId, memberId);
            return turn;
          });
          if (state.reply_suggestions) return { turnId, suggestions: state.reply_suggestions as string[] };
          if (
            state.role !== 'assistant' ||
            state.status !== 'completed' ||
            !llm.configured ||
            parseAiTargetModelChoice(state.model)
          ) {
            return { turnId, suggestions: [] };
          }
          const view = await run(ctx, (tx) => loadTurnView(tx, turnId));
          const answer = view.steps
            .flatMap((s) => s.parts)
            .flatMap((p) => (p.type === 'text' ? [p.content] : []))
            .join('\n');
          const res = await llm.complete({
            purpose: 'ask-suggestions',
            model: await run(ctx, (tx) => workspaceModelFor(tx, 'ask-suggestions')),
            system:
              'Suggest up to 3 short follow-up requests (max 10 words each) the user could send next to a CRM ' +
              'assistant, written as the user, in the language of the answer.',
            messages: [{ role: 'user', content: answer.slice(0, 6000) || 'No answer' }],
            outputSchema: {
              type: 'object',
              properties: { suggestions: { type: 'array', items: { type: 'string' } } },
              required: ['suggestions'],
              additionalProperties: false,
            },
            maxTokens: 4000,
          });
          const suggestions = ((res.json as { suggestions?: unknown[] } | null)?.suggestions ?? [])
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .slice(0, 3);
          await run(ctx, async (tx) => {
            await creditOps.charge(tx, {
              source: 'ask-suggestions',
              memberId,
              spend: 'ask',
              usage: res.usage,
              ref: { type: 'ai-turn', id: turnId },
            });
            await tx.db
              .updateTable('ai_turns')
              .set({ reply_suggestions: JSON.stringify(suggestions) })
              .where('id', '=', turnId)
              .execute();
            tx.emit('ai-turn', turnId, { turnId, suggestions: true }, null);
          });
          return { turnId, suggestions };
        },
        /** Resolves when the turn's in-process run stops (finished or paused for approval). Tests, SSE. */
        settled: (turnId: string): Promise<void> => running.get(turnId)?.done ?? Promise.resolve(),
        isRunning: (turnId: string) => running.has(turnId),
      },
      webSearch: {
        allow: async (ctx: ServiceContext, input: AllowWebSearchInput) => {
          const result = await run(ctx, (tx) => chatOps.allowWebSearch(tx, input));
          await apply(ctx, result);
          return result.thread;
        },
      },
      models: {
        list: async (ctx: ServiceContext): Promise<AiModelsOutput> => {
          const targets = await modelGateway.targets.list(ctx);
          const legacy = await run(ctx, async (tx) => {
            const auto = await workspaceModelFor(tx, 'ask');
            return {
              configured: llm.configured,
              models: AI_MODELS.map((m) => ({
                id: m.id,
                label: m.label,
                brand: m.brand,
                isAuto: m.id === auto,
                isUnavailable: !llm.configured,
              })),
            };
          });
          const saved = targets.map((target) => ({
            id: aiTargetModelChoice(target.id, target.version),
            label: `${target.name} · ${target.kind === 'runner-local' ? 'Local' : 'API'}`,
            brand: target.provider,
            isAuto: false,
            isUnavailable: !target.enabled,
          }));
          return {
            configured: legacy.configured || saved.some((m) => !m.isUnavailable),
            models: [...legacy.models, ...saved],
          };
        },
      },
      toolLabels: () => AI_TOOL_LABELS,
      settings: {
        get: (ctx: ServiceContext) => run(ctx, (tx) => aiSettingsOps.getMember(tx)),
        update: (ctx: ServiceContext, input: UpdateAiMemberSettingsInput) =>
          run(ctx, (tx) => aiSettingsOps.updateMember(tx, input)),
      },
      workspaceSettings: {
        get: (ctx: ServiceContext) => run(ctx, (tx) => aiSettingsOps.getWorkspace(tx)),
        update: (ctx: ServiceContext, input: UpdateAiWorkspaceSettingsInput) =>
          run(ctx, (tx) => aiSettingsOps.updateWorkspace(tx, input)),
      },
    },
    prompts: {
      list: (ctx: ServiceContext, input?: ListPromptsInput) => run(ctx, (tx) => promptOps.list(tx, input)),
      get: (ctx: ServiceContext, promptId: string) => run(ctx, (tx) => promptOps.get(tx, promptId)),
      /** manual ("Advanced"), customize (a curated prompt), or generate (from a description: a transient draft). */
      create: async (ctx: ServiceContext, input: CreatePromptInput) => {
        const data = createPromptInputSchema.parse(input);
        if (data.mode !== 'generate') {
          const created = await run(ctx, (tx) => promptOps.create(tx, data));
          await fillPromptMetadata(ctx, created.id);
          return run(quiet(ctx), (tx) => promptOps.get(tx, created.id));
        }
        const memberId = memberOf(ctx);
        await run(ctx, (tx) => creditOps.assertAvailable(tx, { memberId, spend: 'ask' }));
        const res = await llm.complete({
          purpose: 'prompt-generate',
          model: await run(ctx, (tx) => workspaceModelFor(tx, 'prompt-generate')),
          system:
            'You write reusable prompts for a CRM assistant (Ask Agentic). Given what the user wants, write a title ' +
            '(max 6 words) and a prompt in Markdown with three bold sections: **Context**, **Task**, ' +
            '**Constraints** (a bullet list). Refer to "the record in context" rather than specific names.',
          messages: [{ role: 'user', content: data.description }],
          outputSchema: {
            type: 'object',
            properties: { title: { type: 'string' }, prompt: { type: 'string' } },
            required: ['title', 'prompt'],
            additionalProperties: false,
          },
          maxTokens: 8000,
        });
        const generated = (res.json as { title?: string; prompt?: string } | null) ?? {};
        const id = data.id ?? newId();
        const created = await run(ctx, async (tx) => {
          await creditOps.charge(tx, {
            source: 'prompt-generate',
            memberId,
            spend: 'ask',
            usage: res.usage,
            ref: { type: 'ai-prompt', id },
          });
          return promptOps.insertGenerated(tx, id, {
            title: generated.title ?? '',
            prompt: generated.prompt || data.description,
          });
        });
        await fillPromptMetadata(ctx, created.id);
        return run(quiet(ctx), (tx) => promptOps.get(tx, created.id));
      },
      update: async (ctx: ServiceContext, input: UpdatePromptInput) => {
        const updated = await run(ctx, (tx) => promptOps.update(tx, input));
        if (input.prompt !== undefined) await fillPromptMetadata(ctx, updated.id);
        return run(quiet(ctx), (tx) => promptOps.get(tx, updated.id));
      },
      delete: (ctx: ServiceContext, promptId: string) => run(ctx, (tx) => promptOps.delete(tx, promptId)),
      share: (ctx: ServiceContext, input: SharePromptInput) => run(ctx, (tx) => promptOps.share(tx, input)),
      sharing: (ctx: ServiceContext, promptId: string) => run(ctx, (tx) => promptOps.sharing(tx, promptId)),
      /** "Add to my prompts" / "Remove" for curated prompts. */
      save: (ctx: ServiceContext, curatedId: string) => run(ctx, (tx) => promptOps.save(tx, curatedId)),
      unsave: (ctx: ServiceContext, curatedId: string) => run(ctx, (tx) => promptOps.unsave(tx, curatedId)),
    },
    credits: {
      usage: (ctx: ServiceContext, input?: CreditsUsageInput) => run(ctx, (tx) => creditOps.usage(tx, input)),
      ledger: (ctx: ServiceContext, input?: CreditsLedgerInput) => run(ctx, (tx) => creditOps.ledger(tx, input)),
    },
    /** records.summary.get / regenerate (record page Overview card). */
    recordSummaries: {
      get: (ctx: ServiceContext, input: RecordSummaryInput) =>
        run(ctx, (tx) => recordSummaryOps.get(tx, policies, input)),
      regenerate: (ctx: ServiceContext, input: RecordSummaryInput) =>
        recordSummaryOps.regenerate({ database, policies, llm }, ctx, input),
    },
  };
}
