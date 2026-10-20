// Capabilities (BACKLOG 1.11, CROSS-DOMAIN B.13): feature flags and quotas. Internal product: every feature on, every
// quota unlimited except the data-model limits of contracts quotaDefaults (C.4 #7). Per-workspace overrides are read
// from workspaces.settings.capabilities (a null quota override keeps the default).
import {
  type Capabilities,
  type FeatureKey,
  featureKeys,
  type QuotaKey,
  quotaDefaults,
  quotaKeys,
} from '@agentic-crm/contracts';
import type { Tx } from './tx.ts';

export const capabilityOps = {
  async get(tx: Tx): Promise<Capabilities> {
    const cached = tx.memo.get('capabilities') as Capabilities | undefined;
    if (cached) return cached;
    const row = await tx.db
      .selectFrom('workspaces')
      .select('settings')
      .where('id', '=', tx.workspaceId)
      .executeTakeFirst();
    const overrides = ((row?.settings ?? {}) as { capabilities?: Partial<Capabilities> }).capabilities ?? {};
    const quotas: Record<string, number | null> = Object.fromEntries(
      quotaKeys.map((k) => [k, quotaDefaults[k] ?? null]),
    );
    for (const [k, v] of Object.entries(overrides.quotas ?? {})) {
      quotas[k] = v ?? quotaDefaults[k as QuotaKey] ?? null;
    }
    const caps: Capabilities = {
      features: { ...Object.fromEntries(featureKeys.map((k) => [k, true])), ...(overrides.features ?? {}) },
      quotas,
    };
    tx.memo.set('capabilities', caps);
    return caps;
  },

  async hasFeature(tx: Tx, key: FeatureKey | string): Promise<boolean> {
    return (await capabilityOps.get(tx)).features[key] ?? true;
  },

  /** null = unlimited. */
  async quota(tx: Tx, key: QuotaKey | string): Promise<number | null> {
    return (await capabilityOps.get(tx)).quotas[key] ?? null;
  },
};
