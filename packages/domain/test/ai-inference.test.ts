import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicInferenceAdapter, AnthropicLlm } from '../src/ai/adapters/anthropic.ts';
import { FakeInferenceAdapter } from '../src/ai/adapters/fake.ts';
import { type InferenceEvent, type InferenceRequest } from '../src/ai/inference.ts';
import {
  addUsage,
  costMicroUsd,
  creditsFor,
  FakeLlm,
  type LlmMessage,
  type LlmRequest,
  ZERO_USAGE,
} from '../src/ai/llm.ts';
import { DomainError } from '../src/errors.ts';

const E2E_FIXTURES = fileURLToPath(new URL('../src/ai/fixtures/e2e/', import.meta.url));

/** Replay a fixture message through the real SDK stream parser without HTTP or credentials. */
function sse(message: LlmMessage): Response {
  const events: Record<string, unknown>[] = [
    {
      type: 'message_start',
      message: { ...message, content: [], stop_reason: null, usage: { ...message.usage, output_tokens: 0 } },
    },
  ];
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(
        { type: 'content_block_start', index, content_block: { ...block, text: '' } },
        { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
      );
    } else if (block.type === 'tool_use') {
      events.push(
        { type: 'content_block_start', index, content_block: { ...block, input: {} } },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) },
        },
      );
    } else {
      events.push({ type: 'content_block_start', index, content_block: block });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push(
    { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: message.usage },
    { type: 'message_stop' },
  );
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('provider-neutral inference', () => {
  const cases: { label: string; request: InferenceRequest }[] = [
    {
      label: 'existing smoke fixture',
      request: { purpose: 'fake-smoke', messages: [{ role: 'user', content: 'ping?' }] },
    },
    {
      label: 'existing Ask tool fixture',
      request: { purpose: 'ask', messages: [{ role: 'user', content: '[e2e:summary]' }] },
    },
    {
      label: 'existing structured formula fixture',
      request: {
        purpose: 'formula',
        messages: [{ role: 'user', content: 'Task: write a formula that does this: Add one and two' }],
        outputSchema: { type: 'object', properties: { formula: { type: 'string' } } },
      },
    },
  ];

  it.each(cases)('preserves facade/Fake/Anthropic behavior for $label', async ({ request }) => {
    const fake = new FakeLlm({ fixturesDir: request.purpose === 'fake-smoke' ? undefined : E2E_FIXTURES });
    const legacy = await fake.complete(request as LlmRequest);
    const portableFake = await new FakeInferenceAdapter(
      new FakeLlm({ fixturesDir: request.purpose === 'fake-smoke' ? undefined : E2E_FIXTURES }),
    ).complete(request);
    const http = vi.fn<typeof fetch>(async () => sse(legacy.message));
    const anthropic = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: http, maxRetries: 0 });
    const events: InferenceEvent[] = [];
    const portable = await anthropic.stream(request, (event) => events.push(event));
    expect(portable.text).toBe(legacy.text);
    expect(portable.json).toEqual(legacy.json);
    expect(portable.toolCalls).toEqual(portableFake.toolCalls);
    expect(portable.stopReason).toBe(portableFake.stopReason);
    expect(portable.usage).toEqual(portableFake.usage);
    expect(portable.usage.cost).toEqual({ status: 'known', microUsd: legacy.usage.microUsd });
    expect(
      events
        .filter((event) => event.type === 'text_delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe(legacy.text);
    for (const call of portable.toolCalls) {
      const start = events.find((event) => event.type === 'content_start' && event.id === call.id);
      expect(start).toMatchObject({ kind: 'tool_call', name: call.name });
      const delta = events.find((event) => event.type === 'tool_input_delta' && event.index === start?.index);
      expect(delta).toMatchObject({ snapshot: JSON.stringify(call.input) });
    }
    const facade = await new AnthropicLlm({ apiKey: 'test-key', fetch: http, maxRetries: 0 }).complete(
      request as LlmRequest,
    );
    expect(facade.text).toBe(legacy.text);
    expect(facade.message.content).toEqual(legacy.message.content);
    expect(facade.usage).toEqual(legacy.usage);
  });

  it('preserves request caching, tools, effort, fallback and structured output at the transport seam', async () => {
    const reply = await new FakeLlm().complete({ purpose: 'ask', messages: [] });
    let sent: Record<string, unknown> = {};
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return sse(reply.message);
    });
    await new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: http }).complete({
      purpose: 'ask',
      system: 'Stable instructions',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_call', id: 'call_1', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolCallId: 'call_1', content: 'found', isError: false }] },
      ],
      tools: [
        { type: 'function', name: 'lookup', inputSchema: { type: 'object' } },
        { type: 'server', name: 'web_search', maxUses: 2 },
      ],
      effort: 'high',
      outputSchema: { type: 'object' },
      maxTokens: 1234,
    });
    expect(sent).toMatchObject({
      model: 'claude-opus-5-5',
      stream: true,
      max_tokens: 1234,
      cache_control: { type: 'ephemeral' },
      system: 'Stable instructions',
      fallbacks: 'default',
      tools: [
        { name: 'lookup', eager_input_streaming: true },
        { type: 'web_search_20260209', name: 'web_search', max_uses: 2 },
      ],
      output_config: { effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } },
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'found', is_error: false }] },
      ],
    });
  });

  it('retains signed reasoning and opaque content for same-provider tool continuations', async () => {
    const legacy = await new FakeLlm().when(() => true, { text: 'Answer' }).complete({ purpose: 'ask', messages: [] });
    legacy.message.content.unshift({ type: 'thinking', thinking: 'Reason', signature: 'signed' });
    const http = vi.fn<typeof fetch>(async () => sse(legacy.message));
    const adapter = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: http });
    const response = await adapter.complete({ purpose: 'ask', messages: [] });
    expect(response.message.content).toContainEqual({ type: 'reasoning', text: 'Reason' });
    await adapter.complete({ purpose: 'ask', messages: [response.message] });
    const body = JSON.parse(String(http.mock.calls[1]?.[1]?.body));
    expect(body.messages[0].content).toEqual(legacy.message.content);
    await expect(
      new FakeInferenceAdapter().complete({ purpose: 'ask', messages: [response.message] }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('reports unknown model cost and refuses to invent billable credits', async () => {
    const request: InferenceRequest = { purpose: 'custom', model: 'unknown-model', messages: [] };
    const fake = new FakeInferenceAdapter();
    const result = await fake.complete(request);
    expect(result.usage.cost).toEqual({ status: 'unknown', reason: 'unknown_model_price' });
    const legacy = await fake.fake.complete(request as LlmRequest);
    expect(costMicroUsd({ ...legacy.usage })).toBeNull();
    expect(legacy.usage.microUsd).toBeNull();
    expect(addUsage(ZERO_USAGE, legacy.usage).microUsd).toBeNull();
    expect(() => creditsFor(legacy.usage.microUsd)).toThrow('model price is unknown');
    const anthropic = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: async () => sse(legacy.message) });
    expect((await anthropic.complete(request)).usage.cost).toEqual(result.usage.cost);
  });

  it('does not enable unverified defaults for an unknown model', async () => {
    const reply = await new FakeLlm().complete({ purpose: 'ask', model: 'unknown-model', messages: [] });
    let sent: Record<string, unknown> = {};
    const adapter = new AnthropicInferenceAdapter({
      apiKey: 'test-key',
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return sse(reply.message);
      },
    });
    await adapter.complete({ purpose: 'ask', model: 'unknown-model', messages: [] });
    expect(sent).not.toHaveProperty('cache_control');
    expect(sent).not.toHaveProperty('output_config');
  });

  it('fails unsupported capabilities before sending a provider request', async () => {
    const http = vi.fn<typeof fetch>();
    const adapter = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: http });
    expect(adapter.capabilities().clientTools).toBe(true);
    expect(adapter.capabilities('unknown-model').structuredOutput).toBe('none');
    for (const request of [
      { purpose: 'ask', messages: [], tools: [{ type: 'server', name: 'unavailable' }] },
      { purpose: 'ask', model: 'unknown-model', messages: [], outputSchema: { type: 'object' } },
      { purpose: 'ask', model: 'unknown-model', messages: [], effort: 'high' },
    ] satisfies InferenceRequest[]) {
      await expect(adapter.complete(request)).rejects.toMatchObject({ code: 'unsupported', retryable: false });
    }
    expect(http).not.toHaveBeenCalled();
  });

  it('leaves missing token telemetry unknown instead of reporting a free request', async () => {
    const reply = await new FakeLlm().complete({ purpose: 'ask', messages: [] });
    const usage = reply.message.usage as unknown as Record<string, unknown>;
    delete usage.input_tokens;
    const adapter = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: async () => sse(reply.message) });
    const response = await adapter.complete({ purpose: 'ask', messages: [] });
    expect(response.usage.inputTokens).toBeNull();
    expect(response.usage.cost).toEqual({ status: 'unknown', reason: 'usage_unavailable' });
  });

  it.each([
    { status: 401, code: 'auth', retryable: false, message: 'bad key' },
    { status: 403, code: 'auth', retryable: false, message: 'denied' },
    { status: 429, code: 'rate_limit', retryable: true, message: 'slow down' },
    { status: 400, code: 'context_limit', retryable: false, message: 'prompt is too long' },
    { status: 529, code: 'transient', retryable: true, message: 'overloaded' },
    { status: 400, code: 'provider', retryable: false, message: 'invalid request' },
  ])('normalizes provider errors: $status/$code', async ({ status, code, retryable, message }) => {
    const options = {
      apiKey: 'test-key',
      maxRetries: 0,
      fetch: async () =>
        new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    };
    const adapter = new AnthropicInferenceAdapter(options);
    await expect(adapter.complete({ purpose: 'ask', messages: [] })).rejects.toMatchObject({
      code,
      retryable,
      providerStatus: status,
    });
    await expect(new AnthropicLlm(options).complete({ purpose: 'ask', messages: [] })).rejects.toMatchObject({
      statusCode: status === 401 || status === 403 ? 503 : status === 429 ? 429 : 502,
      code: status === 401 || status === 403 ? 'AI_NOT_CONFIGURED' : 'AI_PROVIDER_ERROR',
    });
  });

  it('honors cancellation during a streamed reply', async () => {
    const controller = new AbortController();
    const fake = new FakeInferenceAdapter(
      new FakeLlm().when(() => true, { text: 'More than twelve characters of text' }),
    );
    const events: InferenceEvent[] = [];
    await expect(
      fake.stream({ purpose: 'ask', messages: [], signal: controller.signal }, (event) => {
        events.push(event);
        if (event.type === 'text_delta') controller.abort();
      }),
    ).rejects.toMatchObject({ code: 'canceled' });
    expect(events.filter((event) => event.type === 'text_delta')).toHaveLength(1);
  });

  it.each([
    {
      label: 'the final text delta',
      reply: { text: 'ok' },
      abortOn: 'text_delta' as const,
    },
    {
      label: 'a tool input delta',
      reply: { toolCalls: [{ name: 'lookup', input: { query: 'account' } }] },
      abortOn: 'tool_input_delta' as const,
    },
  ])('does not report success when cancellation arrives on $label', async ({ reply, abortOn }) => {
    const controller = new AbortController();
    const adapter = new FakeInferenceAdapter(new FakeLlm().when(() => true, reply));
    await expect(
      adapter.stream({ purpose: 'ask', messages: [], signal: controller.signal }, (event) => {
        if (event.type === abortOn) controller.abort();
      }),
    ).rejects.toMatchObject({ code: 'canceled' });
  });

  it('normalizes scripted Fake failures without changing the legacy fake', async () => {
    const failure = new DomainError(429, 'AI_PROVIDER_ERROR', 'Rate limited');
    const fake = new FakeLlm().when(() => true, { error: failure });
    const request = { purpose: 'ask', messages: [] };
    await expect(fake.complete(request)).rejects.toBe(failure);
    await expect(new FakeInferenceAdapter(fake).complete(request)).rejects.toMatchObject({
      code: 'rate_limit',
      retryable: true,
      providerStatus: 429,
    });
  });

  it('keeps refusal as a terminal response and normalizes cancellation for both adapters', async () => {
    const fake = new FakeLlm().when(() => true, { text: 'Declined', stopReason: 'refusal' });
    const request: InferenceRequest = { purpose: 'ask', messages: [], outputSchema: { type: 'object' } };
    const legacy = await fake.complete(request as LlmRequest);
    const anthropic = new AnthropicInferenceAdapter({ apiKey: 'test-key', fetch: async () => sse(legacy.message) });
    for (const adapter of [anthropic, new FakeInferenceAdapter(fake)]) {
      expect(await adapter.complete(request)).toMatchObject({ stopReason: 'refusal', refused: true, json: null });
      await expect(adapter.complete({ ...request, signal: AbortSignal.abort() })).rejects.toMatchObject({
        code: 'canceled',
        retryable: false,
      });
    }
  });
});
