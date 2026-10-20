// Optimistic attribute writes through the slice-1 mutation queue (D-03, B.2): a commit becomes one `values.set`
// write per record × attribute (the coalescing unit), shown immediately as optimistic rows, diffed at send time into
// `values.put` / `values.retire` / `values.reorder` with client UUIDv7 value ids (I3, I6), reconciled from the
// responses, rolled back with a "Failed to save your change" toast + Retry on a final failure (data/mutations).
import { valueInputSchemas } from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useContext } from 'react';
import { keys, valueOverlayKey } from '../../../data/keys';
import { appQueue, type SetValuesInput, VALUE_KINDS } from '../../../data/mutations';
import { useOverlayEntry } from '../../../data/mutations/react';
import { queryClient } from '../../../data/queryClient';
import { valuesQuery } from '../../../data/records';
import { newId } from '../../../lib/ids';
import { WorkspaceContext } from '../../shell/workspaceContext';
import { useAttributeEnv } from '../data/env';
import type { AttributeDefinition, AttributeValue, CommitInput, CommitMeta, RecordRef } from '../types';
import { currentValues, toReadForm, toWriteForm } from '../values/shapes';
import { planCommit } from './plan';

type Scoped<T> = T & { workspace: RecordRef['workspace'] };

function isRow(v: unknown): v is AttributeValue {
  return typeof v === 'object' && v !== null && 'id' in v && 'attributeDefinitionId' in v && 'activeFrom' in v;
}

/**
 * The overlay value of a record × attribute key as rows: `values.set` writes store the optimistic rows; slice-1
 * `putValue` writes store a single write-form value, shown as one row.
 */
export function overlayRows(value: unknown, attribute: AttributeDefinition, recordRef: RecordRef): AttributeValue[] {
  if (Array.isArray(value) && value.every(isRow)) return value;
  return [
    {
      id: `optimistic:${recordRef.entityInstanceId}:${attribute.id}`,
      workspaceId: recordRef.workspace?.id ?? attribute.workspaceId,
      entityDefinitionId: recordRef.entityDefinitionId,
      entityInstanceId: recordRef.entityInstanceId,
      attributeDefinitionId: attribute.id,
      attributeType: attribute.type,
      value: toReadForm(attribute.type, value, attribute),
      activeFrom: new Date(0).toISOString(),
      activeUntil: null,
      sortOrder: null,
      createdBy: { type: 'workspace-member', id: null },
      deactivatedBy: null,
    },
  ];
}

export interface AttributeValuesState {
  /** Current values, optimistic writes applied. */
  values: AttributeValue[];
  /** A write for this record × attribute is queued, in flight or retrying ("Validating change" spinner, D §2.3). */
  isPending: boolean;
  /** A requirement rule refused the write: it is held (shown here) until the user retries or discards it. */
  isHeld: boolean;
  isLoading: boolean;
  isError: boolean;
}

/** Values of one attribute on one record for Views and Editors: batched server read + optimistic overlay. */
export function useAttributeValues(recordRef: RecordRef, attribute: AttributeDefinition): AttributeValuesState {
  const env = useAttributeEnv();
  const workspace = recordRef.workspace ?? env.workspace;
  const query = useQuery({
    ...valuesQuery({ ...recordRef, workspace, attributeDefinitionId: attribute.id }),
    enabled: Boolean(workspace.id && recordRef.entityInstanceId),
  });
  const entry = useOverlayEntry(appQueue(), valueOverlayKey(recordRef.entityInstanceId, attribute.id));
  const values = entry
    ? overlayRows(entry.value, attribute, recordRef)
    : currentValues((query.data?.values ?? []) as AttributeValue[]);
  const isHeld = entry?.status === 'held';
  return { values, isPending: Boolean(entry) && !isHeld, isHeld, isLoading: query.isPending, isError: query.isError };
}

/** Client-side message for a write form the server would reject (editors validate first; this is the safety net). */
function invalidMessage(attribute: AttributeDefinition): string {
  switch (attribute.type) {
    case 'email-address':
      return 'You have entered an invalid email address';
    case 'domain':
      return 'You have entered an invalid domain';
    case 'phone-number':
      return 'Invalid phone number';
    default:
      return `Invalid value for ${attribute.title}`;
  }
}

/**
 * Turns an editor's commit into an optimistic write. `next` is either the desired current set (`ValueInput[]`)
 * or explicit `ValueOp[]` (C1 contract). Unchanged commits send nothing.
 */
export function useAttributeWrite(
  recordRef: RecordRef,
  attribute: AttributeDefinition,
): (next: CommitInput, meta?: CommitMeta) => void {
  const route = useContext(WorkspaceContext);
  const env = useAttributeEnv();
  const memberId = route?.workspace.membership.id ?? env.memberId;
  const workspace = recordRef.workspace ?? env.workspace;
  const { entityDefinitionId, entityInstanceId } = recordRef;
  return useCallback(
    (next: CommitInput) => {
      const queue = appQueue();
      const key = valueOverlayKey(entityInstanceId, attribute.id);
      const cacheKey = keys.values(workspace.id, entityDefinitionId, attribute.id, entityInstanceId);
      const server = currentValues(queryClient.getQueryData<{ values: AttributeValue[] }>(cacheKey)?.values ?? []);
      const entry = queue.get(key);
      const ref = { workspace, entityDefinitionId, entityInstanceId };
      const shown = entry ? overlayRows(entry.value, attribute, ref) : server;
      const plan = planCommit(attribute, shown, next, {
        recordRef: ref,
        newId,
        actor: { type: 'workspace-member', id: memberId },
      });
      if (!plan.changed) return;
      const shownIds = new Set(shown.map((v) => v.id));
      const schema = valueInputSchemas[attribute.type];
      for (const d of plan.desired) {
        if (shownIds.has(d.id)) continue;
        if (!schema.safeParse(d.value).success) {
          toast.error({ title: invalidMessage(attribute) });
          return;
        }
      }
      const base = {
        workspace,
        entityDefinitionId,
        entityInstanceId,
        attributeDefinitionId: attribute.id,
        isMultiselect: attribute.isMultiselect,
        known: [...new Set([...server.map((v) => v.id), ...shown.map((v) => v.id)])],
      };
      const input: Scoped<SetValuesInput> = { ...base, desired: plan.desired };
      // Undo restores what was shown before: kept rows keep their ids, rows this write retires come back as new
      // values (a retired value id cannot be reused: puts are idempotent per id).
      const desiredIds = new Set(plan.desired.map((d) => d.id));
      const undoInput: Scoped<SetValuesInput> = {
        ...base,
        known: [...new Set([...base.known, ...desiredIds])],
        desired: shown.map((v) => ({
          id: desiredIds.has(v.id) ? v.id : newId(),
          value: toWriteForm(attribute.type, v.value),
          sortOrder: v.sortOrder,
        })),
      };
      queue.enqueue({
        kind: VALUE_KINDS.set,
        key,
        input,
        value: plan.optimistic,
        undo: { input: undoInput, value: shown },
      });
    },
    [workspace, entityDefinitionId, entityInstanceId, attribute, memberId],
  );
}

/**
 * Values to show for a record x attribute given its overlay entry (`appQueue().get(valueOverlayKey(...))?.value`) and
 * the cached server values, for hosts that read the overlay themselves (the table's virtualised cells).
 */
export function overlayValues(entry: unknown, server: AttributeValue[] | undefined): AttributeValue[] {
  if (entry === undefined) return currentValues(server ?? []);
  if (Array.isArray(entry) && entry.every(isRow)) return entry;
  const template = server?.[0];
  if (!template) return [];
  return [
    { ...template, id: `optimistic:${template.entityInstanceId}`, value: toReadForm(template.attributeType, entry) },
  ];
}
