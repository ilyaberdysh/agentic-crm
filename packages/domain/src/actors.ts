// Actor encoding. Hot tables (entity_instances, attribute_values) store (type smallint, id uuid); cold tables store
// the actor as jsonb. Codes are fixed — see migrations/0200_data_engine.sql.
import type { Actor, ActorType } from '@agentic-crm/contracts';

const CODES: Record<ActorType, number> = {
  'workspace-member': 1,
  'api-token': 2,
  system: 3,
  workflow: 4,
  app: 5,
  'ai-autofill-attribute': 6,
  'formula-attribute': 7,
  'enrichment-provider': 8,
  comint: 9,
  'workflow-run': 10,
  import: 11,
};
const TYPES = Object.fromEntries(Object.entries(CODES).map(([t, c]) => [c, t])) as Record<number, ActorType>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function actorTypeCode(type: ActorType): number {
  return CODES[type];
}

/** Columns for a hot table. Non-UUID ids (system reasons) are not stored there. */
export function encodeActor(actor: Actor): { type: number; id: string | null } {
  return { type: CODES[actor.type], id: actor.id !== null && UUID_RE.test(actor.id) ? actor.id : null };
}

export function decodeActor(type: number | null, id: string | null): Actor | null {
  if (type === null) return null;
  return { type: TYPES[type] ?? 'system', id };
}

export function systemActor(reason: string | null = null): Actor {
  return { type: 'system', id: reason };
}

export function memberActor(memberId: string): Actor {
  return { type: 'workspace-member', id: memberId };
}
