// The admin rule (OQ-067, slice6-contracts.md): workspace-admin actions — members, teams, workspace settings,
// developers (tokens, webhooks) — are admin-only; admins can always manage grants but do not bypass them for data.
// System actors (CLI, seed, workers) are trusted callers; API tokens are not admins.
import { permissionMemberId } from '../context.ts';
import { forbidden } from '../errors.ts';
import type { Tx } from '../tx.ts';

/** The calling member's access level (null for non-member actors). Memoised per transaction. */
export async function callerAccessLevel(tx: Tx): Promise<'admin' | 'member' | 'suspended' | null> {
  const memberId = permissionMemberId(tx.ctx);
  if (!memberId) return null;
  const key = `access-level:${memberId}`;
  if (tx.memo.has(key)) return tx.memo.get(key) as 'admin' | 'member' | 'suspended' | null;
  const row = await tx.db
    .selectFrom('workspace_members')
    .select('access_level')
    .where('id', '=', memberId)
    .executeTakeFirst();
  const level = row?.access_level ?? 'suspended';
  tx.memo.set(key, level);
  return level;
}

/** Admin members, and the system actor. */
export async function isAdminCaller(tx: Tx): Promise<boolean> {
  if (tx.ctx.actor.type === 'system') return true;
  return (await callerAccessLevel(tx)) === 'admin';
}

/** Throws 403 unless the caller is an admin member or the system. */
export async function requireAdminCaller(tx: Tx, message = 'Only workspace admins can do this'): Promise<void> {
  if (!(await isAdminCaller(tx))) throw forbidden(message);
}
