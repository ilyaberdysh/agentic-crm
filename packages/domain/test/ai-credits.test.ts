// Credits ledger and budgets (slice 10 acceptance 6, ledger part; C.4 #14): seat credits first, spill into the
// workspace pool up to the admin's Ask Agentic limit, automations use the pool, 402 CREDITS_EXHAUSTED when used up,
// usage counters and the ledger (members see their own rows, admins all).
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { creditOps } from '../src/ai/credits/ledger.ts';
import { FakeLlm } from '../src/ai/llm.ts';
import { createDomain, memberContext } from '../src/index.ts';
import { runInWorkspace } from '../src/tx.ts';
import { createUser, createWorkspace, database, expectCode, storage } from './support/harness.ts';

const ai = createDomain({ database, storage, llm: new FakeLlm() });

async function setQuotas(workspaceId: string, quotas: Record<string, number | null>) {
  await sql`UPDATE workspaces SET settings = jsonb_set(settings, '{capabilities}', ${JSON.stringify({ quotas })}::jsonb)
    WHERE id = ${workspaceId}`.execute(database.kysely);
}

async function addMember(ws: Awaited<ReturnType<typeof createWorkspace>>) {
  const user = await createUser('Grace', 'Hopper');
  const id = crypto.randomUUID();
  await database.kysely
    .insertInto('workspace_members')
    .values({
      id,
      workspace_id: ws.workspaceId,
      user_id: user.userId,
      access_level: 'member',
      email_address: user.emailAddress,
      first_name: 'Grace',
      last_name: 'Hopper',
    })
    .execute();
  return { memberId: id, ctx: memberContext(ws.workspaceId, id) };
}

describe('credits', () => {
  it('uses seat credits first, then the workspace pool, then refuses', async () => {
    const ws = await createWorkspace();
    await setQuotas(ws.workspaceId, {
      workspace_membership_credits_per_month_hard: 10,
      workflow_credits_per_month_hard: 30,
    });
    await ai.ai.workspaceSettings.update(ws.ctx, { askWorkspaceCreditsLimit: 8 });
    const charge = (credits: number, source = 'ask-turn') =>
      runInWorkspace(database, ws.ctx, async (tx) => {
        await creditOps.assertAvailable(tx, { memberId: ws.memberId, spend: 'ask' });
        return creditOps.charge(tx, { source, memberId: ws.memberId, spend: 'ask', credits });
      });

    expect(await charge(6)).toMatchObject({ credits: 6, pool: 'member' });
    expect(await charge(6)).toMatchObject({ pool: 'member' }); // 12 > 10: last seat charge may overshoot
    expect(await charge(5)).toMatchObject({ pool: 'workspace' });
    expect(await charge(5)).toMatchObject({ pool: 'workspace' }); // 10 ≥ ask limit 8
    await expectCode(charge(1), 'CREDITS_EXHAUSTED', 402);

    // Automations still have the pool (30 − 10).
    await runInWorkspace(database, ws.sys, async (tx) => {
      await creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' });
      await creditOps.charge(tx, { source: 'ai-attribute', memberId: null, spend: 'workspace', credits: 20 });
    });
    await expectCode(
      runInWorkspace(database, ws.sys, (tx) => creditOps.assertAvailable(tx, { memberId: null, spend: 'workspace' })),
      'CREDITS_EXHAUSTED',
      402,
    );

    const usage = await ai.credits.usage(ws.ctx);
    expect(usage.member).toEqual({ used: 12, limit: 10, workspaceUsed: 10 });
    expect(usage.workspace).toMatchObject({ used: 30, limit: 30, askUsed: 10, askLimit: 8, otherSourcesUsed: 20 });
    expect(usage.outOfCredits).toBe(true);
    expect(usage.bySource).toEqual([
      { source: 'ai-attribute', credits: 20 },
      { source: 'ask-turn', credits: 22 },
    ]);
    expect(usage.members).toEqual([{ memberId: ws.memberId, seatUsed: 12, workspaceUsed: 10, limitReached: true }]);
  });

  it('pages the ledger; members see only their own rows', async () => {
    const ws = await createWorkspace();
    const other = await addMember(ws);
    for (let i = 0; i < 3; i++) {
      await runInWorkspace(database, ws.ctx, (tx) =>
        creditOps.charge(tx, {
          source: 'ask-turn',
          memberId: ws.memberId,
          spend: 'ask',
          usage: {
            model: 'claude-opus-5-5',
            inputTokens: 1000,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            webSearchRequests: 0,
            microUsd: 6000,
          },
          ref: { type: 'ai-turn', id: crypto.randomUUID() },
        }),
      );
    }
    await runInWorkspace(database, other.ctx, (tx) =>
      creditOps.charge(tx, { source: 'record-summary', memberId: other.memberId, spend: 'ask', credits: 2 }),
    );
    const first = await ai.credits.ledger(ws.ctx, { limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.entries[0]).toMatchObject({ source: 'record-summary', credits: 2 });
    expect(first.nextCursor).not.toBeNull();
    const second = await ai.credits.ledger(ws.ctx, { limit: 2, cursor: first.nextCursor as string });
    expect(second.entries).toHaveLength(2);
    expect(second.entries.every((e) => e.credits === 1 && e.model === 'claude-opus-5-5')).toBe(true);
    expect(second.nextCursor).toBeNull();
    const mine = await ai.credits.ledger(other.ctx);
    expect(mine.entries.map((e) => e.source)).toEqual(['record-summary']);
    const usage = await ai.credits.usage(other.ctx);
    expect(usage.member.used).toBe(2);
    expect(usage.members).toBeNull();
  });
});
