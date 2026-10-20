/** Provider-neutral inference boundary. SDK objects belong exclusively to adapters. */
export type InferenceEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface InferenceCapabilities {
  text: boolean;
  vision: boolean;
  clientTools: boolean;
  serverTools: readonly string[];
  structuredOutput: 'none' | 'prompted' | 'native';
  streaming: boolean;
  reasoningEfforts: readonly InferenceEffort[];
  promptCaching: boolean;
}

export type InferenceContent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean }
  | { type: 'reasoning'; text: string | null };

export interface InferenceMessage {
  role: 'user' | 'assistant';
  content: string | InferenceContent[];
  /** Adapter-owned continuation, e.g. signed reasoning. Consumers must not inspect or edit it.
   * Replaying on another provider is rejected; portable content remains separately available. */
  continuation?: { provider: string; value: unknown };
}

export type InferenceTool =
  | { type: 'function'; name: string; description?: string; inputSchema: Record<string, unknown> }
  | { type: 'server'; name: string; maxUses?: number };

export interface InferenceRequest {
  purpose: string;
  model?: string;
  system?: string;
  messages: InferenceMessage[];
  tools?: InferenceTool[];
  maxTokens?: number;
  effort?: InferenceEffort;
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type InferenceCost =
  | { status: 'known'; microUsd: number }
  | { status: 'unknown'; reason: 'unknown_model_price' | 'usage_unavailable' };

export interface InferenceUsage {
  /** null means unavailable, never an invented zero. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  serverToolRequests: Readonly<Record<string, number | null>>;
  cost: InferenceCost;
}

export type InferenceStopReason = 'completed' | 'tool_calls' | 'max_tokens' | 'refusal' | 'paused' | 'unknown';

export interface InferenceResponse {
  id: string;
  provider: string;
  adapterVersion: string;
  model: string;
  message: InferenceMessage;
  text: string;
  json: unknown;
  toolCalls: Extract<InferenceContent, { type: 'tool_call' }>[];
  stopReason: InferenceStopReason;
  refused: boolean;
  usage: InferenceUsage;
  /** Quarantined diagnostics; never the portable content or domain state. */
  diagnostics?: { provider: string; value: unknown };
}

export type InferenceEvent =
  | {
      type: 'content_start';
      index: number;
      kind: 'text' | 'tool_call' | 'reasoning' | 'unknown';
      id?: string;
      name?: string;
    }
  | { type: 'text_delta'; index: number; delta: string; snapshot: string }
  | { type: 'tool_input_delta'; index: number; delta: string; snapshot: string }
  | { type: 'content_stop'; index: number };

export type InferenceErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'context_limit'
  | 'unsupported'
  | 'transient'
  | 'invalid_response'
  | 'canceled'
  | 'provider';

export class InferenceError extends Error {
  constructor(
    readonly code: InferenceErrorCode,
    message: string,
    readonly retryable = false,
    readonly providerStatus?: number,
  ) {
    super(message);
    this.name = 'InferenceError';
  }
}

export interface InferenceClient {
  readonly provider: string;
  readonly adapterVersion: string;
  readonly configured: boolean;
  capabilities(model?: string): InferenceCapabilities;
  complete(request: InferenceRequest): Promise<InferenceResponse>;
  stream(request: InferenceRequest, onEvent: (event: InferenceEvent) => void): Promise<InferenceResponse>;
}
