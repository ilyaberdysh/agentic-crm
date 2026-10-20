// Credits as a cost guard (C.4 #14, B.14; ask-agentic §11, internals §7.6): one ledger of AI spend per member and
// workspace, monthly allowances from the capability quotas, and the check that stops AI work with 402
// CREDITS_EXHAUSTED. No purchase flow.
//
//   Seat credits    quota workspace_membership_credits_per_month_hard per member (null = unlimited).
//   Workspace pool  quota workflow_credits_per_month_hard, shared by workflows (workflow_credit_usage, slice 8), AI
//                   attributes, call processing and members whose seat credits ran out.
//   Ask limit       workspace_ai_settings.ask_workspace_credits_limit caps the members' share of the pool.
//
// Two kinds of spend:
//   'ask'        a member's own AI use (Ask Agentic turns, record summaries, formula and prompt generation): seat
//                credits first, then the pool (up to the Ask limit). Out of credits ⇔ both are used up.
//   'workspace'  automations (AI attributes, workflow AI blocks via workflow_credit_usage, call summaries and
//                insights): the pool only.
// Periods are calendar months in UTC. Owners of other AI features call `creditOps.assertAvailable` before the LLM
// call and `creditOps.charge` with the usage after it (same transaction as the result they write).
import {
  type CreditLedgerEntry,
  type CreditsLedgerInput,
  type CreditsLedgerOutput,
  type CreditsUsage,
  type CreditsUsageInput,
  creditsLedgerInputSchema,
  creditsUsageInputSchema,
} from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { capabilityOps } from '../../capabilities.ts';
import { actingMemberId } from '../../context.ts';
import { DomainError } from '../../errors.ts';
import { newId } from '../../ids.ts';
import { isAdminCaller } from '../../permissions/admin.ts';
import type { Tx } from '../../tx.ts';
import { creditsFor, type LlmUsage, requireKnownCost } from '../llm.ts';

export type CreditSpend = 'ask' | 'workspace';

export interface CreditChargeInput {
  /** What spent: ask-turn, record-summary, ai-attribute, call-summary, call-insight, formula, prompt-generate, … */
  source: string;
  /** The member the spend belongs to (required for 'ask' spend). */
  memberId: string | null;
  spend: CreditSpend;
  /** Provider usage (tokens, cost); credits default to creditsFor(usage.microUsd). */
  usage?: LlmUsage | null;
  /** Explicit credits (e.g. 1 per AI attribute value). */
  credits?: number;
  /** The thing paid for (turn, record, attribute value, call recording…). */
  ref?: { type: string; id: string } | null;
}

export interface CreditBalance {
  period: { start: string; end: string };
  memberLimit: number | null;
  memberSeatUsed: number;
  memberWorkspaceUsed: number;
  workspaceLimit: number | null;
  workspaceUsed: number;
  askLimit: number | null;
  askUsed: number;
  /** Seat credits left (Infinity when unlimited). */
  memberRemaining: number;
  /** Pool credits left for Ask Agentic spend (Infinity when unlimited). */
  askPoolRemaining: number;
  /** Pool credits left for automations. */
  poolRemaining: number;
}

export const creditsExhausted = (message: string, details: Record<string, unknown> = {}) =>
  new DomainError(402, 'CREDITS_EXHAUSTED', message, details);

/** The calendar month (UTC) containing `now`, or the one before. */
export function creditPeriod(now: string | Date, which: 'current' | 'previous' = 'current') {
  const d = new Date(now);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (which === 'previous' ? 1 : 0), 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

const num = (v: unknown) => Number(v ?? 0);
const remaining = (limit: number | null, used: number) => (limit === null ? Number.POSITIVE_INFINITY : limit - used);

async function askLimitOf(tx: Tx): Promise<number | null> {
  const row = await tx.db
    .selectFrom('workspace_ai_settings')
    .select('ask_workspace_credits_limit')
    .where('workspace_id', '=', tx.workspaceId)
    .executeTakeFirst();
  return row?.ask_workspace_credits_limit ?? null;
}

async function balanceAt(
  tx: Tx,
  memberId: string | null,
  period: { start: string; end: string },
): Promise<CreditBalance> {
  const { rows } = await sql<{
    seat: string | null;
    member_ws: string | null;
    ask_ws: string | null;
    ws_ledger: string | null;
    workflows: string | null;
  }>`
    SELECT
      (SELECT sum(credits) FROM credit_ledger WHERE created_at >= ${period.start}::timestamptz
         AND created_at < ${period.end}::timestamptz AND pool = 'member' AND member_id = ${memberId}::uuid) AS seat,
      (SELECT sum(credits) FROM credit_ledger WHERE created_at >= ${period.start}::timestamptz
         AND created_at < ${period.end}::timestamptz AND pool = 'workspace' AND spend = 'ask'
         AND member_id = ${memberId}::uuid) AS member_ws,
      (SELECT sum(credits) FROM credit_ledger WHERE created_at >= ${period.start}::timestamptz
         AND created_at < ${period.end}::timestamptz AND pool = 'workspace' AND spend = 'ask') AS ask_ws,
      (SELECT sum(credits) FROM credit_ledger WHERE created_at >= ${period.start}::timestamptz
         AND created_at < ${period.end}::timestamptz AND pool = 'workspace') AS ws_ledger,
      (SELECT sum(amount) FROM workflow_credit_usage WHERE created_at >= ${period.start}::timestamptz
         AND created_at < ${period.end}::timestamptz) AS workflows`.execute(tx.db);
  const r = rows[0];
  const memberLimit = await capabilityOps.quota(tx, 'workspace_membership_credits_per_month_hard');
  const workspaceLimit = await capabilityOps.quota(tx, 'workflow_credits_per_month_hard');
  const askLimit = await askLimitOf(tx);
  const memberSeatUsed = num(r?.seat);
  const askUsed = num(r?.ask_ws);
  const workspaceUsed = Math.ceil(num(r?.ws_ledger) + num(r?.workflows));
  const poolRemaining = remaining(workspaceLimit, workspaceUsed);
  return {
    period,
    memberLimit,
    memberSeatUsed,
    memberWorkspaceUsed: num(r?.member_ws),
    workspaceLimit,
    workspaceUsed,
    askLimit,
    askUsed,
    memberRemaining: memberId ? remaining(memberLimit, memberSeatUsed) : 0,
    askPoolRemaining: Math.min(remaining(askLimit, askUsed), poolRemaining),
    poolRemaining,
  };
}

export const creditOps = {
  period: creditPeriod,

  async balance(tx: Tx, memberId: string | null): Promise<CreditBalance> {
    return balanceAt(tx, memberId, creditPeriod(tx.now));
  },

  /** Throws 402 CREDITS_EXHAUSTED when the spend cannot start (checked before the LLM call). */
  async assertAvailable(tx: Tx, input: { memberId: string | null; spend: CreditSpend }): Promise<CreditBalance> {
    const b = await creditOps.balance(tx, input.spend === 'ask' ? input.memberId : null);
    if (input.spend === 'ask' && input.memberId) {
      if (b.memberRemaining <= 0 && b.askPoolRemaining <= 0) {
        throw creditsExhausted("You've reached your credit limit", {
          member_limit: b.memberLimit,
          ask_limit: b.askLimit,
          workspace_limit: b.workspaceLimit,
        });
      }
      return b;
    }
    if (b.poolRemaining <= 0) {
      throw creditsExhausted('The workspace has used its monthly credits', { workspace_limit: b.workspaceLimit });
    }
    return b;
  },

  /**
   * Records a spend (in the caller's transaction) and invalidates the usage counters. 'ask' spend uses the seat
   * credits while any are left, then the workspace pool. Zero-credit charges are not recorded.
   */
  async charge(tx: Tx, input: CreditChargeInput): Promise<{ entryId: string | null; credits: number; pool: string }> {
    const microUsd = input.usage ? requireKnownCost(input.usage.microUsd) : 0;
    const credits = Math.max(0, Math.ceil(input.credits ?? creditsFor(microUsd)));
    const spend: CreditSpend = input.spend === 'ask' && input.memberId ? 'ask' : 'workspace';
    if (credits === 0) return { entryId: null, credits: 0, pool: spend === 'ask' ? 'member' : 'workspace' };
    let pool: 'member' | 'workspace' = 'workspace';
    if (spend === 'ask') {
      const b = await creditOps.balance(tx, input.memberId);
      pool = b.memberRemaining > 0 ? 'member' : 'workspace';
    }
    const id = newId();
    const u = input.usage;
    await tx.db
      .insertInto('credit_ledger')
      .values({
        id,
        workspace_id: tx.workspaceId,
        member_id: input.memberId,
        pool,
        spend,
        source: input.source,
        credits,
        micro_usd: microUsd,
        model: u?.model || null,
        input_tokens: u?.inputTokens ?? 0,
        output_tokens: u?.outputTokens ?? 0,
        cache_read_tokens: u?.cacheReadTokens ?? 0,
        cache_write_tokens: u?.cacheWriteTokens ?? 0,
        web_search_requests: u?.webSearchRequests ?? 0,
        ref_type: input.ref?.type ?? null,
        ref_id: input.ref?.id ?? null,
      })
      .execute();
    tx.emit('credit-usage', null, { source: input.source, memberId: input.memberId });
    return { entryId: id, credits, pool };
  },

  /** credits.usage: the caller's counters, the workspace pool, spend by source, and (admins) per member. */
  async usage(tx: Tx, input?: CreditsUsageInput): Promise<CreditsUsage> {
    const data = creditsUsageInputSchema.parse(input);
    const period = creditPeriod(tx.now, data?.period ?? 'current');
    const me = actingMemberId(tx.ctx);
    const b = await balanceAt(tx, me, period);
    const { rows: bySource } = await sql<{ source: string; credits: string }>`
      SELECT source, sum(credits)::text AS credits FROM (
        SELECT source, credits::numeric FROM credit_ledger
          WHERE created_at >= ${period.start}::timestamptz AND created_at < ${period.end}::timestamptz
        UNION ALL
        SELECT 'workflow-block-execution', amount FROM workflow_credit_usage
          WHERE created_at >= ${period.start}::timestamptz AND created_at < ${period.end}::timestamptz
      ) s GROUP BY source ORDER BY source`.execute(tx.db);
    let members: CreditsUsage['members'] = null;
    if (await isAdminCaller(tx)) {
      const { rows } = await sql<{ member_id: string; seat: string; ws: string }>`
        SELECT member_id::text,
               coalesce(sum(credits) FILTER (WHERE pool = 'member'), 0)::text AS seat,
               coalesce(sum(credits) FILTER (WHERE pool = 'workspace'), 0)::text AS ws
        FROM credit_ledger
        WHERE created_at >= ${period.start}::timestamptz AND created_at < ${period.end}::timestamptz
          AND spend = 'ask' AND member_id IS NOT NULL
        GROUP BY member_id ORDER BY member_id`.execute(tx.db);
      members = rows.map((r) => ({
        memberId: r.member_id,
        seatUsed: num(r.seat),
        workspaceUsed: num(r.ws),
        limitReached: b.memberLimit !== null && num(r.seat) >= b.memberLimit,
      }));
    }
    const outOfCredits = me !== null && b.memberRemaining <= 0 && b.askPoolRemaining <= 0;
    return {
      period,
      member: { used: b.memberSeatUsed, limit: b.memberLimit, workspaceUsed: b.memberWorkspaceUsed },
      workspace: {
        used: b.workspaceUsed,
        limit: b.workspaceLimit,
        askUsed: b.askUsed,
        askLimit: b.askLimit,
        otherSourcesUsed: Math.max(0, b.workspaceUsed - b.askUsed),
      },
      bySource: bySource.map((r) => ({ source: r.source, credits: Math.ceil(num(r.credits)) })),
      outOfCredits,
      members,
    };
  },

  /** credits.ledger: newest first; members see their own rows, admins every row (workflow block spend included). */
  async ledger(tx: Tx, input?: CreditsLedgerInput): Promise<CreditsLedgerOutput> {
    const data = creditsLedgerInputSchema.parse(input) ?? {};
    const limit = data.limit ?? 50;
    const admin = await isAdminCaller(tx);
    const me = actingMemberId(tx.ctx);
    const memberFilter = admin ? (data.memberId ?? null) : me;
    let after: { at: string; id: string } | null = null;
    if (data.cursor) {
      try {
        const [at, id] = Buffer.from(data.cursor, 'base64url').toString('utf8').split('|');
        if (at && id) after = { at, id };
      } catch {
        after = null;
      }
    }
    const includeWorkflows = admin && memberFilter === null;
    const { rows } = await sql<{
      id: string;
      source: string;
      pool: 'member' | 'workspace';
      credits: string;
      member_id: string | null;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      ref_type: string | null;
      ref_id: string | null;
      created_at: string;
    }>`
      SELECT * FROM (
        SELECT id, source, pool, credits::numeric AS credits, member_id, model, input_tokens, output_tokens, ref_type,
               ref_id::text AS ref_id, created_at
        FROM credit_ledger
        WHERE (${memberFilter}::uuid IS NULL OR member_id = ${memberFilter}::uuid)
        UNION ALL
        SELECT id, 'workflow-block-execution', 'workspace', amount, NULL, NULL, 0, 0, 'workflow-run', run_id::text,
               created_at
        FROM workflow_credit_usage WHERE ${includeWorkflows}
      ) l
      WHERE ${after === null} OR (l.created_at, l.id) < (${after?.at ?? null}::timestamptz, ${after?.id ?? null}::uuid)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ${limit + 1}`.execute(tx.db);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const entries: CreditLedgerEntry[] = page.map((r) => ({
      id: r.id,
      source: r.source,
      pool: r.pool,
      credits: Math.ceil(num(r.credits)),
      memberId: r.member_id,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      refType: r.ref_type,
      refId: r.ref_id,
      createdAt: r.created_at,
    }));
    return {
      entries,
      nextCursor:
        rows.length > limit && last ? Buffer.from(`${last.created_at}|${last.id}`, 'utf8').toString('base64url') : null,
    };
  },
};
