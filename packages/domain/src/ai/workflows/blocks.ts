// Workflow AI blocks (BACKLOG 10.08; block-catalog §4): Custom agent, Classify record, Classify text, Summarize
// record. They run inside the engine's step transaction as the workflow actor (its grants govern the agent's
// tools), check the workspace pool before calling the model (failure reason insufficient-credits) and report their
// token-based cost as the execution's credits (workflow_credit_usage; "Dynamic" in the block panel).

import { blockDefinition } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import Anthropic from '@anthropic-ai/sdk';
import { DomainError } from '../../errors.ts';
import type { Tx } from '../../tx.ts';
import { entryOf } from '../../workflows/graph.ts';
import { asArray, inputsInvalid, isEmpty, StepError, toMemberId, toRecord, toText } from '../../workflows/runtime.ts';
import type { StepContext, StepResult } from '../../workflows/steps.ts';
import { creditOps } from '../credits/ledger.ts';
import {
  addUsage,
  creditsFor,
  type LlmClient,
  type LlmMessageParam,
  type LlmToolResultBlockParam,
  type LlmUsage,
  modelInfo,
  workspaceModelFor,
  ZERO_USAGE,
} from '../llm.ts';
import { renderRecords } from '../render.ts';
import { AI_TOOLS, aiTool } from '../tools/catalog.ts';
import { type ToolEnv, ToolError, toProviderTool } from '../tools/registry.ts';

/** Custom agent tool groups (block-catalog §4 `tools.system_tools.tool_groups`) → read-only Ask Agentic tools. */
const TOOL_GROUPS: Record<string, string[]> = {
  particle: ['search-records', 'list-records', 'get-records', 'list-attributes'],
  lists: ['list-lists'],
  tasks: ['list-tasks'],
  notes: ['list-notes', 'get-notes'],
  meeting: ['search-meetings', 'get-meeting'],
  'call-recording': ['get-call-recording'],
  emails: ['search-emails', 'get-emails'],
  workspace: ['list-workspace-members'],
  'web-search': ['search-web'],
};
const AGENT_MAX_STEPS = 8;

async function value(c: StepContext, key: string): Promise<unknown> {
  const expr = entryOf(c.config, key);
  const v =
    expr === undefined
      ? (blockDefinition(c.slug)?.inputs.find((i) => i.key === key)?.default ?? null)
      : await c.resolver.expr(expr);
  c.inputs[key] = v;
  return v;
}

async function text(c: StepContext, key: string): Promise<string> {
  const v = await c.resolver.text(entryOf(c.config, key));
  c.inputs[key] = v;
  return v;
}

/**
 * Upper bound of one model call. AI blocks run inside the engine's step transaction (the block's reads, outputs and
 * credits commit together), so a call holds one pooled connection and the run's row lock while the model answers.
 * Workflow jobs run at most two at a time per worker, so that is bounded; the timeout keeps a stuck provider call from
 * holding them indefinitely (the block fails with an execution error and can be retried from the run page).
 */
export const WORKFLOW_MODEL_CALL_TIMEOUT_MS = 120_000;

function llmOf(c: StepContext): LlmClient {
  const llm = c.deps.llm;
  if (!llm?.configured) throw new StepError('execution-error', 'AI is not configured for this workspace');
  return {
    configured: true,
    complete: (request) =>
      llm.complete({ ...request, signal: request.signal ?? AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS) }),
    stream: (request, handlers) =>
      llm.stream(
        { ...request, signal: request.signal ?? AbortSignal.timeout(WORKFLOW_MODEL_CALL_TIMEOUT_MS) },
        handlers,
      ),
  };
}

async function assertPool(tx: Tx): Promise<void> {
  try {
    await creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' });
  } catch (err) {
    if (err instanceof DomainError && err.code === 'CREDITS_EXHAUSTED') {
      throw new StepError('insufficient-credits', 'Your workspace does not have enough credits');
    }
    throw err;
  }
}

/** The block's cost: token-based credits, at least 1 (the block ran the model). */
const costOf = (usage: LlmUsage) => Math.max(1, creditsFor(usage.microUsd));

function wrapProvider(err: unknown): never {
  if (err instanceof DomainError) throw new StepError('execution-error', err.message);
  if (err instanceof Anthropic.APIUserAbortError || (err instanceof Error && err.name === 'TimeoutError')) {
    throw new StepError('execution-error', 'The model did not answer in time');
  }
  throw err;
}

async function recordContext(c: StepContext, key: string, label: string) {
  const record = toRecord(await value(c, key));
  if (!record) throw inputsInvalid(`"${label}" is not a record`);
  await c.deps.policies.assertCan(c.tx, record.entityDefinitionId, 'read_entity_instance');
  const [rendered] = await renderRecords(c.tx, record.entityDefinitionId, [record.entityInstanceId], {
    withValues: true,
  });
  if (!rendered) throw inputsInvalid(`"${label}" no longer exists`);
  return rendered;
}

async function classify(c: StepContext, subject: string): Promise<StepResult> {
  const tags = asArray(await value(c, 'tags'))
    .map((t) => toText(t).trim())
    .filter(Boolean);
  if (tags.length === 0) throw inputsInvalid('Add at least one tag');
  const multiple = (await value(c, 'allow_multiple_tags')) === true;
  const llm = llmOf(c);
  await assertPool(c.tx);
  const res = await llm
    .complete({
      purpose: 'workflow-classify',
      model: await workspaceModelFor(c.tx, 'workflow-classify'),
      system:
        `Classify the input into ${multiple ? 'one or more' : 'exactly one'} of the given tags. Choose only tags ` +
        'from the list; pick the closest one when none fits perfectly.',
      messages: [{ role: 'user', content: `Tags: ${JSON.stringify(tags)}\n\nInput:\n${subject}` }],
      outputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string', enum: tags },
            minItems: 1,
            ...(multiple ? {} : { maxItems: 1 }),
          },
        },
        required: ['tags'],
        additionalProperties: false,
      },
      maxTokens: 4000,
    })
    .catch(wrapProvider);
  const chosen = ((res.json as { tags?: unknown[] } | null)?.tags ?? [])
    .map((t) => toText(t))
    .filter((t) => tags.includes(t));
  const picked = multiple ? [...new Set(chosen)] : chosen.slice(0, 1);
  if (picked.length === 0) throw new StepError('execution-error', 'The model did not return a tag');
  return {
    kind: 'outcome',
    outcome: 'done',
    outputs: { classification: picked.join(', ') },
    cost: costOf(res.usage),
  };
}

export const AI_WORKFLOW_HANDLERS: Record<string, (c: StepContext) => Promise<StepResult>> = {
  async 'classify-entity'(c) {
    const record = await recordContext(c, 'input', 'Record');
    return classify(c, JSON.stringify(record));
  },

  async 'classify-text'(c) {
    const input = (await text(c, 'input')).trim();
    if (!input) throw inputsInvalid('"Input" resolved to an empty value');
    return classify(c, input.slice(0, 50_000));
  },

  async 'summarize-entity'(c) {
    const record = await recordContext(c, 'entity_instance', 'Record');
    const instructions = (await text(c, 'instructions')).trim();
    const llm = llmOf(c);
    await assertPool(c.tx);
    const res = await llm
      .complete({
        purpose: 'workflow-summarize',
        model: await workspaceModelFor(c.tx, 'workflow-summarize'),
        system:
          'Summarize the CRM record given as JSON in a short paragraph of plain prose. Follow the instructions when ' +
          'given. Use only the data provided.',
        messages: [
          {
            role: 'user',
            content: `${instructions ? `Instructions: ${instructions}\n\n` : ''}Record:\n${JSON.stringify(record)}`,
          },
        ],
        maxTokens: 8000,
      })
      .catch(wrapProvider);
    return { kind: 'outcome', outcome: 'done', outputs: { summary: res.text.trim() }, cost: costOf(res.usage) };
  },

  async 'run-custom-ai-agent'(c) {
    const instructions = (await text(c, 'instructions')).trim();
    if (!instructions) throw inputsInvalid('"Prompt" resolved to an empty value');
    const system = (await text(c, 'system_instructions')).trim();
    const mode = toText(await value(c, 'output_mode')) || 'plaintext';
    const requestedModel = toText(await value(c, 'model'));
    if (requestedModel && !modelInfo(requestedModel)) throw inputsInvalid(`Unknown model "${requestedModel}"`);
    const toolConfig = (await value(c, 'tools')) as {
      tool_groups?: unknown;
      system_tools?: { tool_groups?: unknown };
    } | null;
    const groups = asArray(toolConfig?.system_tools?.tool_groups ?? toolConfig?.tool_groups).map((g) => toText(g));
    const names = new Set(groups.flatMap((g) => TOOL_GROUPS[g] ?? []));
    const tools = AI_TOOLS.filter((t) => names.has(t.name) && t.kind !== 'write');
    const runAs = toMemberId(asArray(await value(c, 'run_as'))[0]);
    let schema: Record<string, unknown> | undefined;
    if (mode === 'structured') {
      const schemaText = await text(c, 'structured_output_schema');
      try {
        schema = JSON.parse(schemaText) as Record<string, unknown>;
      } catch {
        throw inputsInvalid('Invalid JSON schema');
      }
    }
    const llm = llmOf(c);
    await assertPool(c.tx);
    const model = requestedModel || (await workspaceModelFor(c.tx, 'workflow-agent'));
    const usage = { total: { ...ZERO_USAGE } };
    const messages: LlmMessageParam[] = [{ role: 'user', content: instructions }];
    const env: ToolEnv = {
      tx: c.tx,
      policies: c.deps.policies,
      llm,
      memberId: runAs,
      timeZone: c.timeZone,
      addUsage: (u) => {
        usage.total = addUsage(usage.total, u);
      },
    };
    let answer = '';
    let json: unknown = null;
    for (let step = 0; step < AGENT_MAX_STEPS; step++) {
      const res = await llm
        .complete({
          purpose: 'workflow-agent',
          model,
          system:
            `${system ? `${system}\n\n` : ''}You are an AI agent running inside a CRM workflow. Use the tools to ` +
            'read workspace data when needed, then answer the task. Your final answer is used by later workflow ' +
            'steps, so give only the answer.',
          messages,
          ...(tools.length ? { tools: tools.map(toProviderTool) } : {}),
          ...(schema ? { outputSchema: schema } : {}),
          maxTokens: 16_000,
        })
        .catch(wrapProvider);
      usage.total = addUsage(usage.total, res.usage);
      if (res.refused) throw new StepError('execution-error', 'The model declined this request');
      if (res.toolCalls.length === 0 || step === AGENT_MAX_STEPS - 1) {
        answer = res.text.trim();
        json = res.json;
        break;
      }
      const results: LlmToolResultBlockParam[] = [];
      for (const call of res.toolCalls) {
        const tool = aiTool(call.name);
        const parsed = tool?.input.safeParse(call.input);
        if (!tool || !parsed?.success || !tools.includes(tool)) {
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({ error: tool ? 'Invalid input' : `Unknown tool "${call.name}"` }),
          });
          continue;
        }
        // A savepoint keeps a failing tool from aborting the step's transaction.
        await sql`SAVEPOINT ai_tool`.execute(c.tx.db);
        try {
          const out = await tool.execute(env, parsed.data);
          await sql`RELEASE SAVEPOINT ai_tool`.execute(c.tx.db);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(out.output) });
        } catch (err) {
          await sql`ROLLBACK TO SAVEPOINT ai_tool`.execute(c.tx.db);
          if (!(err instanceof ToolError || (err instanceof DomainError && err.statusCode < 500))) throw err;
          results.push({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({ error: (err as Error).message }),
          });
        }
      }
      messages.push(
        { role: 'assistant', content: res.message.content as unknown as LlmMessageParam['content'] },
        { role: 'user', content: results },
      );
    }
    c.inputs.model = model;
    const cost = costOf(usage.total);
    if (schema) {
      const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      const outputs: Record<string, unknown> = { response: answer };
      for (const key of Object.keys(props)) outputs[key] = isEmpty(obj[key]) ? null : obj[key];
      return { kind: 'outcome', outcome: 'done', outputs, cost };
    }
    return { kind: 'outcome', outcome: 'done', outputs: { response: answer }, cost };
  },
};
