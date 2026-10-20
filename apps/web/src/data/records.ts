// Record headers and attribute values as normalised point reads (D-03): every cell / record page asks for its own
// key; the batching loaders merge the asks of one frame into `records.batchGet` (≤ 1000 ids per workspace +
// definition) and `values.list` (≤ 1337 ids per workspace + definition + attribute), like Attio's batchers
// (internal-api-shapes §2). Tables (slice 2) and record pages (slice 3) build on these query options.
import { queryOptions } from '@tanstack/react-query';
import { BatchLoader } from './batchLoader';
import { keys } from './keys';
import { api, inWorkspace, type RouterOutputs, type WorkspaceRef } from './trpc';

/** As served by the API (wire types of `records.batchGet` / `values.put`). */
export type RecordHeader = Extract<
  RouterOutputs['records']['batchGet']['records'][string],
  { state: 'complete' }
>['value'];
export type AttributeValue = RouterOutputs['values']['put']['values'][number];

interface RecordKey {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  entityInstanceId: string;
}

interface ValuesKey extends RecordKey {
  attributeDefinitionId: string;
}

export const recordLoader = new BatchLoader<RecordKey, RecordHeader>({
  windowMs: 25,
  maxBatchSize: 1000,
  groupOf: (k) => `${k.workspace.id}:${k.entityDefinitionId}`,
  idOf: (k) => k.entityInstanceId,
  fetchBatch: async (batch) => {
    const first = batch[0] as RecordKey;
    const { records } = await api.records.batchGet.query(
      { entityDefinitionId: first.entityDefinitionId, entityInstanceIds: batch.map((k) => k.entityInstanceId) },
      inWorkspace(first.workspace),
    );
    const out = new Map<string, RecordHeader | Error>();
    for (const [id, result] of Object.entries(records)) {
      out.set(id, result.state === 'complete' ? result.value : new Error(result.error));
    }
    return out;
  },
});

export const valuesLoader = new BatchLoader<ValuesKey, AttributeValue[]>({
  windowMs: 25,
  maxBatchSize: 1337,
  groupOf: (k) => `${k.workspace.id}:${k.entityDefinitionId}:${k.attributeDefinitionId}`,
  idOf: (k) => k.entityInstanceId,
  fetchBatch: async (batch) => {
    const first = batch[0] as ValuesKey;
    const { values } = await api.values.list.query(
      {
        entityDefinitionId: first.entityDefinitionId,
        attributeDefinitionId: first.attributeDefinitionId,
        entityInstanceIds: batch.map((k) => k.entityInstanceId),
      },
      inWorkspace(first.workspace),
    );
    const out = new Map<string, AttributeValue[] | Error>();
    for (const [id, result] of Object.entries(values)) {
      out.set(id, result.state === 'complete' ? result.value.values : new Error(result.error));
    }
    return out;
  },
});

export const recordQuery = (key: RecordKey) =>
  queryOptions({
    queryKey: keys.record(key.workspace.id, key.entityDefinitionId, key.entityInstanceId),
    queryFn: () => recordLoader.load(key),
  });

/** Current values of one attribute on one record; mutations reconcile into the same key (data/mutations). */
export const valuesQuery = (key: ValuesKey) =>
  queryOptions({
    queryKey: keys.values(key.workspace.id, key.entityDefinitionId, key.attributeDefinitionId, key.entityInstanceId),
    queryFn: async () => ({ values: await valuesLoader.load(key), accurateAt: null as string | null }),
  });
