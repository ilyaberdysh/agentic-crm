/** Bounded Chat Completions transport for explicitly configured OpenAI-compatible endpoints. */
import {
  type InferenceCapabilities,
  type InferenceClient,
  type InferenceContent,
  InferenceError,
  type InferenceEvent,
  type InferenceMessage,
  type InferenceRequest,
  type InferenceResponse,
} from '../inference.ts';

const PROVIDER = 'openai-compatible';
const ADAPTER_VERSION = '1';

/** Features whose wire behavior the operator has verified for this endpoint/model family. */
export interface OpenAICompatibleFeatures {
  text: boolean;
  clientTools: boolean;
  structuredOutput: 'none' | 'native';
  streaming: boolean;
}

export interface OpenAICompatibleAdapterOptions {
  /** Base URL for a Chat Completions-compatible API, e.g. https://host.example/v1. */
  baseURL: string;
  /** Optional for local endpoints that do not require bearer authentication. */
  apiKey?: string;
  /** Default model used only when a request does not specify one. */
  defaultModel?: string;
  /** Explicitly verified support. This adapter never guesses feature support. */
  features: OpenAICompatibleFeatures;
  /** Injectable HTTP transport for credential-free conformance tests. */
  fetch?: typeof fetch;
}

type WireMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; [key: string]: unknown };
type WireToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

/** The endpoint is configured by the caller; endpoint security and connection storage are separate concerns. */
export class OpenAICompatibleInferenceAdapter implements InferenceClient {
  readonly provider = PROVIDER;
  readonly adapterVersion = ADAPTER_VERSION;
  private readonly requestFetch: typeof fetch;
  private readonly endpoint: string;

  constructor(private readonly options: OpenAICompatibleAdapterOptions) {
    this.requestFetch = options.fetch ?? fetch;
    this.endpoint = `${options.baseURL.replace(/\/+$/, '')}/chat/completions`;
  }

  get configured(): boolean {
    return this.options.baseURL.trim().length > 0;
  }

  capabilities(_model?: string): InferenceCapabilities {
    const configured = this.options.features;
    return {
      text: configured.text,
      vision: false,
      clientTools: configured.clientTools,
      serverTools: [],
      structuredOutput: configured.structuredOutput,
      streaming: configured.streaming,
      reasoningEfforts: [],
      promptCaching: false,
    };
  }

  async complete(request: InferenceRequest): Promise<InferenceResponse> {
    const prepared = prepareRequest(request, this.options, false);
    const response = await this.send(prepared.body, request.signal);
    let payload: unknown;
    try {
      payload = await response.json();
      if (request.signal?.aborted) throw canceled();
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) throw canceled();
      throw new InferenceError('invalid_response', 'The inference provider returned invalid JSON');
    }
    return decodeResponse(payload, request, prepared.model);
  }

  async stream(request: InferenceRequest, onEvent: (event: InferenceEvent) => void): Promise<InferenceResponse> {
    const prepared = prepareRequest(request, this.options, true);
    const response = await this.send(prepared.body, request.signal);
    if (!response.body) throw new InferenceError('invalid_response', 'The inference provider returned no stream body');
    try {
      return await consumeStream(response.body, request, prepared.model, onEvent, request.signal);
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) throw canceled();
      if (error instanceof InferenceError) throw error;
      throw new InferenceError('invalid_response', 'The inference provider returned an invalid stream');
    }
  }

  private async send(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    if (!this.configured) throw new InferenceError('not_configured', 'The inference endpoint is not configured');
    if (signal?.aborted) throw canceled();
    try {
      const response = await this.requestFetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) throw await httpError(response);
      return response;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw canceled();
      if (error instanceof InferenceError) throw error;
      throw new InferenceError('transient', 'The inference provider could not be reached', true);
    }
  }
}

function prepareRequest(
  request: InferenceRequest,
  options: OpenAICompatibleAdapterOptions,
  streaming: boolean,
): { model: string; body: Record<string, unknown> } {
  const features = options.features;
  if (request.signal?.aborted) throw canceled();
  if (!features.text) unsupported('Text inference is not enabled for this endpoint');
  if (streaming && !features.streaming) unsupported('Streaming is not enabled for this endpoint');
  if (request.effort) unsupported('Reasoning effort is unsupported by this adapter');
  if (request.outputSchema && features.structuredOutput !== 'native') {
    unsupported('Structured output is not enabled for this endpoint');
  }
  if (request.tools?.some((tool) => tool.type === 'server'))
    unsupported('Server tools are unsupported by this adapter');
  if (request.tools?.some((tool) => tool.type === 'function') && !features.clientTools) {
    unsupported('Client tools are not enabled for this endpoint');
  }
  const model = request.model ?? options.defaultModel;
  if (!model) throw new InferenceError('not_configured', 'No inference model is configured');
  const messages = toWireMessages(request);
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: streaming,
    ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools
            .filter((tool): tool is Extract<typeof tool, { type: 'function' }> => tool.type === 'function')
            .map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                ...(tool.description !== undefined ? { description: tool.description } : {}),
                parameters: tool.inputSchema,
              },
            })),
        }
      : {}),
    ...(request.outputSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'response', strict: true, schema: request.outputSchema },
          },
        }
      : {}),
  };
  return { model, body };
}

function toWireMessages(request: InferenceRequest): WireMessage[] {
  const result: WireMessage[] = [];
  if (request.system) result.push({ role: 'system', content: request.system });
  for (const message of request.messages) {
    if (message.continuation) unsupported('Provider continuations are not portable to this adapter');
    if (typeof message.content === 'string') {
      result.push({ role: message.role, content: message.content });
      continue;
    }
    const ordinary: InferenceContent[] = [];
    const toolResults: Extract<InferenceContent, { type: 'tool_result' }>[] = [];
    for (const block of message.content) {
      if (block.type === 'reasoning') unsupported('Provider reasoning content is unsupported by this adapter');
      if (block.type === 'tool_result') toolResults.push(block);
      else ordinary.push(block);
    }
    if (ordinary.some((block) => block.type === 'tool_call') && message.role !== 'assistant') {
      unsupported('Tool calls can only appear in assistant messages');
    }
    if (ordinary.length || toolResults.length === 0) {
      const text = ordinary.filter(
        (block): block is Extract<InferenceContent, { type: 'text' }> => block.type === 'text',
      );
      const calls = ordinary.filter(
        (block): block is Extract<InferenceContent, { type: 'tool_call' }> => block.type === 'tool_call',
      );
      result.push({
        role: message.role,
        content: text.length ? text.map((block) => block.text).join('') : null,
        ...(calls.length
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
    }
    for (const toolResult of toolResults) {
      result.push({ role: 'tool', content: toolResult.content, tool_call_id: toolResult.toolCallId });
    }
  }
  return result;
}

function decodeResponse(value: unknown, request: InferenceRequest, requestedModel: string): InferenceResponse {
  const root = record(value);
  const choice = record(Array.isArray(root.choices) ? root.choices[0] : undefined);
  const message = record(choice.message);
  if (!root.id || !choice.message)
    throw new InferenceError('invalid_response', 'The inference provider returned an incomplete response');
  const contentText = typeof message.content === 'string' ? message.content : '';
  const calls = parseToolCalls(message.tool_calls);
  const content: InferenceContent[] = [];
  if (contentText) content.push({ type: 'text', text: contentText });
  content.push(...calls);
  const finish = choice.finish_reason;
  const refused = (typeof message.refusal === 'string' && message.refusal.length > 0) || finish === 'content_filter';
  const json = request.outputSchema && !refused ? parseStructuredJson(contentText) : null;
  const usage = normalizeUsage(root.usage);
  return {
    id: String(root.id),
    provider: PROVIDER,
    adapterVersion: ADAPTER_VERSION,
    model: typeof root.model === 'string' ? root.model : requestedModel,
    message: { role: 'assistant', content },
    text: contentText,
    json,
    toolCalls: calls,
    stopReason: refused
      ? 'refusal'
      : finish === 'stop'
        ? 'completed'
        : finish === 'length'
          ? 'max_tokens'
          : finish === 'tool_calls' || calls.length > 0
            ? 'tool_calls'
            : finish === 'content_filter'
              ? 'refusal'
              : 'unknown',
    refused,
    usage,
  };
}

function parseToolCalls(value: unknown): Extract<InferenceContent, { type: 'tool_call' }>[] {
  if (value === undefined) return [];
  if (!Array.isArray(value))
    throw new InferenceError('invalid_response', 'The inference provider returned invalid tool calls');
  return value.map((entry) => {
    const call = record(entry);
    const fn = record(call.function);
    if (typeof call.id !== 'string' || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
      throw new InferenceError('invalid_response', 'The inference provider returned an incomplete tool call');
    }
    try {
      return { type: 'tool_call', id: call.id, name: fn.name, input: JSON.parse(fn.arguments) };
    } catch {
      throw new InferenceError('invalid_response', 'The inference provider returned unparseable tool arguments');
    }
  });
}

function normalizeUsage(value: unknown): InferenceResponse['usage'] {
  const usage = value === undefined ? {} : record(value);
  const input = finiteNumber(usage.prompt_tokens);
  const output = finiteNumber(usage.completion_tokens);
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    serverToolRequests: {},
    cost:
      input === null || output === null
        ? { status: 'unknown', reason: 'usage_unavailable' }
        : { status: 'unknown', reason: 'unknown_model_price' },
  };
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  request: InferenceRequest,
  requestedModel: string,
  onEvent: (event: InferenceEvent) => void,
  signal?: AbortSignal,
): Promise<InferenceResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: Record<string, unknown> = { id: '', model: requestedModel };
  let text = '';
  let usage: unknown;
  let finishReason: unknown;
  let refusal = false;
  let doneMarker = false;
  let textStarted = false;
  const tools = new Map<number, { id: string; name: string; args: string; emitted: boolean }>();
  const flushLines = async (final = false) => {
    const lines = buffer.split(/\r?\n/);
    buffer = final ? '' : (lines.pop() ?? '');
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trimStart();
      if (!data) continue;
      if (data === '[DONE]') {
        doneMarker = true;
        continue;
      }
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        throw new InferenceError('invalid_response', 'The inference provider returned invalid stream data');
      }
      const chunk = record(event);
      if (typeof chunk.id === 'string') result.id = chunk.id;
      if (typeof chunk.model === 'string') result.model = chunk.model;
      if (chunk.usage !== undefined) usage = chunk.usage;
      const choice = record(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined);
      const delta = record(choice.delta);
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
      if (typeof delta.refusal === 'string') refusal = true;
      if (typeof delta.content === 'string' && delta.content) {
        if (!textStarted) {
          onEvent({ type: 'content_start', index: 0, kind: 'text' });
          textStarted = true;
        }
        text += delta.content;
        onEvent({ type: 'text_delta', index: 0, delta: delta.content, snapshot: text });
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const raw of delta.tool_calls) {
          const part = record(raw);
          const index = finiteNumber(part.index) ?? 0;
          const fn = record(part.function);
          let current = tools.get(index);
          if (!current) {
            current = { id: typeof part.id === 'string' ? part.id : '', name: '', args: '', emitted: false };
            tools.set(index, current);
          }
          if (typeof part.id === 'string') current.id = part.id;
          if (typeof fn.name === 'string') current.name += fn.name;
          if (!current.emitted) {
            onEvent({
              type: 'content_start',
              index: index + 1,
              kind: 'tool_call',
              ...(current.id ? { id: current.id } : {}),
              ...(current.name ? { name: current.name } : {}),
            });
            current.emitted = true;
          }
          if (typeof fn.arguments === 'string') {
            current.args += fn.arguments;
            onEvent({ type: 'tool_input_delta', index: index + 1, delta: fn.arguments, snapshot: current.args });
          }
        }
      }
    }
  };
  const abortRead = () => {
    void reader.cancel();
  };
  signal?.addEventListener('abort', abortRead, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw canceled();
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      await flushLines();
      if (doneMarker) {
        await reader.cancel();
        break;
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      buffer += '\n';
      await flushLines(true);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener('abort', abortRead);
    reader.releaseLock();
  }
  try {
    if (signal?.aborted) throw canceled();
    if (typeof finishReason !== 'string' && !refusal) {
      throw new InferenceError('invalid_response', 'The inference provider stream ended without a terminal event');
    }
    if (textStarted) onEvent({ type: 'content_stop', index: 0 });
    const calls: Extract<InferenceContent, { type: 'tool_call' }>[] = [];
    for (const [index, tool] of [...tools.entries()].sort(([a], [b]) => a - b)) {
      if (!tool.id || !tool.name)
        throw new InferenceError(
          'invalid_response',
          'The inference provider returned an incomplete streamed tool call',
        );
      let input: unknown;
      try {
        input = JSON.parse(tool.args || '{}');
      } catch {
        throw new InferenceError(
          'invalid_response',
          'The inference provider returned unparseable streamed tool arguments',
        );
      }
      calls.push({ type: 'tool_call', id: tool.id, name: tool.name, input });
      onEvent({ type: 'content_stop', index: index + 1 });
    }
    const content: InferenceContent[] = [];
    if (text) content.push({ type: 'text', text });
    content.push(...calls);
    const normalized = normalizeUsage(usage);
    const response: Record<string, unknown> = {
      id: result.id,
      model: result.model,
      usage,
      choices: [
        {
          message: {
            content: text || null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.input) },
            })),
            refusal: refusal ? 'refused' : null,
          },
          finish_reason: finishReason,
        },
      ],
    };
    // Route through the same response normalization used by complete(), including schema parsing and usage semantics.
    const decoded = decodeResponse(response, request, requestedModel);
    return { ...decoded, usage: normalized };
  } catch (error) {
    await body.cancel().catch(() => undefined);
    throw error;
  }
}

async function httpError(response: Response): Promise<InferenceError> {
  let message = '';
  try {
    const body = record(await response.clone().json());
    const nested = record(body.error);
    message =
      typeof nested.message === 'string' ? nested.message : typeof body.message === 'string' ? body.message : '';
  } catch {
    // HTTP status alone is sufficient to normalize the error.
  }
  const status = response.status;
  if (status === 401 || status === 403)
    return new InferenceError('auth', 'The inference provider rejected the configured credentials', false, status);
  if (status === 429)
    return new InferenceError('rate_limit', 'The inference provider is rate limiting requests', true, status);
  if (status === 413 || (status === 400 && /context|token limit|too many tokens|prompt is too long/i.test(message))) {
    return new InferenceError('context_limit', 'The request exceeds the model context limit', false, status);
  }
  if (status === 408 || status >= 500)
    return new InferenceError('transient', 'The inference provider failed temporarily', true, status);
  return new InferenceError('provider', 'The inference provider rejected the request', false, status);
}

function parseStructuredJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new InferenceError('invalid_response', 'The inference provider returned invalid structured output');
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function unsupported(message: string): never {
  throw new InferenceError('unsupported', message);
}

function canceled(): InferenceError {
  return new InferenceError('canceled', 'Inference was canceled');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
