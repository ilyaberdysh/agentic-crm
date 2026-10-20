import { createHash } from 'node:crypto';

/** Version 1 canonical JSON: object keys sorted, array order retained, JSON values only. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical JSON requires finite JSON values');
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export const canonicalDigest = (value: unknown): string => sha256(canonicalJson(value));
