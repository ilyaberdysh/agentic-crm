import {
  InferenceError,
  type InferenceErrorCode,
  type InferenceResponse,
  type InferenceUsage,
} from '../ai/inference.ts';

const messages: Record<InferenceErrorCode, string> = {
  not_configured: 'The inference target is not configured',
  auth: 'The inference provider rejected the credentials',
  rate_limit: 'The inference provider is rate limiting requests',
  context_limit: 'The request exceeds the model context limit',
  unsupported: 'The inference request is unsupported',
  transient: 'The inference provider could not be reached',
  invalid_response: 'The inference provider returned an invalid response',
  canceled: 'Inference was canceled',
  provider: 'Inference failed',
};
export function safeInferenceError(error: unknown): InferenceError {
  if (!(error instanceof InferenceError) || !Object.hasOwn(messages, error.code))
    return new InferenceError('provider', messages.provider);
  const status =
    Number.isInteger(error.providerStatus) && Number(error.providerStatus) >= 100 && Number(error.providerStatus) <= 599
      ? error.providerStatus
      : undefined;
  return new InferenceError(error.code, messages[error.code], error.retryable === true, status);
}
export function safeFailureCode(code: unknown): InferenceErrorCode {
  return typeof code === 'string' && Object.hasOwn(messages, code) ? (code as InferenceErrorCode) : 'provider';
}
export const unavailableUsage = (): InferenceUsage => ({
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  serverToolRequests: {},
  cost: { status: 'unknown', reason: 'usage_unavailable' },
});
const token = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647 ? value : null;
/** Untrusted runner/provider usage can never turn absent tokens/cost into an invented zero. */
export function normalizeInvocationUsage(value: InferenceUsage | undefined): InferenceUsage {
  const result = unavailableUsage();
  if (!value || typeof value !== 'object') return result;
  result.inputTokens = token(value.inputTokens);
  result.outputTokens = token(value.outputTokens);
  result.cacheReadTokens = token(value.cacheReadTokens);
  result.cacheWriteTokens = token(value.cacheWriteTokens);
  if (value.cost?.status === 'known' && Number.isSafeInteger(value.cost.microUsd) && value.cost.microUsd >= 0)
    result.cost = { status: 'known', microUsd: value.cost.microUsd };
  else if (value.cost?.status === 'unknown' && value.cost.reason === 'unknown_model_price')
    result.cost = { status: 'unknown', reason: 'unknown_model_price' };
  return result;
}
/** Runs while the credential is in scope. Discard diagnostics and redact any upstream key reflection. */
export function sanitizeInferenceResponse(response: InferenceResponse, apiKey: string): InferenceResponse {
  const { diagnostics: _diagnostics, ...portable } = response;
  const redact = (value: unknown): unknown => {
    if (typeof value === 'string') return value.split(apiKey).join('[redacted]');
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key.split(apiKey).join('[redacted]'), redact(item)]),
      );
    return value;
  };
  const result = redact(portable) as InferenceResponse;
  result.usage = normalizeInvocationUsage(result.usage);
  return result;
}
