// Data-model limits (CROSS-DOMAIN C.4 #7): options/stages per attribute, attributes per object, views per object.
// Values: contracts quotaDefaults, overridable per workspace through capabilities; Attio's error codes
// (ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED, OVER_USAGE_LIMIT; A internal-api-shapes §1.2).
import type { QuotaKey } from '@agentic-crm/contracts';
import { capabilityOps } from './capabilities.ts';
import { conflict } from './errors.ts';
import type { Tx } from './tx.ts';

/** Hard technical ceilings an override cannot raise (projection tables: 1,600 columns, ≤ 3 per attribute). */
const CEILINGS: Partial<Record<QuotaKey, number>> = { attributes_per_object_hard: 500 };

export type LimitKey = 'select_options_per_attribute_hard' | 'attributes_per_object_hard' | 'views_per_object_hard';

export async function limitOf(tx: Tx, key: LimitKey): Promise<number | null> {
  const value = await capabilityOps.quota(tx, key);
  const ceiling = CEILINGS[key];
  if (ceiling === undefined) return value;
  return value === null ? ceiling : Math.min(value, ceiling);
}

/** Throws when `current + adding` exceeds the quota `key`. */
export async function assertWithinLimit(
  tx: Tx,
  key: LimitKey,
  current: number,
  adding: number,
  details: Record<string, unknown> = {},
): Promise<void> {
  const limit = await limitOf(tx, key);
  if (limit === null || current + adding <= limit) return;
  if (key === 'select_options_per_attribute_hard') {
    throw conflict('ATTRIBUTE_SELECT_OPTIONS_LIMIT_EXCEEDED', `An attribute can have at most ${limit} options`, {
      ...details,
      limit,
    });
  }
  const what = key === 'attributes_per_object_hard' ? 'attributes' : 'views';
  throw conflict('OVER_USAGE_LIMIT', `An object can have at most ${limit} ${what}`, { ...details, quota: key, limit });
}
