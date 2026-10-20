// Permission hook call sites (BACKLOG 1.10, B.12): procedures check the resolved action policy of the acting member
// on the entity definition they touch, through the domain's policy service (I5: the same resolver backs every
// transport). Slice 1 resolves allow-all (full access for active members); the grant-based resolver will plug in
// behind the same call. Policies are memoised per request, so a batched tRPC call resolves each definition once.
import type { ActionFlag, ResolvedActionPolicy } from '@agentic-crm/contracts';
import { DomainError, type ServiceContext } from '@agentic-crm/domain';
import type { Context } from './trpc';

export type PolicyContext = Pick<Context, 'domain' | 'policies'> & { service: ServiceContext };

const memoKey = (ctx: PolicyContext, ref: string) => `${ctx.service.workspaceId}:${ref}`;

/** Resolved policies for several definitions (ids or api slugs); null for unknown definitions. */
export async function resolvePolicies(
  ctx: PolicyContext,
  refs: string[],
): Promise<Map<string, ResolvedActionPolicy | null>> {
  const out = new Map<string, ResolvedActionPolicy | null>();
  const missing: string[] = [];
  for (const ref of new Set(refs)) {
    const key = memoKey(ctx, ref);
    if (ctx.policies.has(key)) out.set(ref, ctx.policies.get(key) ?? null);
    else missing.push(ref);
  }
  for (let i = 0; i < missing.length; i += 500) {
    const batch = missing.slice(i, i + 500);
    const { policies } = await ctx.domain.policies.resolve(ctx.service, { entityDefinitionIds: batch });
    for (const ref of batch) {
      const entry = policies[ref];
      const value = entry?.state === 'complete' ? entry.value : null;
      ctx.policies.set(memoKey(ctx, ref), value);
      out.set(ref, value);
    }
  }
  return out;
}

/** Throws 404 for an unknown definition and 403 when the acting member may not perform `flag` on it. */
export async function assertCan(ctx: PolicyContext, entityDefinitionRef: string, flag: ActionFlag): Promise<void> {
  const policy = (await resolvePolicies(ctx, [entityDefinitionRef])).get(entityDefinitionRef) ?? null;
  if (!policy) {
    throw new DomainError(404, 'NOT_FOUND', 'The requested object could not be found', {
      entity_definition_id: entityDefinitionRef,
    });
  }
  if (!policy[flag]) {
    throw new DomainError(403, 'FORBIDDEN', 'You do not have permission to do this', {
      entity_definition_id: entityDefinitionRef,
      action: flag,
    });
  }
}

/** Keeps the items whose definition grants `flag` (list endpoints hide what the member cannot see). */
export async function filterAllowed<T>(
  ctx: PolicyContext,
  items: T[],
  definitionOf: (item: T) => string,
  flag: ActionFlag,
): Promise<T[]> {
  if (items.length === 0) return items;
  const policies = await resolvePolicies(ctx, items.map(definitionOf));
  return items.filter((item) => policies.get(definitionOf(item))?.[flag] === true);
}
