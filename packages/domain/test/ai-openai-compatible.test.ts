import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  type OpenAICompatibleFeatures,
  OpenAICompatibleInferenceAdapter,
} from '../src/ai/adapters/openai-compatible.ts';
import type { InferenceEvent, InferenceRequest } from '../src/ai/inference.ts';

const fixtures = fileURLToPath(new URL('../src/ai/fixtures/openai-compatible/', import.meta.url));
const features: OpenAICompatibleFeatures = {
  text: true,
  clientTools: true,
  structuredOutput: 'native',
  streaming: true,
};

function adapter(fetch: typeof globalThis.fetch, configuredFeatures = features) {
  return new OpenAICompatibleInferenceAdapter({
    baseURL: 'http://local.test/v1',
    apiKey: 'fixture-key',
    defaultModel: 'fixture-model',
    features: configuredFeatures,
    fetch,
  });
}

function sse(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

describe('OpenAI-compatible inference adapter', () => {
  it('maps a text completion and preserves configured model, system, and usage', async () => {
    const fixture = JSON.parse(await readFile(`${fixtures}/completion.json`, 'utf8')) as Record<string, unknown>;
    let url = '';
    let init: RequestInit | undefined;
    const http = vi.fn<typeof fetch>(async (input, options) => {
      url = String(input);
      init = options;
      return Response.json(fixture);
    });
    const response = await adapter(http).complete({
      purpose: 'test',
      system: 'Be concise',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 40,
    });
    expect(url).toBe('http://local.test/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'fixture-model',
      stream: false,
      max_tokens: 40,
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hi' },
      ],
    });
    expect(response).toMatchObject({
      provider: 'openai-compatible',
      model: 'fixture-model',
      text: 'Hello from a local fixture.',
      stopReason: 'completed',
      usage: {
        inputTokens: 8,
        outputTokens: 6,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cost: { status: 'unknown', reason: 'unknown_model_price' },
      },
    });
  });

  it('streams text deltas from a credential-free SSE fixture', async () => {
    const fixture = await readFile(`${fixtures}/stream.sse`, 'utf8');
    const http = vi.fn<typeof fetch>(async () => sse(fixture));
    const events: InferenceEvent[] = [];
    const response = await adapter(http).stream(
      { purpose: 'test', messages: [{ role: 'user', content: 'Hi' }] },
      (event) => {
        events.push(event);
      },
    );
    expect(JSON.parse(String(http.mock.calls[0]?.[1]?.body))).toMatchObject({ stream: true });
    expect(
      events
        .filter((event) => event.type === 'text_delta')
        .map((event) => event.delta)
        .join(''),
    ).toBe('Hello stream.');
    expect(response).toMatchObject({
      text: 'Hello stream.',
      stopReason: 'completed',
      usage: { inputTokens: 8, outputTokens: 4 },
    });
  });

  it('maps client tools and native structured output without leaking wire types', async () => {
    const request: InferenceRequest = {
      purpose: 'test',
      messages: [
        { role: 'assistant', content: [{ type: 'tool_call', id: 'call_1', name: 'lookup', input: { q: 'acme' } }] },
        { role: 'user', content: [{ type: 'tool_result', toolCallId: 'call_1', content: 'found' }] },
      ],
      tools: [{ type: 'function', name: 'lookup', description: 'Find a record', inputSchema: { type: 'object' } }],
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    };
    const http = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'response', strict: true, schema: request.outputSchema },
        },
        messages: [
          {
            role: 'assistant',
            tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{"q":"acme"}' } }],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'found' },
        ],
      });
      return Response.json({
        id: 'chatcmpl-structured',
        model: 'fixture-model',
        choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      });
    });
    const response = await adapter(http).complete(request);
    expect(response.json).toEqual({ ok: true });
  });

  it('streams client tool calls and parses the complete input', async () => {
    const chunks = [
      'data: {"id":"tool-stream","model":"fixture-model","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_2","type":"function","function":{"name":"lookup","arguments":"{\\\"q\\\":"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"tool-stream","model":"fixture-model","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\\"acme\\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"id":"tool-stream","model":"fixture-model","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const http = vi.fn<typeof fetch>(async () => sse(chunks.join('')));
    const events: InferenceEvent[] = [];
    const response = await adapter(http).stream(
      {
        purpose: 'test',
        messages: [{ role: 'user', content: 'Look up Acme' }],
        tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
      },
      (event) => events.push(event),
    );
    expect(response.toolCalls).toEqual([{ type: 'tool_call', id: 'call_2', name: 'lookup', input: { q: 'acme' } }]);
    expect(response.stopReason).toBe('tool_calls');
    expect(events.some((event) => event.type === 'tool_input_delta')).toBe(true);
  });

  it('reports an explicitly truncated tool response as max tokens', async () => {
    const response = await adapter(
      vi.fn<typeof fetch>(async () =>
        Response.json({
          id: 'truncated-tool',
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"q":"acme"}' } },
                ],
              },
              finish_reason: 'length',
            },
          ],
        }),
      ),
    ).complete({ purpose: 'test', messages: [] });
    expect(response).toMatchObject({ stopReason: 'max_tokens' });
  });

  it('keeps missing and partial usage unknown', async () => {
    const http = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: 'missing-usage',
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { completion_tokens: 1 },
      }),
    );
    const response = await adapter(http).complete({ purpose: 'test', messages: [] });
    expect(response.usage).toMatchObject({
      inputTokens: null,
      outputTokens: 1,
      cost: { status: 'unknown', reason: 'usage_unavailable' },
    });
  });

  it('normalizes HTTP auth, rate-limit, context, server, and network failures', async () => {
    for (const [status, code, retryable] of [
      [401, 'auth', false],
      [403, 'auth', false],
      [429, 'rate_limit', true],
      [400, 'context_limit', false],
      [503, 'transient', true],
    ] as const) {
      const http = vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { message: status === 400 ? 'context length exceeded' : 'provider failure' } },
          { status },
        ),
      );
      await expect(adapter(http).complete({ purpose: 'test', messages: [] })).rejects.toMatchObject({
        code,
        retryable,
        providerStatus: status,
      });
    }
    const network = adapter(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('network down');
      }),
    );
    await expect(network.complete({ purpose: 'test', messages: [] })).rejects.toMatchObject({
      code: 'transient',
      retryable: true,
    });
  });

  it('rejects unsupported features before network access and advertises configured capabilities only', async () => {
    const http = vi.fn<typeof fetch>();
    const limited = adapter(http, { text: true, clientTools: false, structuredOutput: 'none', streaming: false });
    expect(limited.capabilities()).toEqual({
      text: true,
      vision: false,
      clientTools: false,
      serverTools: [],
      structuredOutput: 'none',
      streaming: false,
      reasoningEfforts: [],
      promptCaching: false,
    });
    const requests: InferenceRequest[] = [
      { purpose: 'test', messages: [], tools: [{ type: 'function', name: 'lookup', inputSchema: {} }] },
      { purpose: 'test', messages: [], tools: [{ type: 'server', name: 'search' }] },
      { purpose: 'test', messages: [], outputSchema: { type: 'object' } },
      { purpose: 'test', messages: [], effort: 'high' },
    ];
    for (const request of requests)
      await expect(limited.complete(request)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(limited.stream({ purpose: 'test', messages: [] }, () => {})).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(http).not.toHaveBeenCalled();
  });

  it('normalizes cancellation before send and during a stream', async () => {
    const preAborted = AbortSignal.abort();
    const http = vi.fn<typeof fetch>();
    await expect(adapter(http).complete({ purpose: 'test', messages: [], signal: preAborted })).rejects.toMatchObject({
      code: 'canceled',
    });
    const controller = new AbortController();
    let cancel!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start() {
        cancel = () => controller.abort();
      },
      pull() {
        return new Promise<void>(() => {});
      },
      cancel() {},
    });
    const streaming = adapter(vi.fn<typeof fetch>(async () => new Response(body)));
    const running = streaming.stream({ purpose: 'test', messages: [], signal: controller.signal }, () => {});
    cancel();
    await expect(running).rejects.toMatchObject({ code: 'canceled' });
  });

  it('handles structured-output refusals consistently in complete and stream modes', async () => {
    const request: InferenceRequest = {
      purpose: 'test',
      messages: [],
      outputSchema: { type: 'object' },
    };
    const completed = adapter(
      vi.fn<typeof fetch>(async () =>
        Response.json({
          id: 'refused',
          choices: [{ message: { content: '', refusal: 'no' }, finish_reason: 'content_filter' }],
        }),
      ),
    );
    await expect(completed.complete(request)).resolves.toMatchObject({
      refused: true,
      stopReason: 'refusal',
      json: null,
    });
    const streamed = adapter(
      vi.fn<typeof fetch>(async () =>
        sse(
          'data: {"id":"refused","choices":[{"delta":{"refusal":"no"},"finish_reason":"content_filter"}]}\n\n' +
            'data: [DONE]\n\n',
        ),
      ),
    );
    await expect(streamed.stream(request, () => {})).resolves.toMatchObject({
      refused: true,
      stopReason: 'refusal',
      json: null,
    });
  });

  it('stops at DONE even when the HTTP body stays open and rejects an unterminated stream', async () => {
    const openBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"id":"done","choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
              'data: [DONE]\n\n',
          ),
        );
      },
    });
    await expect(
      adapter(vi.fn<typeof fetch>(async () => new Response(openBody))).stream(
        { purpose: 'test', messages: [] },
        () => {},
      ),
    ).resolves.toMatchObject({ text: 'ok', stopReason: 'completed' });

    await expect(
      adapter(
        vi.fn<typeof fetch>(async () =>
          sse('data: {"id":"partial","choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n'),
        ),
      ).stream({ purpose: 'test', messages: [] }, () => {}),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('cancels the upstream stream when decoding fails', async () => {
    let canceledUpstream = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {not-json}\n\n'));
      },
      cancel() {
        canceledUpstream = true;
      },
    });

    await expect(
      adapter(vi.fn<typeof fetch>(async () => new Response(body))).stream({ purpose: 'test', messages: [] }, () => {}),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(canceledUpstream).toBe(true);
  });

  it('normalizes cancellation while decoding a non-streaming response body', async () => {
    const controller = new AbortController();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(streamController) {
          bodyController = streamController;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
    const running = adapter(
      vi.fn<typeof fetch>(async (_input, init) => {
        init?.signal?.addEventListener('abort', () => bodyController.error(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
        return response;
      }),
    ).complete({
      purpose: 'test',
      messages: [],
      signal: controller.signal,
    });
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'canceled' });
  });
});
