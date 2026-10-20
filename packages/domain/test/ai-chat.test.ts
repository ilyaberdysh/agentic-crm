// Ask Agentic threads and turns with the deterministic fake LLM (slice 10): streaming protocol through the hub, read
// tools as the asking member, approval gating of write tools (acceptance 4), web search permission, tool permission
// checks, cancel / retry / feedback / suggestions, history replay, credits per turn and budget exhaustion.
import type { AiStreamEvent, AiToolPart, AiTurn } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import {
  type AiStreamEnvelope,
  createDomain,
  FakeLlm,
  type LlmRequest,
  lastToolResults,
  lastUserText,
} from '../src/index.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { database, expectCode, newId, storage } from './support/harness.ts';

const fake = new FakeLlm();
const ai = createDomain({ database, storage, llm: fake });

const asks = (marker: string) => (r: LlmRequest) => r.purpose === 'ask' && lastUserText(r).includes(marker);
const firstStep = (marker: string) => (r: LlmRequest) => asks(marker)(r) && lastToolResults(r).length === 0;
const afterTools = (marker: string) => (r: LlmRequest) => asks(marker)(r) && lastToolResults(r).length > 0;

function collect(turnId: string) {
  const events: AiStreamEvent[] = [];
  const stop = ai.ai.hub.subscribeTurn(turnId, (e: AiStreamEnvelope) => events.push(e.event));
  return { events, stop };
}

async function sendAndSettle(
  ctx: Parameters<typeof ai.ai.turns.send>[0],
  input: Parameters<typeof ai.ai.turns.send>[1],
) {
  const turnId = input.turnId ?? newId();
  const stream = collect(turnId);
  const sent = await ai.ai.turns.send(ctx, { ...input, turnId });
  await ai.ai.turns.settled(turnId);
  stream.stop();
  return { ...sent, events: stream.events, turn: await ai.ai.turns.get(ctx, turnId) };
}

const toolParts = (turn: AiTurn) =>
  turn.steps.flatMap((s) => s.parts).filter((p): p is AiToolPart => p.type === 'tool');

describe('Ask Agentic turns', () => {
  it('streams a turn with a read tool, persists it, titles the thread and charges credits', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t1]'), {
      text: 'Let me look up Acme.',
      toolCalls: [{ name: 'search-records', input: { query: 'Acme', objects: ['companies'] } }],
    });
    fake.when(afterTools('[t1]'), (r) => {
      const result = JSON.parse(String(lastToolResults(r)[0]?.content)) as { records: { link: string }[] };
      return { text: `Found it: ${result.records[0]?.link}` };
    });
    const threadId = newId();
    const { turn, events } = await sendAndSettle(fx.ctx, {
      threadId,
      content: '[t1] summarize Acme',
      context: { records: [fx.record] },
      timeZone: 'Europe/Berlin',
    });

    expect(turn.status).toBe('completed');
    expect(turn.steps).toHaveLength(2);
    const search = toolParts(turn)[0] as AiToolPart;
    expect(search).toMatchObject({ tool: 'search-records', toolStatus: 'completed', requiresApproval: false });
    expect(search.outputDigest).toMatchObject({ count: 1 });
    const answer = turn.steps[1]?.parts.find((p) => p.type === 'text');
    expect(answer).toMatchObject({
      type: 'text',
      content: `Found it: [Acme](agentic-crm://entity-instance:${fx.companies}/${fx.company})`,
    });
    expect(turn.creditCost).toBeGreaterThan(0);
    expect(turn.contextTokens).toBeGreaterThan(0);

    // The page context was hydrated next to the question; the tools were the fixed catalogue.
    const first = fake.calls.find(firstStep('[t1]')) as LlmRequest;
    expect(lastUserText(first)).toContain('The user is looking at:');
    expect(lastUserText(first)).toContain('"name":"Acme"');
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.tools?.map((t) => ('name' in t ? t.name : ''))).toContain('create-task');

    // Streaming protocol: snapshots, cumulative part snapshots with increasing seq, then done.
    expect(events[0]?.type).toBe('turn');
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    const seqs = events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const textSnapshots = events.flatMap((e) =>
      e.type === 'part' && e.part.type === 'text' && e.stepId === turn.steps[1]?.id ? [e.part.content] : [],
    );
    expect(textSnapshots.at(-1)).toBe((answer as { content: string }).content);
    expect(textSnapshots.every((t, i) => i === 0 || t.startsWith(textSnapshots[i - 1] as string))).toBe(true);
    const toolEvents = events.filter((e) => e.type === 'part' && e.part.type === 'tool');
    expect(
      toolEvents.some((e) => e.type === 'part' && e.part.type === 'tool' && e.part.toolStatus === 'executing'),
    ).toBe(true);

    const detail = await ai.ai.threads.get(fx.ctx, threadId);
    expect(detail.thread.aiTitle).toBeTruthy();
    expect(detail.thread.creditCost).toBe(turn.creditCost);
    expect(detail.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(detail.turns[0]?.parts[0]).toMatchObject({ type: 'text', content: '[t1] summarize Acme' });
    expect(detail.turns[0]?.parts[1]).toMatchObject({ type: 'interest', interestType: 'entity-instance' });
    const usage = await ai.credits.usage(fx.ctx);
    expect(usage.bySource.find((s) => s.source === 'ask-turn')?.credits).toBe(turn.creditCost);
    expect((await ai.ai.threads.list(fx.ctx)).threads.map((t) => t.id)).toEqual([threadId]);

    // Invalidations are private to the thread's creator.
    const { rows } = await sql<{ audience: { userIds: string[] } | null }>`
      SELECT audience FROM change_log WHERE workspace_id = ${fx.workspaceId} AND resource = 'ai-turn'`.execute(
      database.kysely,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.audience?.userIds.length === 1 && r.audience.userIds[0] === fx.user.userId)).toBe(true);
  });

  it('replays the thread history byte-for-byte on the next turn', async () => {
    const fx = await collabFixture();
    fake.when(asks('[t2a]'), { text: 'First answer.' });
    fake.when(asks('[t2b]'), { text: 'Second answer.' });
    const threadId = newId();
    await sendAndSettle(fx.ctx, { threadId, content: '[t2a] hello' });
    const second = await sendAndSettle(fx.ctx, { threadId, content: '[t2b] and then?' });
    expect(second.turn.status).toBe('completed');
    const req = fake.calls.filter(asks('[t2b]')).at(-1) as LlmRequest;
    const firstReq = fake.calls.filter(asks('[t2a]'))[0] as LlmRequest;
    // [user 1, assistant 1, user 2]: the first user message is exactly what the first turn sent.
    expect(req.messages).toHaveLength(3);
    expect(JSON.stringify(req.messages[0])).toBe(JSON.stringify(firstReq.messages[0]));
    expect(req.messages[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'First answer.' }] });
    expect(JSON.stringify(req.system)).toBe(JSON.stringify(firstReq.system));
    expect(second.turn.parentTurnId).not.toBeNull();
  });

  it('runs a write tool only after approval, with the edited input (acceptance 4)', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t3]'), {
      text: 'I will create the task.',
      toolCalls: [
        {
          name: 'create-task',
          input: {
            body: 'AI follow-up call',
            due_date: '2026-10-20',
            assignee_member_ids: [fx.memberId],
            linked_records: [{ entity_definition_id: fx.companies, entity_instance_id: fx.company }],
          },
        },
      ],
    });
    fake.when(afterTools('[t3]'), (r) => {
      const result = JSON.parse(String(lastToolResults(r)[0]?.content)) as { task_id: string };
      return { text: `Created.\n\n\`\`\`agentic-crm:task-embed\n{"task_id":"${result.task_id}"}\n\`\`\`` };
    });
    const threadId = newId();
    const paused = await sendAndSettle(fx.ctx, { threadId, content: '[t3] create a follow-up task for Acme' });
    expect(paused.turn.status).toBe('executing');
    const pending = toolParts(paused.turn)[0] as AiToolPart;
    expect(pending).toMatchObject({ tool: 'create-task', toolStatus: 'awaiting-approval', requiresApproval: true });
    expect(paused.turn.pendingApprovals).toEqual([pending.toolCallId]);
    expect(paused.events.at(-1)).toMatchObject({ type: 'done', status: 'awaiting-approval' });
    const tasksBefore = await ai.tasks.list(fx.ctx, { groupBy: 'none' });
    expect(tasksBefore.total).toBe(0);
    expect(fake.calls.filter(afterTools('[t3]'))).toHaveLength(0);

    // A broken edit is refused and leaves the card pending.
    await expectCode(
      ai.ai.turns.approve(fx.ctx, { turnId: paused.turnId, toolCallId: pending.toolCallId, input: { body: '' } }),
      'VALIDATION_ERROR',
      400,
    );
    const stream = collect(paused.turnId);
    await ai.ai.turns.approve(fx.ctx, {
      turnId: paused.turnId,
      toolCallId: pending.toolCallId,
      input: { ...(pending.input as object), body: 'AI follow-up call (edited)' },
    });
    await ai.ai.turns.settled(paused.turnId);
    stream.stop();
    const done = await ai.ai.turns.get(fx.ctx, paused.turnId);
    expect(done.status).toBe('completed');
    const executed = toolParts(done)[0] as AiToolPart;
    expect(executed).toMatchObject({ toolStatus: 'completed', inputAmendment: { body: 'AI follow-up call (edited)' } });
    const tasks = await ai.tasks.list(fx.ctx, { groupBy: 'none' });
    expect(tasks.total).toBe(1);
    const task = tasks.groups[0]?.tasks[0];
    expect(task?.content.text).toBe('AI follow-up call (edited)');
    expect(task?.linkedRecords).toEqual([fx.record]);
    expect(executed.outputDigest).toEqual({ taskId: task?.id });
    expect(stream.events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    // Approving twice is a state conflict.
    await expectCode(
      ai.ai.turns.approve(fx.ctx, { turnId: paused.turnId, toolCallId: pending.toolCallId }),
      'AI_TURN_STATE_CONFLICT',
      409,
    );
  });

  it('ends the turn without another model call when every action is denied', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t4]'), {
      toolCalls: [
        {
          name: 'create-note',
          input: {
            parent_record: { entity_definition_id: fx.companies, entity_instance_id: fx.company },
            title: 'x',
            content: 'y',
          },
        },
      ],
    });
    const { turn, turnId } = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t4] note it' });
    const part = toolParts(turn)[0] as AiToolPart;
    const calls = fake.calls.length;
    await ai.ai.turns.deny(fx.ctx, { turnId, toolCallId: part.toolCallId, reason: null });
    await ai.ai.turns.settled(turnId);
    const done = await ai.ai.turns.get(fx.ctx, turnId);
    expect(done.status).toBe('completed');
    expect(toolParts(done)[0]?.toolStatus).toBe('canceled');
    expect(fake.calls.length).toBe(calls);
    expect((await ai.notes.list(fx.ctx, { record: fx.record })).total).toBe(0);
  });

  it('records model-authored note content as derived in the creation transaction', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t4-derived]'), {
      toolCalls: [
        {
          name: 'create-note',
          input: {
            parent_record: { entity_definition_id: fx.companies, entity_instance_id: fx.company },
            title: 'AI recap',
            content: 'Model-authored recap',
          },
        },
      ],
    });
    fake.when(afterTools('[t4-derived]'), { text: 'Saved.' });
    const paused = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t4-derived] note it' });
    const pending = toolParts(paused.turn)[0] as AiToolPart;
    await ai.ai.turns.approve(fx.ctx, { turnId: paused.turnId, toolCallId: pending.toolCallId });
    await ai.ai.turns.settled(paused.turnId);
    const noteId = (toolParts(await ai.ai.turns.get(fx.ctx, paused.turnId))[0]?.outputDigest as { noteId: string })
      .noteId;
    const { rows } = await sql<{ updated_by: { type: string; id: string | null } }>`
      SELECT d.updated_by FROM notes n JOIN documents d ON d.id = n.document_id
      WHERE n.workspace_id = ${fx.workspaceId}::uuid AND n.id = ${noteId}::uuid
    `.execute(database.kysely);
    expect(rows[0]?.updated_by).toEqual({ type: 'system', id: 'ask-ai' });
  });

  it('asks for web search permission per thread; "Always allow" changes the member setting', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t5]'), {
      toolCalls: [{ name: 'search-web', input: { objective: 'Acme homepage', search_queries: ['acme.example'] } }],
    });
    fake.when(afterTools('[t5]'), { text: 'Acme makes anvils.' });
    fake.when((r) => r.purpose === 'web-search', {
      text: 'Acme sells anvils (https://acme.example).',
      webSearchRequests: 1,
    });
    const first = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t5] search the web for acme' });
    expect(toolParts(first.turn)[0]).toMatchObject({ tool: 'search-web', toolStatus: 'awaiting-approval' });
    await ai.ai.webSearch.allow(fx.ctx, { threadId: first.threadId, always: true });
    await ai.ai.turns.settled(first.turnId);
    const done = await ai.ai.turns.get(fx.ctx, first.turnId);
    expect(done.status).toBe('completed');
    expect(toolParts(done)[0]?.toolStatus).toBe('completed');
    expect((await ai.ai.settings.get(fx.ctx)).allowWebSearch).toBe('auto-approve');
    expect((await ai.ai.threads.get(fx.ctx, first.threadId)).thread.webSearchAllowed).toBe(true);
    // The nested search call is part of the turn's cost (1 search = 1 credit at least).
    expect(done.creditCost).toBeGreaterThanOrEqual(1);

    // Auto-approve: the next search runs at once; "Don't allow": the tool is not offered.
    const second = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t5] search the web for acme again' });
    expect(second.turn.status).toBe('completed');
    await ai.ai.settings.update(fx.ctx, { allowWebSearch: 'disabled' });
    fake.when(asks('[t5c]'), { text: 'ok' });
    await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t5c] anything' });
    const req = fake.calls.filter(asks('[t5c]')).at(-1) as LlmRequest;
    expect(req.tools?.map((t) => ('name' in t ? t.name : ''))).not.toContain('search-web');
  });

  it('runs tools with the asking member’s permissions', async () => {
    const fx = await collabFixture();
    const bob = await addMember(fx, 'Bob');
    const gadgets = await ai.schema.createObject(fx.ctx, {
      id: newId(),
      apiSlug: `gadgets_${Math.random().toString(36).slice(2, 8)}`,
      singularNoun: 'Gadget',
      pluralNoun: 'Gadgets',
      workspaceAccess: 'no-access',
    });
    await ai.permissions.put(fx.ctx, {
      resourceKind: 'object',
      resourceId: 'companies',
      target: { type: 'workspace' },
      level: 'read-only',
    });
    fake.when(firstStep('[t6]'), {
      toolCalls: [
        { name: 'list-records', input: { object: gadgets.apiSlug } },
        {
          name: 'update-record',
          input: { object: 'companies', record_id: fx.company, values: { name: 'Acme Renamed' } },
        },
      ],
    });
    fake.when(afterTools('[t6]'), { text: 'Done what I could.' });
    const paused = await sendAndSettle(bob.ctx, { threadId: newId(), content: '[t6] list gadgets and rename Acme' });
    const [list, update] = toolParts(paused.turn);
    expect(list).toMatchObject({ tool: 'list-records', toolStatus: 'failed' });
    expect(list?.error).toContain('do not have access');
    expect(update).toMatchObject({ tool: 'update-record', toolStatus: 'awaiting-approval' });
    await ai.ai.turns.approve(bob.ctx, { turnId: paused.turnId, toolCallId: update?.toolCallId as string });
    await ai.ai.turns.settled(paused.turnId);
    const done = await ai.ai.turns.get(bob.ctx, paused.turnId);
    expect(done.status).toBe('completed');
    expect(toolParts(done)[1]).toMatchObject({ toolStatus: 'failed' });
    expect(toolParts(done)[1]?.error).toMatch(/Permission denied/);
    const record = await ai.records.get(fx.ctx, fx.record);
    const nameAttr = (await ai.schema.listAttributes(fx.ctx, { entityDefinitionId: 'companies' })).find(
      (a) => a.apiSlug === 'name',
    );
    expect(record.values[nameAttr?.id as string]?.[0]?.value).toBe('Acme');
    // Threads are private: the owner of the workspace cannot open Bob's chat.
    await expectCode(ai.ai.threads.get(fx.ctx, paused.threadId), 'NOT_FOUND', 404);
  });

  it('cancels, retries with a refinement, records feedback and suggests replies', async () => {
    const fx = await collabFixture();
    fake.when(firstStep('[t7]'), {
      toolCalls: [{ name: 'create-task', input: { body: 'Something' } }],
    });
    const paused = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t7] make a task' });
    const canceled = await ai.ai.turns.cancel(fx.ctx, paused.turnId);
    expect(canceled.status).toBe('canceled');
    expect(toolParts(canceled)[0]?.toolStatus).toBe('canceled');
    expect(canceled.pendingApprovals).toEqual([]);

    fake.when(asks('[t7]'), { text: 'A shorter answer.' });
    const retryId = newId();
    await ai.ai.turns.retry(fx.ctx, {
      turnId: paused.turnId,
      newTurnId: retryId,
      model: 'claude-sonnet-5-5',
      refinement: { type: 'make-concise' },
    });
    await ai.ai.turns.settled(retryId);
    const retried = await ai.ai.turns.get(fx.ctx, retryId);
    expect(retried).toMatchObject({
      status: 'completed',
      parentTurnId: paused.userTurnId,
      model: 'claude-sonnet-5-5',
      modelMode: 'manual',
      refinement: { type: 'make-concise' },
    });
    const req = fake.calls.at(-2) as LlmRequest; // the ask call before the title call
    expect(JSON.stringify(req.messages)).toContain('Make it more concise.');

    const rated = await ai.ai.turns.feedback(fx.ctx, { turnId: retryId, feedback: { type: 'positive' } });
    expect(rated.feedback).toEqual({ type: 'positive', issueType: null, reason: null });
    fake.when((r) => r.purpose === 'ask-suggestions', {
      json: { suggestions: ['Draft an email', 'Show deals', 'More', 'x'] },
    });
    const suggestions = await ai.ai.turns.suggestions(fx.ctx, retryId);
    expect(suggestions.suggestions).toEqual(['Draft an email', 'Show deals', 'More']);
    expect((await ai.ai.turns.suggestions(fx.ctx, retryId)).suggestions).toHaveLength(3);

    await ai.ai.threads.rename(fx.ctx, { threadId: paused.threadId, title: 'My chat' });
    expect((await ai.ai.threads.list(fx.ctx, { query: 'my c' })).threads[0]?.title).toBe('My chat');
    await ai.ai.threads.delete(fx.ctx, paused.threadId);
    expect((await ai.ai.threads.list(fx.ctx)).threads).toEqual([]);
  });

  it('refuses to start a turn when credits are used up and fails provider refusals', async () => {
    const fx = await collabFixture();
    await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}',
      '{"quotas":{"workspace_membership_credits_per_month_hard":0,"workflow_credits_per_month_hard":0}}'::jsonb)
      WHERE id = ${fx.workspaceId}`.execute(database.kysely);
    await expectCode(ai.ai.turns.send(fx.ctx, { threadId: newId(), content: 'hello' }), 'CREDITS_EXHAUSTED', 402);
    expect((await ai.credits.usage(fx.ctx)).outOfCredits).toBe(true);
    await sql`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = ${fx.workspaceId}`.execute(database.kysely);

    fake.when(asks('[t8]'), { text: '', stopReason: 'refusal' });
    const { turn } = await sendAndSettle(fx.ctx, { threadId: newId(), content: '[t8] something' });
    expect(turn).toMatchObject({ status: 'failed', failureReason: 'provider-refused-request' });
  });
});
