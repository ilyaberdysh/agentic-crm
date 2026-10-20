// View presence rooms `view:<workspaceId>:<viewId>` (BACKLOG 2.15, C1 README §5): only members who can read the
// view's object may join; unknown views and views of other workspaces are refused.
import { randomUUID } from 'node:crypto';
import { type ActionFlags, flagsForScope } from '@agentic-crm/contracts';
import { memberContext, type PolicyResolver } from '@agentic-crm/domain';
import type { ServerToClient } from '@agentic-crm/realtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorkspaceWithMembers,
  type Harness,
  signUp,
  startHarness,
  type TestUser,
  WsClient,
} from './support/harness';

type Presence = Extract<ServerToClient, { type: 'presence' }>;

/** Members (not admins) cannot read companies. */
const noCompaniesForMembers: PolicyResolver = {
  async resolve(_tx, subject, definitions) {
    return new Map(
      definitions.map((d) => {
        const flags: ActionFlags = flagsForScope(
          subject.accessLevel === 'member' && d.apiSlug === 'companies' ? 'no-access' : 'full-access',
        );
        return [d.id, flags];
      }),
    );
  },
};

let h: Harness;
let admin: TestUser;
let member: TestUser;
let outsider: TestUser;
let ws: string;
let adminMemberId: string;
let companiesView: string;
let peopleView: string;
let foreignView: string;
const clients: WsClient[] = [];

async function connect(user: TestUser) {
  const client = await WsClient.connect(h, user.cookie);
  clients.push(client);
  return client;
}

beforeAll(async () => {
  h = await startHarness({}, { policyResolver: noCompaniesForMembers });
  admin = await signUp(h, 'Ada Admin');
  member = await signUp(h, 'Max Member');
  outsider = await signUp(h, 'Olga Outsider');
  const created = await createWorkspaceWithMembers(h, `vr-${Date.now()}`, [
    { user: admin, admin: true },
    { user: member },
  ]);
  ws = created.workspaceId;
  adminMemberId = created.memberIds.get(admin.id) as string;
  const ctx = memberContext(ws, adminMemberId);
  companiesView = (await h.domain.views.list(ctx, { entityDefinitionId: 'companies' }))[0]?.id as string;
  peopleView = (await h.domain.views.list(ctx, { entityDefinitionId: 'people' }))[0]?.id as string;
  const other = await createWorkspaceWithMembers(h, `vr-o-${Date.now()}`, [{ user: outsider, admin: true }]);
  foreignView = (
    await h.domain.views.list(memberContext(other.workspaceId, other.memberIds.get(outsider.id) as string), {
      entityDefinitionId: 'companies',
    })
  )[0]?.id as string;
});
afterAll(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await h?.close();
});

describe('view rooms', () => {
  it('lets members who can read the object in, with presence', async () => {
    const a = await connect(admin);
    const m = await connect(member);
    const room = `view:${ws}:${peopleView}`;
    a.send({ type: 'join-room', room, state: { activeCell: null } });
    m.send({ type: 'join-room', room, state: { activeCell: 'A1' } });
    const both = await a.next<Presence>((x) => x.type === 'presence' && x.room === room && x.members.length === 2);
    expect(both.members.map((x) => x.userId).sort()).toEqual([admin.id, member.id].sort());
  });

  it("refuses a view whose object the member cannot read, unknown views and other workspaces' views", async () => {
    const a = await connect(admin);
    a.send({ type: 'join-room', room: `view:${ws}:${companiesView}` });
    await a.next((x) => x.type === 'presence' && x.room === `view:${ws}:${companiesView}`);

    const m = await connect(member);
    m.send({ type: 'join-room', room: `view:${ws}:${companiesView}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    m.send({ type: 'join-room', room: `view:${ws}:${randomUUID()}` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    m.send({ type: 'join-room', room: `view:${ws}:not-a-uuid` });
    expect(await m.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    a.send({ type: 'join-room', room: `view:${ws}:${foreignView}` });
    expect(await a.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    // Not a member of the workspace at all.
    const o = await connect(outsider);
    o.send({ type: 'join-room', room: `view:${ws}:${peopleView}` });
    expect(await o.nextNew((x) => x.type === 'error')).toMatchObject({ code: 'forbidden' });
    // Other namespaces only need membership (record, note and Ask Agentic thread rooms have their own checks).
    m.send({ type: 'join-room', room: `scratch:${ws}:${randomUUID()}` });
    expect(await m.nextNew((x) => x.type === 'presence')).toMatchObject({ type: 'presence' });
  });
});
