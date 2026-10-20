// End to end (BACKLOG §1 acceptance 5, I4a): a tRPC value write by user A produces an invalidation — the right
// resource, scope and seq — on the data channel of both members of the workspace and nothing for a member of
// another workspace; a refetch with acceptAfter = seq returns the new value.
import { randomUUID } from 'node:crypto';
import type { ServerToClient } from '@agentic-crm/realtime';
import type { inferRouterOutputs } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppRouter } from '../src/trpc/router';
import {
  createWorkspace,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  trpcCall,
  WsClient,
} from './support/harness';

type Out = inferRouterOutputs<AppRouter>;
type Invalidate = Extract<ServerToClient, { type: 'invalidate' }>;

let h: Harness;
let alice: TestUser; // W1
let bob: TestUser; // W1
let olga: TestUser; // W2
let w1: string;
let w2: string;
const s1 = `rt1-${Date.now().toString(36)}`;
const s2 = `rt2-${Date.now().toString(36)}`;
const clients: WsClient[] = [];

beforeAll(async () => {
  h = await startHarness();
  alice = await signUp(h, 'Alice Writer');
  bob = await signUp(h, 'Bob Reader');
  olga = await signUp(h, 'Olga Outsider');
  w1 = await createWorkspace(h, s1, [{ user: alice, admin: true }, { user: bob }]);
  w2 = await createWorkspace(h, s2, [{ user: olga, admin: true }]);
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

async function subscribed(user: TestUser, workspaceId: string): Promise<WsClient> {
  const client = await WsClient.connect(h, user.cookie);
  clients.push(client);
  expect(await client.subscribe(workspaceId)).toMatchObject({ type: 'subscribed', workspaceId });
  return client;
}

describe('tRPC write → realtime invalidation → acceptAfter refetch', () => {
  it('invalidates the attribute for both members of the workspace, never for an outsider', async () => {
    const a = await subscribed(alice, w1);
    const b = await subscribed(bob, w1);
    const o = await subscribed(olga, w2);

    const recordId = randomUUID();
    const created = await trpcCall<Out['records']['put']>(
      h,
      'records.put',
      { entityDefinitionId: 'companies', entityInstanceId: recordId, values: { name: [{ value: 'Before' }] } },
      { user: alice, slug: s1 },
    );
    const definitionId = created.record.entityDefinitionId;
    // Wait until the create's own invalidations reached Bob, so the assertions below see only the value write.
    await b.next((m) => m.type === 'invalidate' && BigInt(m.seq) >= BigInt(created.seq as string));

    const write = await trpcCall<Out['values']['put']>(
      h,
      'values.put',
      {
        entityDefinitionId: 'companies',
        entityInstanceId: recordId,
        attributeDefinitionId: 'name',
        attributeValueId: randomUUID(),
        value: 'After',
      },
      { user: alice, slug: s1 },
    );
    expect(write.values.map((v) => v.value)).toEqual(['After']);
    const seq = write.seq as string;
    expect(seq).toMatch(/^\d+$/);
    const attributeId = write.values[0]?.attributeDefinitionId as string;

    const isValueInvalidation = (m: ServerToClient): m is Invalidate =>
      m.type === 'invalidate' &&
      m.resource === 'attribute-value-list' &&
      m.resourceId === attributeId &&
      BigInt(m.seq) > BigInt(created.seq as string);
    for (const client of [a, b]) {
      const inv = await client.next<Invalidate>(isValueInvalidation);
      expect(inv).toMatchObject({
        type: 'invalidate',
        workspaceId: w1,
        resource: 'attribute-value-list',
        resourceId: attributeId,
        scope: { entityDefinitionId: definitionId, attributeDefinitionId: attributeId, entityInstanceIds: [recordId] },
      });
      // The write's own rows: the value list and the snapshot selection; the response seq is the last of them.
      expect(BigInt(inv.seq) <= BigInt(seq)).toBe(true);
      const selection = await client.next<Invalidate>(
        (m) => m.type === 'invalidate' && m.resource === 'snapshot-selection' && m.seq === seq,
      );
      expect(selection).toMatchObject({
        workspaceId: w1,
        resourceId: definitionId,
        scope: { entityDefinitionId: definitionId },
      });
    }

    // The outsider's channel stays silent for W1: after a later W2 write arrives (id order), nothing from W1 did.
    const sentinel = await trpcCall<Out['records']['put']>(
      h,
      'records.put',
      { entityDefinitionId: 'companies', entityInstanceId: randomUUID(), values: {} },
      { user: olga, slug: s2 },
    );
    await o.next((m) => m.type === 'invalidate' && m.seq === sentinel.seq);
    expect(o.invalidations().every((m) => m.workspaceId === w2)).toBe(true);
    expect(o.invalidations().some((m) => m.resourceId === attributeId || m.seq === seq)).toBe(false);

    // Bob refetches with acceptAfter = seq (as input and as the x-accept-after header) and sees the new value.
    const viaInput = await trpcCall<Out['values']['list']>(
      h,
      'values.list',
      {
        entityDefinitionId: definitionId,
        attributeDefinitionId: attributeId,
        entityInstanceIds: [recordId],
        acceptAfter: seq,
      },
      { user: bob, slug: s1 },
    );
    expect(viaInput.values[recordId]).toMatchObject({ state: 'complete', value: { values: [{ value: 'After' }] } });
    const viaHeader = await trpcCall<Out['records']['get']>(
      h,
      'records.get',
      { entityDefinitionId: definitionId, entityInstanceId: recordId },
      { user: bob, slug: s1, acceptAfter: seq },
    );
    expect(viaHeader.values[attributeId]?.map((v) => v.value)).toEqual(['After']);
    const snapshot = await trpcCall<Out['snapshots']['query']>(
      h,
      'snapshots.query',
      { entityDefinitionId: definitionId, acceptAfter: seq },
      { user: bob, slug: s1 },
    );
    expect(snapshot.ids).toContain(recordId);
  });
});
