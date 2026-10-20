// Prompts library (curated catalogue, defaults saved per member, custom prompts with AI metadata, generation,
// sharing levels, prompt chips in turns), Ask Agentic settings and models, and the AI record summary (cached, stale
// after a record change, regenerated with credits).
import { describe, expect, it } from 'vitest';
import { createDomain, FakeLlm, type LlmRequest, lastUserText } from '../src/index.ts';
import { addMember, collabFixture } from './collab-fixtures.ts';
import { database, expectCode, newId, storage } from './support/harness.ts';

const fake = new FakeLlm();
const ai = createDomain({ database, storage, llm: fake });

describe('prompts library', () => {
  it('saves the default curated prompts, creates, generates, shares and inserts prompts', async () => {
    const fx = await collabFixture();
    const mine = await ai.prompts.list(fx.ctx);
    expect(mine.prompts.map((p) => p.id)).toEqual(['daily-brief', 'follow-up-email', 'meeting-prep']);
    const gallery = await ai.prompts.list(fx.ctx, { scope: 'curated', category: 'sales' });
    expect(gallery.prompts.length).toBeGreaterThan(5);
    expect(gallery.prompts.every((p) => p.categories.includes('sales'))).toBe(true);
    await ai.prompts.save(fx.ctx, 'deal-brief');
    await ai.prompts.unsave(fx.ctx, 'daily-brief');
    expect((await ai.prompts.list(fx.ctx)).prompts.map((p) => p.id)).toEqual([
      'follow-up-email',
      'meeting-prep',
      'deal-brief',
    ]);
    expect((await ai.prompts.get(fx.ctx, 'deal-brief')).savedCount).toBe(1);

    // "Advanced": the AI metadata is filled after the save.
    fake.when((r) => r.purpose === 'prompt-metadata', {
      json: {
        title: 'Project digest',
        summary: 'Digest of projects',
        icon: 'pie-chart',
        color: 'blue',
        targets: ['entity-instance-list'],
      },
    });
    const created = await ai.prompts.create(fx.ctx, {
      mode: 'manual',
      title: '[seed] Project status digest',
      prompt: 'Summarize every project by phase and owner.',
    });
    expect(created).toMatchObject({
      kind: 'custom',
      title: '[seed] Project status digest',
      aiTitle: 'Project digest',
      summary: 'Digest of projects',
      iconId: 'pie-chart',
      targets: ['entity-instance-list'],
      access: 'full-access',
    });

    // "Generate": a transient draft, hidden until saved.
    fake.when((r) => r.purpose === 'prompt-generate', {
      json: {
        title: 'Weekly pipeline',
        prompt: '**Context**\nPipeline\n\n**Task**\nReview\n\n**Constraints**\n- Short',
      },
    });
    const generated = await ai.prompts.create(fx.ctx, { mode: 'generate', description: 'weekly pipeline review' });
    expect(generated.title).toBe('Weekly pipeline');
    expect((await ai.prompts.list(fx.ctx)).prompts.some((p) => p.id === generated.id)).toBe(false);
    await ai.prompts.update(fx.ctx, { promptId: generated.id, title: 'Weekly pipeline review' });
    expect((await ai.prompts.list(fx.ctx)).prompts.some((p) => p.id === generated.id)).toBe(true);

    // Sharing: workspace read-only by default; per-member levels; no-access hides it.
    const bob = await addMember(fx, 'Bob');
    expect((await ai.prompts.list(bob.ctx, { scope: 'shared' })).prompts.map((p) => p.id)).toContain(created.id);
    await expectCode(ai.prompts.update(bob.ctx, { promptId: created.id, title: 'x' }), 'FORBIDDEN', 403);
    await ai.prompts.share(fx.ctx, {
      promptId: created.id,
      workspaceAccess: 'no-access',
      members: [{ memberId: bob.memberId, access: 'read-write' }],
    });
    await ai.prompts.update(bob.ctx, { promptId: created.id, title: 'Renamed by Bob' });
    const sharing = await ai.prompts.sharing(fx.ctx, created.id);
    expect(sharing).toMatchObject({ workspaceAccess: 'no-access' });
    expect(sharing.members).toEqual([
      { memberId: fx.memberId, access: 'full-access' },
      { memberId: bob.memberId, access: 'read-write' },
    ]);
    await expectCode(ai.prompts.delete(bob.ctx, created.id), 'FORBIDDEN', 403);
    await ai.prompts.share(fx.ctx, {
      promptId: created.id,
      members: [{ memberId: bob.memberId, access: 'no-access' }],
    });
    await expectCode(ai.prompts.get(bob.ctx, created.id), 'NOT_FOUND', 404);

    // A prompt chip sends the prompt body with the turn.
    fake.when((r) => r.purpose === 'ask' && lastUserText(r).includes('Summarize every project'), { text: 'ok' });
    const turnId = newId();
    await ai.ai.turns.send(fx.ctx, {
      threadId: newId(),
      turnId,
      content: '/digest',
      annotations: [{ type: 'prompt', start: 0, length: 7, promptId: created.id }],
    });
    await ai.ai.turns.settled(turnId);
    expect((await ai.ai.turns.get(fx.ctx, turnId)).status).toBe('completed');
    await ai.prompts.delete(fx.ctx, created.id);
    expect((await ai.prompts.list(fx.ctx)).prompts.some((p) => p.id === created.id)).toBe(false);
  });
});

describe('Ask Agentic settings and models', () => {
  it('reads and updates member and workspace settings; models reflect the workspace override', async () => {
    const fx = await collabFixture();
    expect(await ai.ai.settings.get(fx.ctx)).toEqual({
      memberId: fx.memberId,
      allowWebSearch: 'always-ask',
      shareThreadFeedback: 'always-ask',
      defaultModel: null,
      customContext: null,
    });
    await ai.ai.settings.update(fx.ctx, { defaultModel: 'claude-sonnet-5-5', customContext: 'I sell anvils.' });
    await expectCode(ai.ai.settings.update(fx.ctx, { defaultModel: 'gpt-6' }), 'VALIDATION_ERROR', 400);
    const ws = await ai.ai.workspaceSettings.update(fx.ctx, {
      customContext: 'We are mymeet.',
      models: { ask: 'claude-sonnet-5-5' },
    });
    expect(ws).toEqual({
      customContext: 'We are mymeet.',
      askWorkspaceCreditsLimit: null,
      models: { ask: 'claude-sonnet-5-5', bulk: null, fast: null },
    });
    const bob = await addMember(fx, 'Bob');
    await expectCode(ai.ai.workspaceSettings.update(bob.ctx, { customContext: 'x' }), 'FORBIDDEN', 403);
    const models = await ai.ai.models.list(fx.ctx);
    expect(models.configured).toBe(true);
    expect(models.models.find((m) => m.isAuto)?.id).toBe('claude-sonnet-5-5');

    // Context reaches the model in the per-member system block; the member's default model is used.
    fake.when((r) => r.purpose === 'ask' && lastUserText(r).includes('[ctx]'), { text: 'ok' });
    const turnId = newId();
    await ai.ai.turns.send(fx.ctx, { threadId: newId(), turnId, content: '[ctx] hi' });
    await ai.ai.turns.settled(turnId);
    const req = fake.calls.filter((r: LlmRequest) => r.purpose === 'ask' && lastUserText(r).includes('[ctx]'))[0];
    expect(JSON.stringify(req?.system)).toContain('We are mymeet.');
    expect(JSON.stringify(req?.system)).toContain('I sell anvils.');
    expect(req?.model).toBe('claude-sonnet-5-5');
    expect((await ai.ai.turns.get(fx.ctx, turnId)).modelMode).toBe('manual');
  });
});

describe('AI record summary', () => {
  it('generates, caches, goes stale on a record change and regenerates', async () => {
    const fx = await collabFixture();
    expect(await ai.recordSummaries.get(fx.ctx, { recordRef: fx.record })).toEqual({ ...fx.record, summary: null });
    fake.when(
      (r) => r.purpose === 'record-summary',
      (r) => ({
        text: `Acme summary #${fake.callsFor('record-summary').length} (${lastUserText(r).includes('"Acme"') ? 'with values' : 'empty'})`,
      }),
    );
    const first = await ai.recordSummaries.regenerate(fx.ctx, {
      recordRef: { entityDefinitionId: 'companies', entityInstanceId: fx.company },
    });
    expect(first.summary).toMatchObject({
      text: 'Acme summary #1 (with values)',
      stale: false,
      model: 'claude-sonnet-5-5',
    });
    expect(first.summary?.creditCost).toBeGreaterThanOrEqual(1);
    expect((await ai.recordSummaries.get(fx.ctx, { recordRef: fx.record })).summary?.stale).toBe(false);

    await ai.records.update(fx.ctx, { ...fx.record, values: { description: [{ value: 'Anvils and more' }] } });
    expect((await ai.recordSummaries.get(fx.ctx, { recordRef: fx.record })).summary).toMatchObject({
      text: 'Acme summary #1 (with values)',
      stale: true,
    });
    const second = await ai.recordSummaries.regenerate(fx.ctx, { recordRef: fx.record });
    expect(second.summary).toMatchObject({ text: 'Acme summary #2 (with values)', stale: false });
    const usage = await ai.credits.usage(fx.ctx);
    expect(usage.bySource.find((s) => s.source === 'record-summary')?.credits).toBeGreaterThanOrEqual(2);
    await expectCode(
      ai.recordSummaries.get(fx.ctx, { recordRef: { entityDefinitionId: 'companies', entityInstanceId: newId() } }),
      'NOT_FOUND',
      404,
    );
  });
});
