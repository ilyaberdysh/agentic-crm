// The llm module (slice 10): model selection, usage → credits, and the deterministic fake (rules, fixtures, schema
// samples, streaming deltas). No database or network.
import { describe, expect, it } from 'vitest';
import {
  costMicroUsd,
  createLlm,
  creditsFor,
  FakeLlm,
  lastToolResults,
  modelFor,
  promptHash,
  sampleFromSchema,
} from '../src/ai/llm.ts';

describe('llm module', () => {
  it('picks models per purpose with workspace overrides', () => {
    expect(modelFor('ask')).toBe('claude-opus-5-5');
    expect(modelFor('ai-attribute')).toBe('claude-sonnet-5-5');
    expect(modelFor('ask-title')).toBe('claude-haiku-5-5');
    expect(modelFor('ask', { ask: 'claude-sonnet-5-5' })).toBe('claude-sonnet-5-5');
    expect(modelFor('ask', { ask: 'gpt-unknown' })).toBe('claude-opus-5-5');
  });

  it('prices usage and rounds credits up', () => {
    const micro = costMicroUsd({
      model: 'claude-opus-5-5',
      inputTokens: 10_000,
      outputTokens: 1_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      webSearchRequests: 1,
    });
    // 10k × $4/M + 1k × $20/M = $0.06, + one search $0.01
    expect(micro).toBe(70_000);
    expect(creditsFor(micro)).toBe(7);
    expect(creditsFor(1)).toBe(1);
    expect(creditsFor(0)).toBe(0);
  });

  it('is unconfigured without a key', async () => {
    const llm = createLlm({ apiKey: '' });
    expect(llm.configured).toBe(false);
    await expect(llm.complete({ purpose: 'ask', messages: [] })).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
  });

  it('answers from rules, fixtures and generated replies; streams deltas', async () => {
    const fake = new FakeLlm();
    fake.when(
      (r) => r.purpose === 'ask' && lastToolResults(r).length === 0,
      { text: 'Looking up', toolCalls: [{ name: 'search_records', input: { query: 'Acme' } }] },
      { times: 1 },
    );
    const deltas: string[] = [];
    const toolJson: string[] = [];
    const first = await fake.stream(
      { purpose: 'ask', messages: [{ role: 'user', content: 'find acme' }] },
      { onTextDelta: (_i, d) => deltas.push(d), onToolInputDelta: (_i, _d, snap) => toolJson.push(snap) },
    );
    expect(first.stopReason).toBe('tool_use');
    expect(first.toolCalls[0]).toMatchObject({ name: 'search_records', input: { query: 'Acme' } });
    expect(deltas.join('')).toBe('Looking up');
    expect(JSON.parse(toolJson.at(-1) as string)).toEqual({ query: 'Acme' });
    expect(first.usage.microUsd).toBeGreaterThan(0);

    const fixture = await fake.complete({ purpose: 'fake-smoke', messages: [{ role: 'user', content: 'ping?' }] });
    expect(fixture.text).toBe('pong');

    const generated = await fake.complete({ purpose: 'record-summary', messages: [{ role: 'user', content: 'hi' }] });
    expect(generated.text).toBe('[fake:record-summary] hi');

    const schema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', enum: ['Hot', 'Cold'] }, minItems: 1 } },
      required: ['tags'],
      additionalProperties: false,
    };
    const structured = await fake.complete({
      purpose: 'workflow-classify',
      messages: [{ role: 'user', content: 'x' }],
      outputSchema: schema,
    });
    expect(structured.json).toEqual({ tags: ['Hot'] });
    expect(sampleFromSchema({ type: 'integer', minimum: 3 })).toBe(3);
    expect(fake.calls).toHaveLength(4);
  });

  it('hashes prompts stably', () => {
    const a = promptHash({ purpose: 'ask', messages: [{ role: 'user', content: 'x' }] });
    const b = promptHash({ purpose: 'ask', messages: [{ role: 'user', content: 'x' }] });
    const c = promptHash({ purpose: 'ask', messages: [{ role: 'user', content: 'y' }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
