// Anthropic transport for the transitional llm facade. Provider SDK details stay here.
import Anthropic from '@anthropic-ai/sdk';
import { DomainError } from '../../errors.ts';
import { InferenceError } from '../inference.ts';
import {
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamHandlers,
  modelFor,
  modelInfo,
  purposeEffort,
  toResponse,
} from '../llm.ts';
import { CompatibilityInferenceAdapter } from './compatibility.ts';

// ---- Anthropic client -----------------------------------------------------------------------------------------------

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export class AnthropicLlm implements LlmClient {
  readonly configured = true;
  private readonly client: Anthropic;

  constructor(
    options: AnthropicAdapterOptions,
    private readonly errorMapper: (error: unknown) => unknown = mapProviderError,
  ) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: options.maxRetries ?? 2,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    return this.stream(request, {});
  }

  async stream(request: LlmRequest, handlers: LlmStreamHandlers): Promise<LlmResponse> {
    const model = request.model ?? modelFor(request.purpose);
    const info = modelInfo(model);
    const effort =
      request.effort ?? (request.usePurposeEffortDefault === false ? undefined : purposeEffort(request.purpose));
    // Streamed requests with client tools stream tool inputs eagerly; the caller validates every parsed input.
    const tools = request.tools?.map((t) =>
      'input_schema' in t && (t.type === undefined || t.type === 'custom') ? { ...t, eager_input_streaming: true } : t,
    );
    const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
      model,
      max_tokens: request.maxTokens ?? 64_000,
      messages: request.messages,
      stream: true,
      ...(request.promptCaching === false ? {} : { cache_control: { type: 'ephemeral' as const } }),
      ...(request.system ? { system: request.system } : {}),
      ...(tools?.length ? { tools } : {}),
      ...(effort || request.outputSchema
        ? {
            output_config: {
              ...(effort ? { effort } : {}),
              ...(request.outputSchema
                ? { format: { type: 'json_schema' as const, schema: request.outputSchema } }
                : {}),
            },
          }
        : {}),
      ...(info?.fallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    };
    const snapshots = new Map<number, string>();
    try {
      const stream = this.client.beta.messages.stream(params, request.signal ? { signal: request.signal } : {});
      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block as { type: string; id?: string; name?: string };
            snapshots.set(event.index, '');
            handlers.onBlockStart?.(event.index, {
              type: block.type,
              ...(block.id ? { id: block.id } : {}),
              ...(block.name ? { name: block.name } : {}),
            });
            break;
          }
          case 'content_block_delta': {
            if (event.delta.type === 'text_delta') {
              const snapshot = (snapshots.get(event.index) ?? '') + event.delta.text;
              snapshots.set(event.index, snapshot);
              handlers.onTextDelta?.(event.index, event.delta.text, snapshot);
            } else if (event.delta.type === 'input_json_delta') {
              const snapshot = (snapshots.get(event.index) ?? '') + event.delta.partial_json;
              snapshots.set(event.index, snapshot);
              handlers.onToolInputDelta?.(event.index, event.delta.partial_json, snapshot);
            }
            break;
          }
          case 'content_block_stop':
            handlers.onBlockStop?.(event.index);
            break;
          default:
            break;
        }
      }
      const message = await stream.finalMessage();
      return toResponse(message, request, model);
    } catch (err) {
      throw this.errorMapper(err);
    }
  }
}

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseURL?: string;
  maxRetries?: number;
  /** Injectable HTTP transport for credential-free adapter conformance tests. */
  fetch?: typeof fetch;
}

/** Provider-neutral Anthropic entry point. Existing consumers may keep the llm facade during migration. */
export class AnthropicInferenceAdapter extends CompatibilityInferenceAdapter {
  readonly provider = 'anthropic';

  constructor(options: AnthropicAdapterOptions) {
    super(new AnthropicLlm(options, normalizeAnthropicError));
  }

  protected normalizeError(error: unknown): InferenceError {
    return normalizeAnthropicError(error);
  }
}

function normalizeAnthropicError(error: unknown): InferenceError {
  if (error instanceof InferenceError) return error;
  if (error instanceof Anthropic.APIUserAbortError) return new InferenceError('canceled', 'Inference was canceled');
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new InferenceError('auth', 'The inference provider rejected the configured key', false, error.status);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new InferenceError('rate_limit', 'The inference provider is rate limiting requests', true, error.status);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new InferenceError('transient', 'The inference provider could not be reached', true);
  }
  if (error instanceof Anthropic.APIError) {
    if (
      error.status === 413 ||
      (error.status === 400 && /context|prompt is too long|too many tokens/i.test(error.message))
    ) {
      return new InferenceError('context_limit', 'The request exceeds the model context limit', false, error.status);
    }
    const transient = error.status === 408 || (error.status !== undefined && error.status >= 500);
    return new InferenceError(
      transient ? 'transient' : 'provider',
      'The inference provider failed',
      transient,
      error.status,
    );
  }
  if (error instanceof SyntaxError)
    return new InferenceError('invalid_response', 'The model produced an unparseable tool call');
  return new InferenceError('provider', 'Inference failed');
}

function mapProviderError(err: unknown): unknown {
  if (err instanceof DomainError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new DomainError(503, 'AI_NOT_CONFIGURED', 'The AI provider rejected the configured key');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new DomainError(429, 'AI_PROVIDER_ERROR', 'The AI provider is rate limiting requests; try again shortly');
  }
  if (err instanceof Anthropic.APIError) {
    return new DomainError(502, 'AI_PROVIDER_ERROR', `The AI provider failed: ${err.message}`, {
      provider_status: err.status ?? null,
    });
  }
  if (err instanceof SyntaxError) {
    // Eager tool-input streaming: a tool input that is not parseable JSON at all.
    return new DomainError(502, 'AI_PROVIDER_ERROR', 'The model produced an unparseable tool call', {
      reason: 'invalid-tool-json',
    });
  }
  return err;
}
