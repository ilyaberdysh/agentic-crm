// Transitional SDK-shaped facade for existing AI consumers. New consumers use inference.ts and its adapters.
// The one LLM module of the AI layer (slice10-contracts: every LLM call goes through here). Ask Agentic, record
// summaries, AI attributes, formula generation, call summaries / insights and the workflow AI blocks all call
// `LlmClient.complete` (one request → final message) or `LlmClient.stream` (same, with block-level deltas).
//
//   - Provider: the Anthropic API (`@anthropic-ai/sdk`), beta Messages endpoint for the server-side refusal fallback
//     (`fallbacks: "default"`, header server-side-fallback-2026-07-01) on the models that support it.
//   - Models per purpose (decision): Ask → claude-opus-5-5; bulk jobs (summaries, AI attributes, insights, workflow
//     blocks) → claude-sonnet-5-5; small fast jobs (titles, reply suggestions, prompt metadata) → claude-haiku-5-5.
//     A workspace may override the Ask / bulk / fast models (workspace_ai_settings.models; `workspaceModelFor`).
//   - Thinking: adaptive (the default on the 5.5 models — the parameter is omitted); depth via `effort`.
//   - Prompt caching: top-level automatic cache_control on every request; callers keep the system prompt and the tool
//     list byte-stable and put volatile data (dates, ids) in the messages.
//   - Usage accounting: token usage × list price → micro-USD → credits (1 credit = $0.01, MICRO_USD_PER_CREDIT).
//   - Tests never call the network: `FakeLlm` answers deterministically from scripted rules (`when`), fixture files
//     keyed by prompt hash or by a matcher, and finally a generated reply (structured outputs: a sample that satisfies
//     the JSON schema; text: `[fake:<purpose>] …`).
// Without ANTHROPIC_API_KEY `createLlm()` returns an unconfigured client: `configured` is false and every call fails
// with 503 AI_NOT_CONFIGURED (AI features show their "not configured" state).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '@agentic-crm/config';
import Anthropic from '@anthropic-ai/sdk';
import { DomainError } from '../errors.ts';
import type { Tx } from '../tx.ts';
import { AnthropicLlm } from './adapters/anthropic.ts';
import type { InferenceEffort } from './inference.ts';

// ---- SDK types used across the AI layer (beta namespace: the request carries `fallbacks`) -------------------------

export type LlmMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type LlmContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
export type LlmTool = Anthropic.Beta.Messages.BetaToolUnion;
/** A user-defined (client) tool. */
export type LlmCustomTool = Anthropic.Beta.Messages.BetaTool;
export type LlmMessage = Anthropic.Beta.Messages.BetaMessage;
export type LlmContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
export type LlmToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;
export type LlmToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;
export type LlmTextBlockParam = Anthropic.Beta.Messages.BetaTextBlockParam;

// ---- models, purposes, prices ---------------------------------------------------------------------------------------

export type ModelTier = 'ask' | 'bulk' | 'fast';

export interface ModelInfo {
  id: string;
  label: string;
  brand: 'anthropic';
  /** USD per million tokens. Cache writes are the 5-minute TTL price (1.25 × input). */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Server-side refusal fallback (`fallbacks: "default"`) is accepted for this model. */
  fallback: boolean;
}

export const AI_MODELS: readonly ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5',
    brand: 'anthropic',
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    fallback: true,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5',
    brand: 'anthropic',
    price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
    fallback: true,
  },
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5',
    brand: 'anthropic',
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
    fallback: false,
  },
];

export const DEFAULT_MODELS: Record<ModelTier, string> = {
  ask: 'claude-opus-5-5',
  bulk: 'claude-sonnet-5-5',
  fast: 'claude-haiku-5-5',
};

/** Web search server tool: $10 per 1,000 searches. */
const WEB_SEARCH_MICRO_USD = 10_000;
/** 1 credit = $0.01 of provider cost. */
export const MICRO_USD_PER_CREDIT = 10_000;

/**
 * What a call is for: picks the default model tier and effort, namespaces fake fixtures and labels usage. Owners:
 * ask*, record-summary, workflow-*, prompt-* (S10-ASK); ai-attribute*, formula* (S10-FORMULA); call-* (S10-CALLS).
 */
export type LlmPurpose =
  | 'ask'
  | 'ask-title'
  | 'ask-suggestions'
  | 'web-search'
  | 'record-summary'
  | 'prompt-generate'
  | 'prompt-metadata'
  | 'workflow-agent'
  | 'workflow-classify'
  | 'workflow-summarize'
  | 'ai-attribute'
  | 'formula'
  | 'call-summary'
  | 'call-insight'
  | (string & {});

const PURPOSE_TIER: Record<string, ModelTier> = {
  ask: 'ask',
  'ask-title': 'fast',
  'ask-suggestions': 'fast',
  'prompt-metadata': 'fast',
};
const PURPOSE_EFFORT: Record<string, Effort> = {
  ask: 'medium',
  'ask-title': 'low',
  'ask-suggestions': 'low',
  'prompt-metadata': 'low',
  'workflow-classify': 'low',
  'ai-attribute': 'low',
};

export type Effort = InferenceEffort;

export function purposeEffort(purpose: LlmPurpose): Effort | undefined {
  return PURPOSE_EFFORT[purpose];
}

export function modelInfo(id: string): ModelInfo | undefined {
  return AI_MODELS.find((m) => m.id === id);
}

export function tierOf(purpose: LlmPurpose): ModelTier {
  return PURPOSE_TIER[purpose] ?? 'bulk';
}

/** The model for `purpose` given optional workspace overrides per tier (unknown ids fall back to the default). */
export function modelFor(purpose: LlmPurpose, overrides: Partial<Record<ModelTier, string | null>> = {}): string {
  const tier = tierOf(purpose);
  const wanted = overrides[tier];
  return wanted && modelInfo(wanted) ? wanted : DEFAULT_MODELS[tier];
}

/** The model for `purpose` in the transaction's workspace (Settings → Ask Agentic overrides, if any). */
export async function workspaceModelFor(tx: Tx, purpose: LlmPurpose): Promise<string> {
  const row = await tx.db
    .selectFrom('workspace_ai_settings')
    .select('models')
    .where('workspace_id', '=', tx.workspaceId)
    .executeTakeFirst();
  return modelFor(purpose, (row?.models ?? {}) as Partial<Record<ModelTier, string | null>>);
}

// ---- usage -------------------------------------------------------------------------------------------------------

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearchRequests: number;
  /** Provider cost in micro-USD at list price; null when the model price is unknown. */
  microUsd: number | null;
}

export const ZERO_USAGE: LlmUsage = {
  model: '',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
  microUsd: 0,
};

export function costMicroUsd(u: Omit<LlmUsage, 'microUsd'>): number | null {
  const price = modelInfo(u.model)?.price;
  if (!price) return null;
  const usd =
    (u.inputTokens * price.input +
      u.outputTokens * price.output +
      u.cacheReadTokens * price.cacheRead +
      u.cacheWriteTokens * price.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000) + u.webSearchRequests * WEB_SEARCH_MICRO_USD;
}

/** Sums usages (the model of the latest non-empty usage wins). */
export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    model: b.model || a.model,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    webSearchRequests: a.webSearchRequests + b.webSearchRequests,
    microUsd: a.microUsd === null || b.microUsd === null ? null : a.microUsd + b.microUsd,
  };
}

/** Existing billing/storage cannot represent unknown cost. Reject it rather than recording invented spend. */
export function requireKnownCost(microUsd: number | null): number {
  if (microUsd === null) {
    throw new DomainError(502, 'AI_PROVIDER_ERROR', 'The model price is unknown; credits cannot be calculated', {
      reason: 'unknown-model-price',
    });
  }
  return microUsd;
}

/** Credits for known provider cost: rounded up to whole credits, at least 1 for any non-zero spend. */
export function creditsFor(microUsd: number | null): number {
  const known = requireKnownCost(microUsd);
  return known <= 0 ? 0 : Math.max(1, Math.ceil(known / MICRO_USD_PER_CREDIT));
}

function usageOf(message: LlmMessage, requestedModel: string): LlmUsage {
  const u = message.usage;
  const base = {
    model: message.model || requestedModel,
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    webSearchRequests: u.server_tool_use?.web_search_requests ?? 0,
  };
  return { ...base, microUsd: costMicroUsd(base) };
}

// ---- request / response ---------------------------------------------------------------------------------------------

export interface LlmRequest {
  purpose: LlmPurpose;
  /** Explicit model id (otherwise the purpose's default; callers pass `await workspaceModelFor(tx, purpose)`). */
  model?: string;
  /** Stable instructions; a string or blocks (mark the last stable block with cache_control). */
  system?: string | LlmTextBlockParam[];
  messages: LlmMessageParam[];
  /** Deterministic order (prompt caching is a prefix match over tools → system → messages). */
  tools?: LlmTool[];
  /** Default 16,000 (non-streaming callers) / 64,000 (stream). Thinking tokens count against it. */
  maxTokens?: number;
  effort?: Effort;
  /** Transitional adapter controls; legacy callers retain today's defaults when omitted. */
  usePurposeEffortDefault?: boolean;
  promptCaching?: boolean;
  /** Structured output: the final text block is JSON matching this schema (parsed into `LlmResponse.json`). */
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmResponse {
  /** The final assistant message (content blocks are stored verbatim to continue tool loops — thinking included). */
  message: LlmMessage;
  /** Concatenated text blocks. */
  text: string;
  /** Parsed structured output (`outputSchema`), null when absent or unparseable. */
  json: unknown;
  toolCalls: LlmToolUseBlock[];
  stopReason: LlmMessage['stop_reason'];
  /** stop_reason "refusal": the provider (and its fallback chain) declined. */
  refused: boolean;
  usage: LlmUsage;
}

/** Block-level streaming callbacks (indexes are content block indexes of the message being generated). */
export interface LlmStreamHandlers {
  onBlockStart?(index: number, block: { type: string; id?: string; name?: string }): void;
  /** `snapshot` is the block's whole text so far. */
  onTextDelta?(index: number, delta: string, snapshot: string): void;
  /** `snapshot` is the raw (possibly partial) JSON of the tool input so far. */
  onToolInputDelta?(index: number, partialJson: string, snapshot: string): void;
  onBlockStop?(index: number): void;
}

export interface LlmClient {
  /** False without a provider key: calls throw AI_NOT_CONFIGURED; the UI shows "not configured". */
  readonly configured: boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
  stream(request: LlmRequest, handlers: LlmStreamHandlers): Promise<LlmResponse>;
}

export const notConfigured = () =>
  new DomainError(503, 'AI_NOT_CONFIGURED', 'AI is not configured: set ANTHROPIC_API_KEY to enable AI features');

function textOf(content: LlmContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate a fenced block around the JSON.
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Transitional SDK-shaped response builder. New consumers use the inference adapter. */
export function toResponse(message: LlmMessage, request: LlmRequest, model: string): LlmResponse {
  const text = textOf(message.content);
  return {
    message,
    text,
    json: request.outputSchema && message.stop_reason !== 'refusal' ? parseJson(text) : null,
    toolCalls: message.content.filter((b): b is LlmToolUseBlock => b.type === 'tool_use'),
    stopReason: message.stop_reason,
    refused: message.stop_reason === 'refusal',
    usage: usageOf(message, model),
  };
}

// Anthropic transport is isolated behind the adapter; these names preserve existing consumers.
export { AnthropicLlm } from './adapters/anthropic.ts';

export class UnconfiguredLlm implements LlmClient {
  readonly configured = false;
  complete(): Promise<LlmResponse> {
    return Promise.reject(notConfigured());
  }
  stream(): Promise<LlmResponse> {
    return Promise.reject(notConfigured());
  }
}

/**
 * The process's LLM client: Anthropic when ANTHROPIC_API_KEY is set, otherwise the unconfigured client. Under Vitest
 * the environment key is ignored (tests never call the network; they pass a FakeLlm). `AGENTIC_CRM_LLM=fake` makes a
 * running stack (Playwright e2e, demos without a key) answer from the deterministic fake and its fixtures.
 */
export function createLlm(options: { apiKey?: string | undefined } = {}): LlmClient {
  // `AGENTIC_CRM_LLM=fake` (e2e stacks, local demos without a key): the deterministic fake answers from the scripted
  // scenarios in src/ai/fixtures/e2e (or the directory in AGENTIC_CRM_LLM_FIXTURES); an explicit option still wins.
  if (process.env.AGENTIC_CRM_LLM === 'fake' && options.apiKey === undefined) {
    return new FakeLlm({ fixturesDir: process.env.AGENTIC_CRM_LLM_FIXTURES ?? E2E_FIXTURES_DIR });
  }
  const apiKey = options.apiKey ?? (process.env.VITEST ? undefined : config.anthropicApiKey);
  return apiKey ? new AnthropicLlm({ apiKey }) : new UnconfiguredLlm();
}

// ---- deterministic fake (tests) ------------------------------------------------------------------------------------

/** A scripted reply of the fake. */
export interface FakeReply {
  text?: string;
  /** Tool calls after the text (ids default to deterministic `toolu_fake_<n>`). */
  toolCalls?: { name: string; input: unknown; id?: string }[];
  /** Structured output (serialized into the text block). */
  json?: unknown;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';
  usage?: Partial<Pick<LlmUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>>;
  webSearchRequests?: number;
  /** Throw this instead of answering (e.g. a DomainError to simulate a provider failure). */
  error?: unknown;
  /** Wait this long before each streamed chunk (tests that observe streaming over the network). */
  chunkDelayMs?: number;
}

export type FakeMatcher = (request: LlmRequest) => boolean;

/** A fixture file entry (`packages/domain/src/ai/fixtures/*.json`, or any directory passed to FakeLlm). */
export interface FakeFixture {
  /** Prompt hash prefix (`promptHash(request)`, ≥ 8 hex chars); or */
  key?: string;
  /** a matcher: purpose and/or substrings of the last user message. */
  match?: {
    purpose?: string;
    contains?: string | string[];
    /** true: only the continuation after tool calls (the last message carries tool results); false: only the first step. */
    toolResults?: boolean;
  };
  reply: FakeReply;
}

interface FakeRule {
  match: FakeMatcher;
  reply: FakeReply | ((request: LlmRequest, calls: number) => FakeReply);
  times: number;
  used: number;
}

/** Text of the last user message (string content and text blocks; tool results excluded). */
export function lastUserText(request: LlmRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const m = request.messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const texts = m.content.filter((b): b is LlmTextBlockParam => b.type === 'text').map((b) => b.text);
    if (texts.length > 0) return texts.join('\n');
  }
  return '';
}

/** Tool results carried by the last message (the turn is continuing after tool calls). */
export function lastToolResults(request: LlmRequest): LlmToolResultBlockParam[] {
  const m = request.messages[request.messages.length - 1];
  if (!m || m.role !== 'user' || typeof m.content === 'string') return [];
  return m.content.filter((b): b is LlmToolResultBlockParam => b.type === 'tool_result');
}

/** Stable hash of what the model sees (model, system, messages, tool names, output schema). */
export function promptHash(request: LlmRequest): string {
  const canonical = JSON.stringify({
    model: request.model ?? modelFor(request.purpose),
    purpose: request.purpose,
    system: request.system ?? null,
    messages: request.messages,
    tools: (request.tools ?? []).map((t) => ('name' in t ? t.name : t.type)),
    schema: request.outputSchema ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** Scripted scenarios of the e2e stack (AGENTIC_CRM_LLM=fake): kept apart so unit tests never pick them up. */
const E2E_FIXTURES_DIR = fileURLToPath(new URL('./fixtures/e2e/', import.meta.url));

export function loadFixtures(dir: string = FIXTURES_DIR): FakeFixture[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.sort().flatMap((f) => JSON.parse(readFileSync(`${dir}${f}`, 'utf8')) as FakeFixture[]);
}

function approxTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}

/** A value satisfying a (structured-outputs subset of) JSON schema: first enum value, minimal arrays, "fake" text. */
export function sampleFromSchema(schema: unknown, name = 'value'): unknown {
  const s = (schema ?? {}) as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if ('const' in s) return s.const;
  const anyOf = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(anyOf) && anyOf.length > 0) return sampleFromSchema(anyOf[0], name);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type) {
    case 'object': {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFromSchema(v, k)]));
    }
    case 'array': {
      const min = typeof s.minItems === 'number' ? s.minItems : 0;
      return Array.from({ length: Math.max(min, 1) }, () => sampleFromSchema(s.items, name));
    }
    case 'number':
    case 'integer':
      return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return `fake ${name}`;
  }
}

/** Value at a dotted path (`task_id`, `records.0.link`) of a parsed tool result. */
function valueAt(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const CONTEXT_PATTERNS: Record<string, RegExp> = {
  meeting_id: /meeting_id ([0-9a-f-]{36})/,
  call_recording_id: /call_recording_id ([0-9a-f-]{36})/,
  member_id: /workspace member id ([0-9a-f-]{36})/,
  entity_definition_id: /"entity_definition_id":"([0-9a-f-]{36})"/,
  entity_instance_id: /"entity_instance_id":"([0-9a-f-]{36})"/,
};

/**
 * Fixture replies may quote what the model would have seen, so a scripted answer can name real ids:
 *   `{{result.task_id}}`      a field of the JSON the first tool result returned (the continuation after tool calls);
 *   `{{results.1.records.0.link}}`  the same for the n-th tool result (0-based);
 *   `{{context.<key>}}`       an id of the prompt: `meeting_id`, `call_recording_id` (the call the user has open),
 *                             `entity_definition_id`, `entity_instance_id` (the first page record), `member_id`
 *                             (the asking member).
 * Placeholders without a value render empty. Applied to the text, to tool inputs and to structured output.
 */
function withTemplates(reply: FakeReply, request: LlmRequest): FakeReply {
  const raw = JSON.stringify(reply);
  if (!raw.includes('{{')) return reply;
  const results = lastToolResults(request).map((r) => {
    try {
      return JSON.parse(String(r.content)) as unknown;
    } catch {
      return null;
    }
  });
  const result = results[0] ?? null;
  const haystack = JSON.stringify(request.system ?? '') + '\n' + lastUserText(request);
  const fill = (text: string): string =>
    text.replace(/\{\{\s*(results?|context)\.([\w.]+)\s*\}\}/g, (_m, kind: string, path: string) => {
      if (kind === 'result') return String(valueAt(result, path) ?? '');
      if (kind === 'results') return String(valueAt(results, path) ?? '');
      return CONTEXT_PATTERNS[path]?.exec(haystack)?.[1] ?? '';
    });
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return fill(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(reply) as FakeReply;
}

/**
 * Deterministic in-process LLM for tests. Lookup order: rules added with `when` (latest first), fixtures by prompt
 * hash, fixtures by matcher, then a generated reply. Streams text in small chunks so streaming paths are exercised.
 */
export class FakeLlm implements LlmClient {
  readonly configured = true;
  /** Every request in call order (assert on prompts / tools / models). */
  readonly calls: LlmRequest[] = [];
  private readonly rules: FakeRule[] = [];
  private readonly fixtures: FakeFixture[];
  private toolSeq = 0;

  constructor(options: { fixtures?: FakeFixture[]; fixturesDir?: string } = {}) {
    this.fixtures = [...(options.fixtures ?? []), ...loadFixtures(options.fixturesDir)];
  }

  /** Answers requests matching `match` with `reply` (`times` uses, default unlimited). Returns `this`. */
  when(
    match: FakeMatcher,
    reply: FakeReply | ((request: LlmRequest, calls: number) => FakeReply),
    options: { times?: number } = {},
  ): this {
    this.rules.unshift({ match, reply, times: options.times ?? Number.POSITIVE_INFINITY, used: 0 });
    return this;
  }

  reset(): void {
    this.rules.length = 0;
    this.calls.length = 0;
  }

  callsFor(purpose: LlmPurpose): LlmRequest[] {
    return this.calls.filter((c) => c.purpose === purpose);
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    return this.stream(request, {});
  }

  async stream(request: LlmRequest, handlers: LlmStreamHandlers): Promise<LlmResponse> {
    this.calls.push(request);
    if (request.signal?.aborted) throw new Anthropic.APIUserAbortError();
    const reply = withTemplates(this.replyFor(request), request);
    if (reply.error) throw reply.error;
    const model = request.model ?? modelFor(request.purpose);
    const content: LlmContentBlock[] = [];
    const text = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? '');
    let index = 0;
    if (text) {
      handlers.onBlockStart?.(index, { type: 'text' });
      let snapshot = '';
      for (const chunk of text.match(/[\s\S]{1,12}/g) ?? []) {
        if (request.signal?.aborted) throw new Anthropic.APIUserAbortError();
        snapshot += chunk;
        handlers.onTextDelta?.(index, chunk, snapshot);
        await (reply.chunkDelayMs ? new Promise((r) => setTimeout(r, reply.chunkDelayMs)) : Promise.resolve());
      }
      handlers.onBlockStop?.(index);
      content.push({ type: 'text', text, citations: null } as LlmContentBlock);
      index++;
    }
    for (const call of reply.toolCalls ?? []) {
      const id = call.id ?? `toolu_fake_${++this.toolSeq}`;
      handlers.onBlockStart?.(index, { type: 'tool_use', id, name: call.name });
      const json = JSON.stringify(call.input ?? {});
      let snapshot = '';
      for (const chunk of json.match(/[\s\S]{1,16}/g) ?? []) {
        snapshot += chunk;
        handlers.onToolInputDelta?.(index, chunk, snapshot);
        await Promise.resolve();
      }
      handlers.onBlockStop?.(index);
      content.push({ type: 'tool_use', id, name: call.name, input: call.input ?? {} } as LlmContentBlock);
      index++;
    }
    const stopReason = reply.stopReason ?? (reply.toolCalls?.length ? 'tool_use' : 'end_turn');
    const usage = {
      model,
      inputTokens: reply.usage?.inputTokens ?? approxTokens([request.system, request.messages]),
      outputTokens: reply.usage?.outputTokens ?? approxTokens([text, reply.toolCalls]),
      cacheReadTokens: reply.usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: reply.usage?.cacheWriteTokens ?? 0,
      webSearchRequests: reply.webSearchRequests ?? 0,
    };
    const message = {
      id: `msg_fake_${promptHash(request).slice(0, 16)}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cache_read_input_tokens: usage.cacheReadTokens,
        cache_creation_input_tokens: usage.cacheWriteTokens,
        server_tool_use: usage.webSearchRequests ? { web_search_requests: usage.webSearchRequests } : null,
      },
    } as unknown as LlmMessage;
    return toResponse(message, request, model);
  }

  private replyFor(request: LlmRequest): FakeReply {
    for (const rule of this.rules) {
      if (rule.used >= rule.times || !rule.match(request)) continue;
      rule.used++;
      return typeof rule.reply === 'function' ? rule.reply(request, rule.used) : rule.reply;
    }
    const hash = promptHash(request);
    const byKey = this.fixtures.find((f) => f.key && f.key.length >= 8 && hash.startsWith(f.key));
    if (byKey) return byKey.reply;
    const text = lastUserText(request);
    const byMatch = this.fixtures.find((f) => {
      if (!f.match) return false;
      if (f.match.purpose && f.match.purpose !== request.purpose) return false;
      if (f.match.toolResults !== undefined && f.match.toolResults !== lastToolResults(request).length > 0)
        return false;
      const needles = f.match.contains === undefined ? [] : [f.match.contains].flat();
      return needles.every((n) => text.includes(n));
    });
    if (byMatch) return byMatch.reply;
    if (process.env.LLM_FAKE_LOG) console.info(`[fake-llm] no fixture for ${request.purpose} (${hash.slice(0, 12)})`);
    if (request.outputSchema) return { json: sampleFromSchema(request.outputSchema) };
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 120);
    return { text: `[fake:${request.purpose}] ${snippet}`.trim() };
  }
}
