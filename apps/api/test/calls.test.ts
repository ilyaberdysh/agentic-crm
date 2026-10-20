// Slice 10 calls over HTTP (BACKLOG 10.09–10.15; acceptance 2): the mymeet sample imported through /v2 by the
// import script appears in the Calls list and on the company's Calls tab without a reload (realtime invalidations,
// X-27), the worker job completes it with summaries and mapped speakers (X-28), and insights run from a published
// template — all through the tRPC procedures the web app uses.

import { fakeCallsLlm, RecordingJobQueue } from '@agentic-crm/domain';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fitSegments, importMymeetCall, loadSample, toApiPayloads } from '../src/cli/import-mymeet-sample';
import type { AppRouter } from '../src/trpc/router';
import { type Harness, startHarness, trpcCall, WsClient } from './support/harness';
import { expectOk, type V2Fixture, v2Fixture } from './v2/support';

type Out = inferRouterOutputs<AppRouter>;

let h: Harness;
let f: V2Fixture;
const jobs = new RecordingJobQueue();
const llm = fakeCallsLlm();

const call = <T>(path: string, input?: unknown) => trpcCall<T>(h, path, input, { user: f.user, slug: f.slug });

/** Runs the queued calls jobs as the worker would. */
async function drainJobs() {
  for (const job of jobs.take('calls.process')) {
    await h.domain.calls.process(String(job.data.workspaceId), String(job.data.recordingId));
  }
  for (const job of jobs.take('calls.generate')) {
    await h.domain.calls.generate(
      String(job.data.workspaceId),
      job.data.kind as 'insight' | 'preview',
      String(job.data.id),
    );
  }
}

beforeAll(async () => {
  h = await startHarness({}, { publicApi: { rateLimits: { readsPerSecond: 5000, writesPerSecond: 5000 } }, jobs, llm });
  f = await v2Fixture(h, 'calls');
});
afterAll(async () => {
  await h?.close();
});

describe('acceptance 2: mymeet import through /v2', () => {
  it('appears live in the Calls list and the company Calls tab, completes with summaries, runs insights', async () => {
    const company = expectOk(
      'createRecord',
      await f.call('POST', '/objects/companies/records', {
        body: { data: { values: { name: 'Northwind Robotics', domains: ['northwind.example.com'] } } },
      }),
    );
    const companyId = company.data.id.record_id as string;
    const ws = await WsClient.connect(h, f.user.cookie);
    await ws.subscribe(f.workspaceId);

    const imported = await importMymeetCall({ baseUrl: h.baseUrl, token: f.token, organizerEmail: f.user.email });
    expect(imported.status).toBe('processing');

    // Live: the Calls list and the company's Calls tab are invalidated by the import itself (X-27).
    const listed = await ws.next<Extract<Awaited<ReturnType<WsClient['next']>>, { type: 'invalidate' }>>(
      (m) =>
        m.type === 'invalidate' &&
        m.resource === 'call-recording-list' &&
        ((m.scope.entityInstanceIds as string[] | undefined) ?? []).includes(companyId),
      5_000,
    );
    expect(listed.resourceId).toBe(imported.meetingId);
    const pending = await call<Out['calls']['list']>('calls.list', { groupBy: 'none' });
    expect(pending.items.map((i) => [i.id, i.status])).toEqual([[imported.recordingId, 'processing']]);

    // The worker job: speakers, summaries, completed.
    const before = ws.messages.length;
    await drainJobs();
    await ws.next(
      (m) => m.type === 'invalidate' && m.resource === 'call-recording' && m.resourceId === imported.recordingId,
      5_000,
      before,
    );
    const got = expectOk(
      'getCallRecording',
      await f.call('GET', `/meetings/${imported.meetingId}/call_recordings/${imported.recordingId}`),
    );
    expect(got.data.status).toBe('completed');
    expect(got.data.transcript.segments).toHaveLength(16);

    const detail = await call<Out['calls']['get']>('calls.get', { recordingId: imported.recordingId });
    expect(detail).toMatchObject({
      status: 'completed',
      summaryStatus: 'completed',
      title: 'Discovery call — Northwind Robotics',
    });
    expect(detail.summary).toContain('Discovery call — Northwind Robotics');
    expect(detail.conciseSummary).toBeTruthy();
    expect(detail.speakers.map((s) => [s.kind, s.name])).toEqual([
      ['member', 'Ada Lovelace'],
      ['person', 'Jane Cooper'],
      ['person', 'Wade Warren'],
    ]);

    // The company's Calls tab (record filter) with the concise summary.
    const tab = await call<Out['calls']['list']>('calls.list', {
      groupBy: 'none',
      filters: [
        { field: 'record', operator: 'eq', value: { entityDefinitionId: 'companies', entityInstanceId: companyId } },
      ],
    });
    expect(tab.items.map((i) => [i.id, i.conciseSummary])).toEqual([[imported.recordingId, detail.conciseSummary]]);

    // Acceptance 3 (data): Jane's consecutive segments render as one block.
    const transcript = await call<Out['calls']['transcript']>('calls.transcript', {
      recordingId: imported.recordingId,
    });
    expect(transcript.blocks[1]?.paragraphs).toEqual([{ start: 8, end: 21.6, utteranceIndexes: [1, 2] }]);
    const speakers = await call<Out['calls']['speakers']>('calls.speakers', { recordingId: imported.recordingId });
    expect(speakers.reduce((sum, s) => sum + s.talkShare, 0)).toBeCloseTo(100, 0);

    // Insights from a published template (our preset), generated by the job.
    const template = await call<Out['insightTemplates']['create']>('insightTemplates.create', {
      id: crypto.randomUUID(),
      presetId: 'sales-discovery',
    });
    await call('insightTemplates.publish', { templateId: template.template.id });
    const presets = await call<Out['insightTemplates']['presets']>('insightTemplates.presets');
    expect(presets).toHaveLength(22);
    const requested = await call<Out['calls']['insights']['generate']>('calls.insights.generate', {
      recordingId: imported.recordingId,
      templateId: template.template.id,
    });
    expect(requested.insight.status).toBe('queued');
    await drainJobs();
    const insights = await call<Out['calls']['insights']['list']>('calls.insights.list', {
      recordingId: imported.recordingId,
    });
    expect(insights.map((i) => [i.status, i.sections.length])).toEqual([['completed', 5]]);
    const listedTemplates = await call<Out['insightTemplates']['list']>('insightTemplates.list', { enabledOnly: true });
    expect(listedTemplates.map((t) => [t.title, t.totalInsights, t.canDelete])).toEqual([
      ['Sales Discovery', 1, false],
    ]);
    await ws.close();
  });
});

describe('import script', () => {
  it('maps a mymeet export to the two /v2 bodies and fits long transcripts into 4,000 segments', () => {
    const sample = loadSample();
    const { meeting, recording } = toApiPayloads(sample, { organizerEmail: 'me@ourco.io' });
    expect(meeting.data.participants[0]).toEqual({
      email_address: 'me@ourco.io',
      is_organizer: true,
      status: 'accepted',
    });
    expect(recording.data.transcript[0]?.speaker).toEqual({ name: 'Ilya Berdysh', email_address: 'me@ourco.io' });
    expect(recording.data.transcript[1]).toEqual({
      speech: sample.transcript[1]?.text,
      start_time: 8,
      end_time: 14.2,
      speaker: { name: 'Jane Cooper', email_address: 'jane.cooper@northwind.example.com' },
    });
    const words = Array.from({ length: 9000 }, (_, i) => ({
      speaker: i % 1000 < 500 ? 'A' : 'B',
      start: i * 0.4,
      end: i * 0.4 + 0.3,
      text: `w${i}`,
    }));
    const fitted = fitSegments(words);
    expect(fitted.length).toBeLessThanOrEqual(4000);
    expect(fitted.map((s) => s.text).join(' ')).toBe(words.map((w) => w.text).join(' '));
  });
});
