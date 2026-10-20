import type { AiAssistantPart, AiToolPart, AiTurn } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { answerText, displayTurn } from './display';
import { toolRow, toolsUsedLabel } from './toolRows';

const tool = (over: Partial<AiToolPart>): AiToolPart => ({
  id: `p-${over.toolCallId ?? 'x'}`,
  type: 'tool',
  status: 'completed',
  toolCallId: 'tc1',
  tool: 'search-records',
  input: { query: 'Acme' },
  inputRaw: '{"query":"Acme"}',
  inputAmendment: null,
  toolStatus: 'completed',
  requiresApproval: false,
  outputDigest: { count: 2, records: [{ entityDefinitionId: 'd', entityInstanceId: 'r' }] },
  error: null,
  ...over,
});
const text = (content: string): AiAssistantPart => ({ id: `t-${content}`, type: 'text', status: 'completed', content });

function turn(steps: AiAssistantPart[][], over: Partial<AiTurn> = {}): AiTurn {
  return {
    id: 'a1',
    threadId: 't',
    parentTurnId: 'u1',
    role: 'assistant',
    parts: [],
    status: 'completed',
    model: null,
    modelMode: null,
    refinement: null,
    steps: steps.map((parts, index) => ({
      id: `s${index}`,
      index,
      status: 'completed',
      parts,
      createdAt: '2026-10-10T10:00:00Z',
      completedAt: null,
    })),
    pendingApprovals: [],
    creditCost: null,
    contextTokens: null,
    failureReason: null,
    feedback: null,
    createdByMemberId: 'm',
    createdAt: '2026-10-10T10:00:00Z',
    completedAt: null,
    canceledAt: null,
    failedAt: null,
    ...over,
  };
}

describe('turn display', () => {
  it('collapses the activity of a finished turn above the final answer', () => {
    const d = displayTurn(
      turn([
        [text('I will look it up.'), tool({ toolCallId: 'a' }), tool({ toolCallId: 'b', tool: 'list-tasks' })],
        [text('Acme has 2 deals.')],
      ]),
    );
    expect(d.running).toBe(false);
    expect(d.thinking).toBe(false);
    expect(d.toolCount).toBe(2);
    expect(d.activity.map((a) => a.kind)).toEqual(['text', 'tool', 'tool']);
    expect(answerText(d)).toBe('Acme has 2 deals.');
  });

  it('shows everything in order while the turn runs, with the Thinking label', () => {
    const d = displayTurn(
      turn([[text('Looking.'), tool({ toolStatus: 'executing' })], [text('Partial ans')]], { status: 'executing' }),
    );
    expect(d.thinking).toBe(true);
    expect(d.answer).toEqual([]);
    expect(d.activity.map((a) => a.kind)).toEqual(['text', 'tool', 'text']);
  });

  it('lists the calls waiting for approval', () => {
    const waiting = tool({
      toolCallId: 'w',
      tool: 'create-task',
      toolStatus: 'awaiting-approval',
      requiresApproval: true,
    });
    const d = displayTurn(
      turn([[text('I will create it.'), waiting]], { status: 'executing', pendingApprovals: ['w'] }),
    );
    expect(d.pending.map((p) => p.toolCallId)).toEqual(['w']);
  });

  it('keeps the text of a turn that ended after a denied action as its answer', () => {
    const denied = tool({ tool: 'create-note', toolStatus: 'canceled' });
    const d = displayTurn(turn([[text('I will add a note.'), denied]]));
    expect(answerText(d)).toBe('I will add a note.');
    expect(d.activity.map((a) => a.kind)).toEqual(['tool']);
  });
});

describe('tool rows', () => {
  it('reads present tense while running and past tense with the result count when done', () => {
    expect(toolRow(tool({ toolStatus: 'executing' }))).toMatchObject({
      label: 'Searching records',
      detail: '"Acme"',
      active: true,
      result: null,
    });
    expect(toolRow(tool({}))).toMatchObject({ label: 'Records searched', result: '2 results', active: false });
    expect(toolRow(tool({ outputDigest: { count: 1 } })).result).toBe('1 result');
    expect(toolRow(tool({})).records).toEqual([{ entityDefinitionId: 'd', entityInstanceId: 'r' }]);
  });

  it('shows "Create task: <title>" for a write waiting for approval and the discarded label after Discard', () => {
    const write = tool({
      tool: 'create-task',
      toolStatus: 'awaiting-approval',
      input: { body: 'AI follow-up call' },
      outputDigest: null,
    });
    expect(toolRow(write)).toMatchObject({ label: 'Create task', detail: 'AI follow-up call', active: false });
    expect(toolRow({ ...write, toolStatus: 'canceled' })).toMatchObject({
      label: 'Task suggestion discarded',
      tone: 'denied',
    });
    // The edited input is what the row shows after approval.
    expect(toolRow({ ...write, toolStatus: 'completed', inputAmendment: { body: 'Edited' } })).toMatchObject({
      label: 'Task created',
      detail: 'Edited',
    });
  });

  it('labels a denied web search and counts tools', () => {
    expect(toolRow(tool({ tool: 'search-web', toolStatus: 'canceled' })).label).toBe('Web search denied');
    expect(
      toolRow(
        tool({
          tool: 'search-web',
          toolStatus: 'awaiting-approval',
          input: { search_queries: ['northwind.example.com'] },
        }),
      ),
    ).toMatchObject({
      label: 'Search web',
      detail: '"northwind.example.com"',
    });
    expect(toolsUsedLabel(1)).toBe('1 tool used');
    expect(toolsUsedLabel(7)).toBe('7 tools used');
  });
});
