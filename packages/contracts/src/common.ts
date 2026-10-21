// Shared primitives for every internal contract. Internal contracts use camelCase keys (ARCHITECTURE D-04:
// Internal shapes define semantics, not the wire format); /v2 adapters map to snake_case.
import { z } from 'zod';
import { isValidRank } from './rank.ts';

/** RFC 9562 UUID. Client-minted ids for creates are UUIDv7 (I3); other versions are accepted for imports/tools. */
export const uuidSchema = z.uuid();
/** ISO-8601 timestamp with offset; the server answers with microsecond precision in UTC ('…T12:00:00.123456Z'). */
export const timestampSchema = z.iso.datetime({ offset: true });
export const dateSchema = z.iso.date();
/** Fractional-index rank over 0-9a-z (decision X-01, see rank.ts). */
export const rankSchema = z.string().max(256).refine(isValidRank, 'Invalid rank: expected [0-9a-z]+ not ending in 0');
/** An entity definition or attribute definition reference: its UUID or its api_slug. */
export const idOrSlugSchema = z.string().min(1).max(128);

export const actorTypes = [
  'workspace-member',
  'api-token',
  'system',
  'workflow',
  'app',
  'ai-autofill-attribute',
  'formula-attribute',
  'enrichment-provider',
  'comint',
  'workflow-run',
  'import',
] as const;
export const actorTypeSchema = z.enum(actorTypes);
export type ActorType = z.infer<typeof actorTypeSchema>;

/** Who did something. For `system` the id may be a reason string ('workspace-creation') or null. */
export const actorSchema = z.object({ type: actorTypeSchema, id: z.string().nullable() });
export type Actor = z.infer<typeof actorSchema>;

/** One hop of an attribute path; multi-hop paths traverse record references (max 5 hops). */
export const pathHopSchema = z.object({ entityDefinitionId: uuidSchema, attributeDefinitionId: uuidSchema });
export const pathSchema = z.array(pathHopSchema).min(1).max(5);
export type PathHop = z.infer<typeof pathHopSchema>;
export type Path = z.infer<typeof pathSchema>;

/** Batch read results: one tagged entry per requested id (A internal-api-shapes §1.1). */
export type Result<T> = { state: 'complete'; value: T } | { state: 'error'; error: string };
export const resultSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('state', [
    z.object({ state: z.literal('complete'), value }),
    z.object({ state: z.literal('error'), error: z.string() }),
  ]);

/**
 * Read-your-writes token accepted by every read (the change_log seq from an invalidation). All reads are served
 * from the primary, so it is accepted and needs no waiting today.
 */
export const acceptAfterSchema = z.string().regex(/^\d+$/).optional();
