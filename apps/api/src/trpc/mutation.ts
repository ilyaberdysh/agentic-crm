// Mutation responses carry the canonical server state plus `seq`: the change_log id of the write (null when nothing
// changed, e.g. an idempotent PUT replay). The client replaces its optimistic overlay with the canonical state; an
// invalidation for the same resource with `seq <= response.seq` is already reflected by that response (A I-7,
// internal-api-shapes §5, realtime I4a), anything newer is refetched with `acceptAfter`.

import { acceptAfterSchema } from '@agentic-crm/contracts';
import type { ServiceContext } from '@agentic-crm/domain';
import { z } from 'zod';

export interface WithSeq<T> {
  result: T;
  seq: string | null;
}

/** Runs one domain write with a fresh receipt and returns its result with the change_log seq it wrote. */
export async function withSeq<T>(
  service: ServiceContext,
  write: (svc: ServiceContext) => Promise<T>,
): Promise<WithSeq<T>> {
  const receipt: { seq: string | null } = { seq: null };
  const result = await write({ ...service, receipt });
  return { result, seq: receipt.seq };
}

/**
 * Read-your-writes token accepted by every query: the `seq` of an invalidation or of a mutation response, also
 * accepted as the `x-accept-after` header. Reads are served by the primary after that change committed, so no
 * waiting is needed today (a read replica would wait until it has replayed `acceptAfter`).
 */
export const acceptAfterInput = { acceptAfter: acceptAfterSchema };

/** Optional `{acceptAfter}` input for queries that take no other parameters. */
export const acceptAfterOnly = z.object(acceptAfterInput).optional();
