// Bridges the old SDK-shaped facade while consumers migrate to the inference contract.
// Provider payloads are only interpreted inside this adapter boundary.
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
import {
  type LlmClient,
  type LlmContentBlockParam,
  type LlmMessageParam,
  type LlmRequest,
  type LlmResponse,
  modelFor,
  modelInfo,
} from '../llm.ts';

const SUPPORTED: InferenceCapabilities = {
  text: true,
  vision: false,
  clientTools: true,
  serverTools: ['web_search'],
  structuredOutput: 'native',
  streaming: true,
  reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  promptCaching: true,
};

function unsupported(message: string): never {
  throw new InferenceError('unsupported', message);
}

function toMessage(message: InferenceMessage, provider: string): LlmMessageParam {
  if (message.continuation) {
    if (message.continuation.provider !== provider) unsupported('Continuation belongs to a different provider');
    // Only an adapter-issued continuation may carry opaque signed/provider-specific content.
    if (!Array.isArray(message.continuation.value)) unsupported('Invalid provider continuation');
    return { role: message.role, content: message.continuation.value as LlmContentBlockParam[] };
  }
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  const content: LlmContentBlockParam[] = message.content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_call':
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolCallId,
          content: block.content,
          ...(block.isError !== undefined ? { is_error: block.isError } : {}),
        };
      case 'reasoning':
        return unsupported('Reasoning requires the original provider continuation');
    }
  });
  return { role: message.role, content };
}

function toRequest(request: InferenceRequest, provider: string, capabilities: InferenceCapabilities): LlmRequest {
  if (request.effort && !capabilities.reasoningEfforts.includes(request.effort)) {
    unsupported(`Reasoning effort ${request.effort} is unsupported by this model`);
  }
  if (request.outputSchema && capabilities.structuredOutput !== 'native') {
    unsupported('Native structured output is unsupported by this model');
  }
  const tools = request.tools?.map((tool) => {
    if (tool.type === 'function') {
      if (!capabilities.clientTools) unsupported('Client tools are unsupported by this model');
      return {
        name: tool.name,
        ...(tool.description !== undefined ? { description: tool.description } : {}),
        input_schema: tool.inputSchema as { type: 'object'; [key: string]: unknown },
      };
    }
    if (!capabilities.serverTools.includes(tool.name)) unsupported(`Server tool ${tool.name} is unsupported`);
    return {
      type: 'web_search_20260209' as const,
      name: 'web_search' as const,
      ...(tool.maxUses !== undefined ? { max_uses: tool.maxUses } : {}),
    };
  });
  return {
    purpose: request.purpose,
    messages: request.messages.map((message) => toMessage(message, provider)),
    ...(request.model !== undefined ? { model: request.model } : {}),
    ...(request.system !== undefined ? { system: request.system } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.effort !== undefined ? { effort: request.effort } : {}),
    usePurposeEffortDefault: capabilities.reasoningEfforts.length > 0,
    promptCaching: capabilities.promptCaching,
    ...(request.outputSchema !== undefined ? { outputSchema: request.outputSchema } : {}),
    ...(request.signal !== undefined ? { signal: request.signal } : {}),
  };
}

function toResponse(response: LlmResponse, provider: string, adapterVersion: string): InferenceResponse {
  const content: InferenceContent[] = response.message.content.flatMap((block): InferenceContent[] => {
    switch (block.type) {
      case 'text':
        return [{ type: 'text', text: block.text }];
      case 'tool_use':
        return [{ type: 'tool_call', id: block.id, name: block.name, input: block.input }];
      case 'thinking':
        return [{ type: 'reasoning', text: block.thinking }];
      case 'redacted_thinking':
        return [{ type: 'reasoning', text: null }];
      default:
        return [];
    }
  });
  const stop = response.stopReason;
  const rawUsage = response.message.usage;
  return {
    id: response.message.id,
    provider,
    adapterVersion,
    model: response.usage.model,
    message: {
      role: 'assistant',
      content,
      continuation: { provider, value: response.message.content },
    },
    text: response.text,
    json: response.json,
    toolCalls: content.filter(
      (block): block is Extract<InferenceContent, { type: 'tool_call' }> => block.type === 'tool_call',
    ),
    stopReason:
      stop === 'end_turn' || stop === 'stop_sequence'
        ? 'completed'
        : stop === 'tool_use'
          ? 'tool_calls'
          : stop === 'max_tokens' || stop === 'refusal'
            ? stop
            : stop === 'pause_turn'
              ? 'paused'
              : 'unknown',
    refused: response.refused,
    usage: {
      inputTokens: rawUsage.input_tokens ?? null,
      outputTokens: rawUsage.output_tokens ?? null,
      cacheReadTokens: rawUsage.cache_read_input_tokens ?? null,
      cacheWriteTokens: rawUsage.cache_creation_input_tokens ?? null,
      serverToolRequests: { web_search: rawUsage.server_tool_use?.web_search_requests ?? null },
      cost:
        response.usage.microUsd === null
          ? { status: 'unknown', reason: 'unknown_model_price' }
          : rawUsage.input_tokens == null || rawUsage.output_tokens == null
            ? { status: 'unknown', reason: 'usage_unavailable' }
            : { status: 'known', microUsd: response.usage.microUsd },
    },
  };
}

/** Shared transitional bridge, not a provider selector or a routing service. */
export abstract class CompatibilityInferenceAdapter implements InferenceClient {
  abstract readonly provider: string;
  readonly adapterVersion = '1';

  constructor(protected readonly transport: LlmClient) {}

  get configured(): boolean {
    return this.transport.configured;
  }

  capabilities(model?: string): InferenceCapabilities {
    if (!model || modelInfo(model)) return structuredClone(SUPPORTED);
    // Unknown model ids can still do text inference, but capabilities must not be guessed.
    return {
      text: true,
      vision: false,
      clientTools: false,
      serverTools: [],
      structuredOutput: 'none',
      streaming: true,
      reasoningEfforts: [],
      promptCaching: false,
    };
  }

  complete(request: InferenceRequest): Promise<InferenceResponse> {
    return this.stream(request, () => {});
  }

  async stream(request: InferenceRequest, onEvent: (event: InferenceEvent) => void): Promise<InferenceResponse> {
    if (request.signal?.aborted) throw new InferenceError('canceled', 'Inference was canceled');
    const legacy = toRequest(request, this.provider, this.capabilities(request.model ?? modelFor(request.purpose)));
    try {
      const response = await this.transport.stream(legacy, {
        onBlockStart: (index, block) =>
          onEvent({
            type: 'content_start',
            index,
            kind:
              block.type === 'text'
                ? 'text'
                : block.type === 'tool_use'
                  ? 'tool_call'
                  : block.type === 'thinking' || block.type === 'redacted_thinking'
                    ? 'reasoning'
                    : 'unknown',
            ...(block.id !== undefined ? { id: block.id } : {}),
            ...(block.name !== undefined ? { name: block.name } : {}),
          }),
        onTextDelta: (index, delta, snapshot) => onEvent({ type: 'text_delta', index, delta, snapshot }),
        onToolInputDelta: (index, delta, snapshot) => onEvent({ type: 'tool_input_delta', index, delta, snapshot }),
        onBlockStop: (index) => onEvent({ type: 'content_stop', index }),
      });
      if (request.signal?.aborted) throw new InferenceError('canceled', 'Inference was canceled');
      return toResponse(response, this.provider, this.adapterVersion);
    } catch (error) {
      if (request.signal?.aborted) throw new InferenceError('canceled', 'Inference was canceled');
      throw this.normalizeError(error);
    }
  }

  protected abstract normalizeError(error: unknown): InferenceError;
}
