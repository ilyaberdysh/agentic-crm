// Slice 10 (S10-ASK) over HTTP with the fake LLM: the SSE stream of a turn (snapshot, cumulative parts, done), the
// same events in the thread room for another tab, `ai-turn` invalidations on the data channel, write-tool approval
// end to end (acceptance 4), private threads, prompts / credits / models / summary procedures.
import { randomUUID } from 'node:crypto';
import type { AiStreamEvent, AiTurn } from '@agentic-crm/contracts';
import { FakeLlm, type LlmRequest, lastToolResults, lastUserText, memberContext } from '@agentic-crm/domain';
import type { ServerToClient } from '@agentic-crm/realtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  type TrpcOptions,
  trpcCall,
  trpcError,
  WEB_ORIGIN,
  WsClient,
} from './support/harness';

const fake = new FakeLlm();
let h: Harness;
let alice: TestUser;
let bob: TestUser;
let workspaceId: string;
let companies: string;
let acme: string;
const slug = `s10-${Date.now().toString(36)}`;
const clients: WsClient[] = [];

const call = <T>(user: TestUser, path: string, input?: unknown, opts: TrpcOptions = {}) =>
  trpcCall<T>(h, path, input, { user, slug, ...opts });

const asks = (marker: string) => (r: LlmRequest) => r.purpose === 'ask' && lastUserText(r).includes(marker);

/** Reads an SSE stream until `done` (or the timeout). */
async function stream(user: TestUser, threadId: string, turnId: string, path = '/ai/threads') {
  const response = await fetch(`${h.baseUrl}${path}/${threadId}/stream?turnId=${turnId}`, {
    headers: { cookie: user.cookie, 'x-workspace-slug': slug, origin: WEB_ORIGIN },
  });
  if (!response.ok) return { status: response.status, events: [] as AiStreamEvent[], raw: await response.text() };
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: AiStreamEvent[] = [];
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      if (data) events.push(JSON.parse(data) as AiStreamEvent);
      index = buffer.indexOf('\n\n');
    }
    if (events.at(-1)?.type === 'done') break;
  }
  return { status: response.status, events, raw: '' };
}

beforeAll(async () => {
  h = await startHarness({}, { llm: fake });
  alice = await signUp(h, 'Alice Asker');
  bob = await signUp(h, 'Bob Other');
  const created = await createWorkspaceWithMembers(h, slug, [{ user: alice, admin: true }, { user: bob }]);
  workspaceId = created.workspaceId;
  const ctx = memberContext(workspaceId, created.memberIds.get(alice.id) as string);
  companies = (await h.domain.schema.getObject(ctx, 'companies')).id;
  acme = randomUUID();
  await h.domain.records.create(ctx, {
    entityDefinitionId: companies,
    entityInstanceId: acme,
    values: { name: [{ value: 'Acme' }] },
  });
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('Ask Agentic over HTTP', () => {
  it('streams a turn over SSE, mirrors it into the thread room and invalidates the turn', async () => {
    fake.when(asks('[api1]'), { text: 'Acme is a company in your workspace with one record.', chunkDelayMs: 15 });
    const threadId = randomUUID();
    await call(alice, 'ai.threads.create', { threadId });
    const tab = await WsClient.connect(h, alice.cookie);
    const otherTab = await WsClient.connect(h, alice.cookie);
    clients.push(tab, otherTab);
    await tab.subscribe(workspaceId);
    const room = `thread:${workspaceId}:${threadId}`;
    otherTab.send({ type: 'join-room', room });
    await otherTab.next((m) => m.type === 'presence' && m.room === room);

    const sent = await call<{ threadId: string; userTurnId: string; turnId: string; seq: string | null }>(
      alice,
      'ai.turns.send',
      {
        threadId,
        content: '[api1] what is Acme?',
        context: { records: [{ entityDefinitionId: companies, entityInstanceId: acme }] },
      },
    );
    expect(sent.seq).not.toBeNull();
    const { events, status } = await stream(alice, threadId, sent.turnId);
    expect(status).toBe(200);
    expect(events[0]?.type).toBe('turn');
    expect(events.at(-1)).toMatchObject({ type: 'done', turnId: sent.turnId, status: 'completed' });
    const texts = events.flatMap((e) => (e.type === 'part' && e.part.type === 'text' ? [e.part.content] : []));
    expect(texts.length).toBeGreaterThan(1);
    expect(texts.at(-1)).toBe('Acme is a company in your workspace with one record.');
    expect(texts.every((t, i) => i === 0 || t.startsWith(texts[i - 1] as string))).toBe(true);
    const final = [...events].reverse().find((e) => e.type === 'turn') as Extract<AiStreamEvent, { type: 'turn' }>;
    expect(final.turn.status).toBe('completed');

    // The other tab got the same events as ephemeral room messages (from the server).
    const done = await otherTab.next(
      (m) =>
        m.type === 'ephemeral' && m.room === room && (m.payload as { event?: AiStreamEvent }).event?.type === 'done',
      5_000,
    );
    expect(done).toMatchObject({ from: 'server', payload: { kind: 'ai-stream' } });
    expect(
      otherTab.messages.some(
        (m) => m.type === 'ephemeral' && (m.payload as { event?: AiStreamEvent }).event?.type === 'part',
      ),
    ).toBe(true);
    // The data channel invalidates the persisted turn.
    await tab.next(
      (m: ServerToClient) => m.type === 'invalidate' && m.resource === 'ai-turn' && m.resourceId === sent.turnId,
      5_000,
    );

    // A finished turn streams its stored state at once (also on the /api alias proxied by Vite).
    const again = await stream(alice, threadId, sent.turnId, '/api/ai/threads');
    expect(again.events.map((e) => e.type)).toEqual(['turn', 'done']);
    const detail = await call<{ turns: AiTurn[] }>(alice, 'ai.threads.get', { threadId });
    expect(detail.turns).toHaveLength(2);
  });

  it('shows an approval card and runs the write only after approval (acceptance 4)', async () => {
    fake.when((r) => asks('[api2]')(r) && lastToolResults(r).length === 0, {
      text: 'Creating the task.',
      toolCalls: [
        {
          name: 'create-task',
          input: {
            body: '[seed] AI follow-up call',
            due_date: '2026-10-15',
            linked_records: [{ entity_definition_id: companies, entity_instance_id: acme }],
          },
        },
      ],
    });
    fake.when((r) => asks('[api2]')(r) && lastToolResults(r).length > 0, { text: 'Task created.' });
    const threadId = randomUUID();
    const sent = await call<{ turnId: string }>(alice, 'ai.turns.send', {
      threadId,
      content: '[api2] create a follow-up task for Acme',
    });
    const first = await stream(alice, threadId, sent.turnId);
    expect(first.events.at(-1)).toMatchObject({ type: 'done', status: 'awaiting-approval' });
    const turn = await call<AiTurn>(alice, 'ai.turns.get', { turnId: sent.turnId });
    expect(turn.status).toBe('executing');
    const toolCallId = turn.pendingApprovals[0] as string;
    const card = turn.steps.flatMap((s) => s.parts).find((p) => p.type === 'tool');
    expect(card).toMatchObject({ tool: 'create-task', toolStatus: 'awaiting-approval', requiresApproval: true });
    const before = await call<{ total: number }>(alice, 'tasks.list', { groupBy: 'none' });
    expect(before.total).toBe(0);
    // Somebody else cannot approve it.
    expect((await trpcError(call(bob, 'ai.turns.approve', { turnId: sent.turnId, toolCallId }))).status).toBe(404);

    const approved = await call<{ turn: AiTurn; seq: string | null }>(alice, 'ai.turns.approve', {
      turnId: sent.turnId,
      toolCallId,
      input: { ...(card as { input: object }).input, body: '[seed] AI follow-up call (edited)' },
    });
    expect(approved.seq).not.toBeNull();
    const second = await stream(alice, threadId, sent.turnId);
    expect(second.events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    const tasks = await call<{ total: number; groups: { tasks: { content: { text: string } }[] }[] }>(
      alice,
      'tasks.list',
      { groupBy: 'none' },
    );
    expect(tasks.total).toBe(1);
    expect(tasks.groups[0]?.tasks[0]?.content.text).toBe('[seed] AI follow-up call (edited)');
  });

  it('keeps threads private and serves the other AI procedures', async () => {
    fake.when(asks('[api3]'), { text: 'Hello.' });
    const threadId = randomUUID();
    const sent = await call<{ turnId: string }>(alice, 'ai.turns.send', { threadId, content: '[api3] hi' });
    await stream(alice, threadId, sent.turnId);
    expect((await trpcError(call(bob, 'ai.threads.get', { threadId }))).status).toBe(404);
    expect((await stream(bob, threadId, sent.turnId)).status).toBe(404);
    const bobTab = await WsClient.connect(h, bob.cookie);
    clients.push(bobTab);
    bobTab.send({ type: 'join-room', room: `thread:${workspaceId}:${threadId}` });
    expect(await bobTab.next((m) => m.type === 'error')).toMatchObject({ code: 'forbidden' });
    expect((await stream(alice, threadId, randomUUID())).status).toBe(404);

    const models = await call<{ configured: boolean; models: { id: string; isAuto: boolean }[] }>(
      alice,
      'ai.models.list',
    );
    expect(models.configured).toBe(true);
    expect(models.models.find((m) => m.isAuto)?.id).toBe('claude-opus-5-5');
    const usage = await call<{ member: { used: number; limit: number }; members: unknown[] | null }>(
      alice,
      'credits.usage',
      { period: 'current' },
    );
    expect(usage.member.used).toBeGreaterThan(0);
    expect(usage.member.limit).toBe(1000);
    expect(usage.members).not.toBeNull();
    const ledger = await call<{ entries: { source: string }[] }>(alice, 'credits.ledger', {});
    expect(ledger.entries.some((e) => e.source === 'ask-turn')).toBe(true);
    expect((await call<{ entries: unknown[] }>(bob, 'credits.ledger', {})).entries).toEqual([]);
    const prompts = await call<{ prompts: { id: string }[] }>(alice, 'prompts.list', {});
    expect(prompts.prompts.map((p) => p.id)).toEqual(['daily-brief', 'follow-up-email', 'meeting-prep']);
    expect((await trpcError(call(bob, 'ai.workspaceSettings.update', { customContext: 'nope' }))).status).toBe(403);
    const settings = await call<{ settings: { customContext: string } }>(alice, 'ai.workspaceSettings.update', {
      customContext: 'We sell meetings.',
    });
    expect(settings.settings.customContext).toBe('We sell meetings.');

    fake.when((r) => r.purpose === 'record-summary', { text: 'Acme is a company.' });
    const recordRef = { entityDefinitionId: 'companies', entityInstanceId: acme };
    expect(await call<{ summary: null }>(alice, 'records.summary.get', { recordRef })).toMatchObject({ summary: null });
    const summary = await call<{ summary: { text: string; stale: boolean }; seq: string | null }>(
      alice,
      'records.summary.regenerate',
      { recordRef },
    );
    expect(summary.summary).toMatchObject({ text: 'Acme is a company.', stale: false });
    expect(summary.seq).not.toBeNull();
  });
});
