// The scripted scenarios of the e2e stack (`AGENTIC_CRM_LLM=fake`, src/ai/fixtures/e2e): fixture matching by tool results and
// the `{{result…}}` / `{{context…}}` placeholders, so a scripted answer can embed what a tool returned. No database.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlm, FakeLlm, type LlmRequest } from '../src/ai/llm.ts';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_M = '33333333-3333-4333-8333-333333333333';

const userText = (text: string): LlmRequest['messages'][number] => ({
  role: 'user',
  content: [{ type: 'text', text }],
});
const toolResult = (payload: unknown): LlmRequest['messages'][number] => ({
  role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 'toolu_fake_1', content: JSON.stringify(payload) }],
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fixture placeholders', () => {
  it('matches the first step and the continuation separately and fills tool results', async () => {
    const llm = new FakeLlm({
      fixtures: [
        {
          match: { purpose: 'ask', contains: '[x]', toolResults: true },
          reply: { text: 'Created {{result.task_id}}; second {{results.1.name}}' },
        },
        {
          match: { purpose: 'ask', contains: '[x]' },
          reply: { toolCalls: [{ name: 'create-task', input: { body: 'b' } }] },
        },
      ],
    });
    const question = userText('[x] do it');
    const first = await llm.complete({ purpose: 'ask', messages: [question] });
    expect(first.toolCalls).toHaveLength(1);
    const second = await llm.complete({
      purpose: 'ask',
      messages: [
        question,
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'a', content: JSON.stringify({ task_id: 'T1' }) },
            { type: 'tool_result', tool_use_id: 'b', content: JSON.stringify({ name: 'Second' }) },
          ],
        },
      ],
    });
    expect(second.text).toBe('Created T1; second Second');
  });

  it('fills ids of the prompt context into text and tool inputs', async () => {
    const llm = new FakeLlm({
      fixtures: [
        {
          match: { purpose: 'ask', contains: '[ctx]' },
          reply: {
            text: 'call {{context.call_recording_id}}',
            toolCalls: [
              {
                name: 'create-task',
                input: {
                  assignee_member_ids: ['{{context.member_id}}'],
                  linked_records: [
                    {
                      entity_definition_id: '{{context.entity_definition_id}}',
                      entity_instance_id: '{{context.entity_instance_id}}',
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    const res = await llm.complete({
      purpose: 'ask',
      system: [{ type: 'text', text: `You are assisting Ada (workspace member id ${UUID_M}).` }],
      // As the chat service builds it: one user message, a <context> block and the question.
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `<context>\nThe user is looking at: {"entity_definition_id":"${UUID_A}","entity_instance_id":"${UUID_B}"}\n` +
                `call_recording_id ${UUID_B}\n</context>`,
            },
            { type: 'text', text: '[ctx] hi' },
          ],
        },
      ],
    });
    expect(res.text).toBe(`call ${UUID_B}`);
    expect(res.toolCalls[0]?.input).toEqual({
      assignee_member_ids: [UUID_M],
      linked_records: [{ entity_definition_id: UUID_A, entity_instance_id: UUID_B }],
    });
  });
});

describe('AGENTIC_CRM_LLM=fake', () => {
  it('answers from the e2e scenarios, with titles and suggestions', async () => {
    vi.stubEnv('AGENTIC_CRM_LLM', 'fake');
    const llm = createLlm();
    expect(llm.configured).toBe(true);
    const plain = await llm.complete({ purpose: 'ask', messages: [userText('[e2e:plain] hello')] });
    expect(plain.text).toContain('**short** answer');
    const title = await llm.complete({
      purpose: 'ask-title',
      messages: [{ role: 'user', content: 'Question: [e2e:summary] summarize\n\nAnswer: x' }],
    });
    expect(title.text).toBe('Summary of Northwind Robotics');
    const first = await llm.complete({ purpose: 'ask', messages: [userText('[e2e:summary] go')] });
    expect(first.toolCalls.map((c) => c.name)).toEqual(['search-records', 'search-records']);
  });

  it('is unconfigured without the switch', () => {
    vi.stubEnv('AGENTIC_CRM_LLM', '');
    expect(createLlm().configured).toBe(false);
  });
});
