// The turn tree of a thread (ask-agentic-internals §2.3): turns link to their parents; a user turn's parent is the
// assistant turn it replies to; "try again" adds a sibling assistant turn under the same user turn. The view shows
// one path: from the root to the default leaf (the most recently created turn; ties go to the deeper one).
import type { AiTurn } from '@agentic-crm/contracts';

function depthOf(turn: AiTurn, byId: Map<string, AiTurn>): number {
  let depth = 0;
  let cur: AiTurn | undefined = turn;
  const seen = new Set<string>();
  while (cur?.parentTurnId && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentTurnId);
    depth++;
  }
  return depth;
}

/** The default leaf: newest by creation time, deeper first on ties. */
export function defaultLeaf(turns: readonly AiTurn[]): AiTurn | null {
  const byId = new Map(turns.map((t) => [t.id, t]));
  let best: AiTurn | null = null;
  let bestDepth = -1;
  for (const t of turns) {
    const d = depthOf(t, byId);
    if (!best || t.createdAt > best.createdAt || (t.createdAt === best.createdAt && d > bestDepth)) {
      best = t;
      bestDepth = d;
    }
  }
  return best;
}

/** Turns from the root to `leaf` (default: the default leaf), oldest first. */
export function linearize(turns: readonly AiTurn[], leafId?: string | null): AiTurn[] {
  const byId = new Map(turns.map((t) => [t.id, t]));
  const leaf = (leafId ? byId.get(leafId) : undefined) ?? defaultLeaf(turns);
  const path: AiTurn[] = [];
  const seen = new Set<string>();
  let cur: AiTurn | undefined = leaf ?? undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.push(cur);
    cur = cur.parentTurnId ? byId.get(cur.parentTurnId) : undefined;
  }
  return path.reverse();
}

/**
 * The persisted turns with live overrides (streaming snapshots) and optimistic turns (just sent, not persisted yet)
 * folded in.
 */
export function mergeTurns(
  persisted: readonly AiTurn[],
  live: ReadonlyMap<string, AiTurn>,
  optimistic: readonly AiTurn[],
): AiTurn[] {
  const out = persisted.map((t) => live.get(t.id) ?? t);
  const have = new Set(out.map((t) => t.id));
  for (const t of optimistic) {
    if (have.has(t.id)) continue;
    out.push(live.get(t.id) ?? t);
    have.add(t.id);
  }
  return out;
}

/** The assistant turn replies go under: the last assistant turn of the path (executing included). */
export function replyTarget(path: readonly AiTurn[]): AiTurn | null {
  for (let i = path.length - 1; i >= 0; i--) {
    const t = path[i];
    if (t?.role === 'assistant') return t;
  }
  return null;
}
