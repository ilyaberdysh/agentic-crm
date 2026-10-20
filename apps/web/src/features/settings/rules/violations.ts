// Writes refused by requirement rules (BACKLOG 6.06 acceptance 4; A §4.13: "the client parks the write, shows the
// violation with the proposed values and lets the user fix or dismiss"). The mutation queue keeps such a write `held`
// and calls the hold handler registered here; the store feeds the "Updates required" dialog (RuleViolationHost).
import type { RuleViolation } from '@agentic-crm/contracts';
import { TRPCClientError } from '@trpc/client';
import { useSyncExternalStore } from 'react';
import type { HoldContext, WriteRecord } from '../../../data/mutations/queue';

export interface HeldWrite {
  /** The queue write id (stable while the write is held). */
  id: string;
  write: WriteRecord;
  violations: RuleViolation[];
  ctx: HoldContext;
}

/** The violated requirements of a 422 PARTICLE_GATE_VIOLATION error (empty for other errors). */
export function violationsOf(error: unknown): RuleViolation[] {
  if (!(error instanceof TRPCClientError)) return [];
  const shape = error.shape as { additional_information?: { violated_validation_rules?: unknown } } | undefined;
  const list = shape?.additional_information?.violated_validation_rules;
  return Array.isArray(list) ? (list as RuleViolation[]) : [];
}

let held: HeldWrite[] = [];
/** The write whose dialog is open (the newest held one until the user closes it). */
let openId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

export function holdWrite(item: HeldWrite): void {
  held = [...held.filter((h) => h.write.key !== item.write.key), item];
  openId = item.id;
  emit();
}

export function closeViolation(): void {
  openId = null;
  emit();
}

export function reopenViolation(id: string): void {
  if (held.some((h) => h.id === id)) {
    openId = id;
    emit();
  }
}

export function resolveViolation(id: string): void {
  held = held.filter((h) => h.id !== id);
  if (openId === id) openId = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => (openId ? (held.find((h) => h.id === openId) ?? null) : null);
let cachedFor: HeldWrite | null = null;
function stableSnapshot(): HeldWrite | null {
  const next = snapshot();
  if (next !== cachedFor) cachedFor = next;
  return cachedFor;
}

/** The held write whose "Updates required" dialog is open, if any. */
export function useOpenViolation(): HeldWrite | null {
  return useSyncExternalStore(subscribe, stableSnapshot, stableSnapshot);
}

/** Violations merged per requirement (several records break the same one) in the order they came. */
export function distinctViolations(violations: readonly RuleViolation[]): RuleViolation[] {
  const seen = new Set<string>();
  const out: RuleViolation[] = [];
  for (const v of violations) {
    const key = `${v.particle_gate_id}|${v.particle_gate_validation_rule_id}|${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
