// Insight templates and insights (BACKLOG 10.13, 10.14): transient templates, sections (rich-text title + prompt
// documents, list / text, reorder, duplicate, delete), presets, publish / discard versions, previews, insights with
// the fake LLM and credits, the default template applied to new calls.
import { sql } from '@agentic-crm/db';
import { blocksToState, markdownToBlocks } from '@agentic-crm/editor/model';
import { describe, expect, it } from 'vitest';
import { createDomain, fakeCallsLlm, INSIGHT_PRESETS, RecordingJobQueue } from '../src/index.ts';
import { callFixture, calls, llm, transcript } from './calls-fixtures.ts';
import { addMember, changeRows, lastChangeId } from './collab-fixtures.ts';
import { database, expectCode, newId, domain as plain, storage } from './support/harness.ts';

async function templateWithSections(f: Awaited<ReturnType<typeof callFixture>>, title: string | null = 'Discovery') {
  const id = newId();
  await calls.insightTemplates.create(f.ctx, { id, title });
  await calls.insightTemplates.sections.create(f.ctx, {
    templateId: id,
    sectionId: newId(),
    type: 'list',
    title: 'Pain points',
    prompt: 'List the problems the prospect described.',
  });
  return calls.insightTemplates.sections.create(f.ctx, {
    templateId: id,
    sectionId: newId(),
    type: 'plaintext',
    title: 'Budget',
    prompt: 'What was said about budget?',
  });
}

describe('templates: transient, sections, versions', () => {
  it('a new template is transient until edited; sections edit the draft; publish forks a new draft', async () => {
    const f = await callFixture('Templates call');
    const id = newId();
    const created = await calls.insightTemplates.create(f.ctx, { id });
    expect(created).toMatchObject({
      title: null,
      status: 'draft',
      isTransient: true,
      isFirstVersion: true,
      canPublish: true,
      hasUnpublishedChanges: false,
      sectionCount: 0,
    });
    expect(created.draft?.sections).toEqual([]);
    expect((await calls.insightTemplates.list(f.ctx)).map((t) => t.id)).not.toContain(id);
    // Idempotent create.
    expect((await calls.insightTemplates.create(f.ctx, { id })).draftSnapshotId).toBe(created.draftSnapshotId);

    // Publishing an empty template is refused.
    const empty = await expectCode(calls.insightTemplates.publish(f.ctx, id), 'TEMPLATE_INCOMPLETE', 400);
    expect(empty.details).toMatchObject({ missing_sections: true });

    const s1 = newId();
    const s2 = newId();
    await calls.insightTemplates.sections.create(f.ctx, { templateId: id, sectionId: s1, title: 'Pain points' });
    let t = await calls.insightTemplates.sections.create(f.ctx, {
      templateId: id,
      sectionId: s2,
      type: 'list',
      title: 'Next steps',
      prompt: 'List agreed follow-ups.',
    });
    expect(t.isTransient).toBe(false);
    expect((await calls.insightTemplates.list(f.ctx)).map((x) => x.id)).toContain(id);
    expect(t.draft?.sections.map((s) => [s.title, s.type, s.prompt])).toEqual([
      ['Pain points', 'plaintext', ''],
      ['Next steps', 'list', 'List agreed follow-ups.'],
    ]);
    // Missing prompt → "Section 1 · Missing prompt".
    const incomplete = await expectCode(calls.insightTemplates.publish(f.ctx, id), 'TEMPLATE_INCOMPLETE', 400);
    expect(incomplete.details.issues).toEqual([{ sectionId: s1, section: 1, missing: ['prompt'] }]);

    // Section title / prompt are documents edited by the collab server: an edit touches the draft.
    const promptDoc = t.draft?.sections[0]?.promptDocumentId as string;
    const blocks = markdownToBlocks('Which problems did they describe?');
    await calls.documents.storeState(f.ctx, { id: promptDoc, state: blocksToState(blocks) });
    t = await calls.insightTemplates.get(f.ctx, id);
    expect(t.draft?.sections[0]?.prompt).toBe('Which problems did they describe?');

    // Reorder (Move Down), duplicate, format, delete.
    t = await calls.insightTemplates.sections.move(f.ctx, { sectionId: s1, direction: 'down' });
    expect(t.draft?.sections.map((s) => s.id)).toEqual([s2, s1]);
    const dup = newId();
    t = await calls.insightTemplates.sections.duplicate(f.ctx, { sectionId: s2, newSectionId: dup });
    expect(t.draft?.sections.map((s) => s.id)).toEqual([s2, dup, s1]);
    expect(t.draft?.sections[1]).toMatchObject({ title: 'Next steps', type: 'list' });
    t = await calls.insightTemplates.sections.update(f.ctx, { sectionId: dup, type: 'plaintext', title: 'Owners' });
    expect(t.draft?.sections[1]).toMatchObject({ title: 'Owners', type: 'plaintext' });
    t = await calls.insightTemplates.sections.delete(f.ctx, dup);
    expect(t.sectionCount).toBe(2);

    // Publish: draft → active, a fresh draft forked from it; "Publish changes" disabled until edited.
    const before = await lastChangeId(f.workspaceId);
    t = await calls.insightTemplates.publish(f.ctx, id);
    expect(t).toMatchObject({
      status: 'enabled',
      isFirstVersion: false,
      canPublish: false,
      hasUnpublishedChanges: false,
      aiTitle: 'Next steps',
      sectionCount: 2,
    });
    expect(t.firstEnabledAt).not.toBeNull();
    expect(t.active?.sections.map((s) => s.title)).toEqual(['Next steps', 'Pain points']);
    expect(t.draft?.parentSnapshotId).toBe(t.active?.id);
    expect(t.draft?.sections.map((s) => s.title)).toEqual(['Next steps', 'Pain points']);
    expect(t.draft?.sections[0]?.titleDocumentId).not.toBe(t.active?.sections[0]?.titleDocumentId);
    expect((await changeRows(f.workspaceId, before)).some((r) => r.resource === 'insight-template-list')).toBe(true);
    await expectCode(calls.insightTemplates.publish(f.ctx, id), 'SNAPSHOT_NOT_DRAFT', 409);

    // Published sections are immutable (documents read-only, sections refuse writes).
    const activeSection = t.active?.sections[0];
    expect(await calls.documents.resolveAccess(f.ctx, activeSection?.titleDocumentId as string)).toBe('read');
    expect(await calls.documents.resolveAccess(f.ctx, t.draft?.sections[0]?.titleDocumentId as string)).toBe('edit');
    await expectCode(
      calls.insightTemplates.sections.update(f.ctx, { sectionId: activeSection?.id as string, title: 'x' }),
      'SNAPSHOT_NOT_DRAFT',
      409,
    );

    // Edit → "Publish changes" + "Discard changes"; discard restores the published content.
    t = await calls.insightTemplates.sections.update(f.ctx, {
      sectionId: t.draft?.sections[0]?.id as string,
      title: 'Follow-ups',
    });
    expect(t).toMatchObject({ canPublish: true, hasUnpublishedChanges: true });
    t = await calls.insightTemplates.discard(f.ctx, id);
    expect(t).toMatchObject({ canPublish: false, hasUnpublishedChanges: false });
    expect(t.draft?.sections.map((s) => s.title)).toEqual(['Next steps', 'Pain points']);
    const fresh = newId();
    await calls.insightTemplates.create(f.ctx, { id: fresh, title: 'Never published' });
    await expectCode(calls.insightTemplates.discard(f.ctx, fresh), 'SNAPSHOT_NOT_DRAFT', 409);

    // Rename, archive (picker excludes it), restore; duplicate copies the latest edits.
    t = await calls.insightTemplates.update(f.ctx, { templateId: id, title: '  Discovery  ' });
    expect(t.title).toBe('Discovery');
    expect((await calls.insightTemplates.list(f.ctx, { enabledOnly: true })).map((x) => x.id)).toEqual([id]);
    t = await calls.insightTemplates.update(f.ctx, { templateId: id, archived: true });
    expect(t).toMatchObject({ status: 'disabled', isArchived: true });
    expect(await calls.insightTemplates.list(f.ctx, { enabledOnly: true })).toEqual([]);
    t = await calls.insightTemplates.update(f.ctx, { templateId: id, archived: false });
    expect(t.status).toBe('enabled');
    const copy = await calls.insightTemplates.duplicate(f.ctx, { templateId: id, newTemplateId: newId() });
    expect(copy).toMatchObject({ title: 'Discovery (copy)', status: 'draft', isTransient: false, sectionCount: 2 });

    // Unused templates can be deleted.
    await calls.insightTemplates.delete(f.ctx, copy.id);
    await expectCode(calls.insightTemplates.get(f.ctx, copy.id), 'NOT_FOUND', 404);
  });

  it('presets: 22 of our own across 8 use cases; "Use this template" fills the draft', async () => {
    expect(INSIGHT_PRESETS).toHaveLength(22);
    const categories = new Set(INSIGHT_PRESETS.flatMap((p) => p.categories));
    expect(categories.size).toBe(8);
    for (const p of INSIGHT_PRESETS) {
      expect(p.sections.length).toBeGreaterThanOrEqual(3);
      for (const s of p.sections) expect(s.title && s.prompt).toBeTruthy();
    }
    const f = await callFixture('Preset call');
    const id = newId();
    await calls.insightTemplates.create(f.ctx, { id });
    const t = await calls.insightTemplates.applyPreset(f.ctx, { templateId: id, presetId: 'bant' });
    expect(t).toMatchObject({ title: 'BANT', isTransient: false, sectionCount: 4 });
    expect(t.draft?.sections.map((s) => s.title)).toEqual(['Budget', 'Authority', 'Need', 'Timeline']);
    const started = await calls.insightTemplates.create(f.ctx, { id: newId(), presetId: 'meddpicc' });
    expect(started).toMatchObject({ title: 'MEDDPICC', sectionCount: 7, isTransient: false });
    await expectCode(calls.insightTemplates.applyPreset(f.ctx, { templateId: id, presetId: 'nope' }), 'NOT_FOUND', 404);
  });
});

describe('insights and previews (10.14)', () => {
  it('generates insights from the active version with the fake LLM; credits; outdated after a new publish', async () => {
    const f = await callFixture('Insights call');
    const recording = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    const t = await templateWithSections(f);
    // Not published yet → refused.
    await expectCode(
      calls.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id }),
      'VALIDATION_ERROR',
      400,
    );

    // Preview of the draft against the call (template editor).
    const preview = await calls.insightTemplates.preview(f.ctx, {
      templateId: t.id,
      previewId: newId(),
      recordingId: recording.id,
    });
    expect(preview).toMatchObject({ status: 'completed', isStale: false, meetingId: f.meetingId });
    expect(preview.sections.map((s) => [s.title, s.type, s.items.length > 0 || !!s.content])).toEqual([
      ['Pain points', 'list', true],
      ['Budget', 'plaintext', true],
    ]);
    expect(preview.creditCost).toBeGreaterThanOrEqual(1);
    const previewRequest = llm.callsFor('call-insight-preview').at(-1);
    expect(previewRequest?.messages[0]?.content).toContain('List the problems the prospect described.');

    const published = await calls.insightTemplates.publish(f.ctx, t.id);
    const insightId = newId();
    const insight = await calls.calls.insights.generate(f.ctx, {
      recordingId: recording.id,
      templateId: t.id,
      insightId,
    });
    expect(insight).toMatchObject({
      id: insightId,
      status: 'completed',
      snapshotId: published.activeSnapshotId,
      isOutdated: false,
      error: null,
    });
    expect(insight.sections[0]?.items).toHaveLength(2);
    expect(insight.sections[1]?.content).toMatch(/^Answer 2/);
    expect(insight.creditCost).toBeGreaterThanOrEqual(1);
    // Idempotent by id.
    expect(
      (await calls.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id, insightId })).id,
    ).toBe(insightId);

    // The preview is stale once the draft changes; a used template cannot be deleted.
    await calls.insightTemplates.sections.update(f.ctx, {
      sectionId: published.draft?.sections[1]?.id as string,
      prompt: 'Budget amount and approval status.',
    });
    expect((await calls.insightTemplates.get(f.ctx, t.id)).previews[0]?.isStale).toBe(true);
    await expectCode(calls.insightTemplates.delete(f.ctx, t.id), 'TEMPLATE_IN_USE', 409);
    expect((await calls.insightTemplates.get(f.ctx, t.id)).totalInsights).toBe(1);

    // Publishing a new version marks the insight outdated; Update creates a new insight with the latest version.
    await calls.insightTemplates.publish(f.ctx, t.id);
    const detail = await calls.calls.get(f.ctx, recording.id);
    expect(detail.insights.map((i) => [i.id, i.isOutdated])).toEqual([[insightId, true]]);
    const updated = await calls.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id });
    expect(updated.isOutdated).toBe(false);
    expect((await calls.calls.insights.list(f.ctx, recording.id)).map((i) => i.id)).toEqual([updated.id, insightId]);

    // Unparseable answers fail the insight on the last attempt.
    llm.when((r) => r.purpose === 'call-insight', { text: 'no json here' }, { times: 1 });
    const broken = await calls.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id });
    expect(broken).toMatchObject({ status: 'failed', error: 'The model answer could not be read', sections: [] });
    // Every generation is workspace spend in the credits ledger, attributed to the member who asked.
    const { rows: ledger } = await sql<{ source: string; member_id: string | null; spend: string }>`
      SELECT source, member_id::text, spend FROM credit_ledger WHERE workspace_id = ${f.workspaceId}::uuid
      ORDER BY created_at`.execute(database.kysely);
    expect(new Set(ledger.map((r) => r.source))).toEqual(
      new Set(['call-summary', 'insight-template-preview', 'call-insight']),
    );
    expect(ledger.filter((r) => r.source === 'call-insight').every((r) => r.member_id === f.memberId)).toBe(true);
    expect(ledger.every((r) => r.spend === 'workspace')).toBe(true);

    // Cost guard: a spent workspace pool refuses new generations (CREDITS_EXHAUSTED) and fails new summaries.
    await sql`UPDATE workspaces SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{capabilities}',
      ${JSON.stringify({ quotas: { workflow_credits_per_month_hard: 1 } })}::jsonb)
      WHERE id = ${f.workspaceId}::uuid`.execute(database.kysely);
    await expectCode(
      calls.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id }),
      'CREDITS_EXHAUSTED',
      402,
    );
    const starved = await calls.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f).slice(0, 3),
    });
    expect(await calls.calls.get(f.ctx, starved.id)).toMatchObject({
      status: 'completed',
      summaryStatus: 'failed',
      processingError: 'CREDITS_EXHAUSTED',
    });
    // Without an LLM the request is refused up front.
    await expectCode(
      plain.calls.insights.generate(f.ctx, { recordingId: recording.id, templateId: t.id }),
      'AI_NOT_CONFIGURED',
      503,
    );
  });

  it('jobs: generation is queued; the default template is applied to new calls of its members', async () => {
    const f = await callFixture('Default template call');
    const jobs = new RecordingJobQueue();
    const fake = fakeCallsLlm();
    const withJobs = createDomain({ database, storage, jobs, llm: fake });
    const t = await templateWithSections(f, 'Sales');
    await calls.insightTemplates.publish(f.ctx, t.id);

    // Only published templates can be the default; Bob (not in the meeting) has one too.
    const draftOnly = newId();
    await calls.insightTemplates.create(f.ctx, { id: draftOnly, title: 'Draft only' });
    await expectCode(
      calls.calls.settings.update(f.ctx, { defaultInsightTemplateId: draftOnly }),
      'VALIDATION_ERROR',
      400,
    );
    expect(await calls.calls.settings.update(f.ctx, { defaultInsightTemplateId: t.id })).toEqual({
      memberId: f.memberId,
      defaultInsightTemplateId: t.id,
    });
    const bob = await addMember(f, 'Bob');
    await calls.calls.settings.update(bob.ctx, { defaultInsightTemplateId: t.id });

    const recording = await withJobs.meetings.recordings.create(f.ctx, {
      id: newId(),
      meetingId: f.meetingId,
      transcript: transcript(f),
    });
    const [processJob] = jobs.take('calls.process');
    expect(processJob?.data).toEqual({ workspaceId: f.workspaceId, recordingId: recording.id });
    const processed = await withJobs.calls.process(f.workspaceId, recording.id);
    expect(processed.insightIds).toHaveLength(1);
    const [generateJob] = jobs.take('calls.generate');
    expect(generateJob?.data).toEqual({ workspaceId: f.workspaceId, kind: 'insight', id: processed.insightIds[0] });
    let detail = await withJobs.calls.get(f.ctx, recording.id);
    expect(detail.defaultInsightTemplateId).toBe(t.id);
    expect(detail.insights.map((i) => [i.templateId, i.status])).toEqual([[t.id, 'queued']]);
    expect(await withJobs.calls.generate(f.workspaceId, 'insight', processed.insightIds[0] as string)).toBe(
      'completed',
    );
    detail = await withJobs.calls.get(f.ctx, recording.id);
    expect(detail.insights[0]).toMatchObject({ status: 'completed', creditCost: 1 });
    // Paid by the workspace (no member) — the system applied it.
    const { rows } = await sql<{ requested_by_member_id: string | null }>`
      SELECT requested_by_member_id FROM call_insights WHERE id = ${processed.insightIds[0]}::uuid`.execute(
      database.kysely,
    );
    expect(rows[0]?.requested_by_member_id).toBeNull();

    // Archiving clears the defaults.
    await calls.insightTemplates.update(f.ctx, { templateId: t.id, archived: true });
    expect((await calls.calls.settings.get(f.ctx)).defaultInsightTemplateId).toBeNull();
  });
});
