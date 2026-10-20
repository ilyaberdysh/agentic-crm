// Collab server end to end with real Better Auth sessions and Node Hocuspocus providers: WebSocket auth, per-document
// authorisation, convergence, persistence + projections + change_log, awareness identity, server-side writes,
// session revocation and graceful shutdown.
import { flagsForScope } from '@agentic-crm/contracts';
import { newId, type PolicyResolver } from '@agentic-crm/domain';
import { stateToBlocks, textBlock, yDocToBlocks } from '@agentic-crm/editor/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  appendParagraph,
  connect,
  createWorkspace,
  type Stack,
  signOut,
  signUp,
  startStack,
  type TestUser,
  WEB_ORIGIN,
  waitFor,
} from './support/stack.ts';

/** Status code of a raw upgrade attempt (101 = accepted). */
async function upgradeStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on('open', () => {
      socket.close();
      resolve(101);
    });
    socket.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      socket.terminate();
    });
    socket.on('error', () => {});
  });
}

async function storedBlocks(stack: Stack, ctx: Parameters<Stack['domain']['documents']['get']>[0], id: string) {
  return (await stack.domain.documents.get(ctx, id)).blocks;
}

describe('collab server', () => {
  let stack: Stack;
  let ada: TestUser;
  let grace: TestUser;
  let mallory: TestUser;
  let ws: Awaited<ReturnType<typeof createWorkspace>>;

  beforeAll(async () => {
    stack = await startStack({ sessionRevalidateMs: 200 });
    ada = await signUp(stack, 'Ada Lovelace');
    grace = await signUp(stack, 'Grace Hopper');
    mallory = await signUp(stack, 'Mallory Outsider');
    ws = await createWorkspace(stack, [ada, grace]);
  });

  afterAll(async () => {
    await stack?.close();
  });

  async function newDocument(markdown?: string) {
    const id = newId();
    await stack.domain.documents.create(ws.ownerCtx, {
      id,
      docType: 'note',
      ...(markdown ? { content: { markdown } } : {}),
    });
    return id;
  }

  it('answers the health check', async () => {
    const response = await fetch(`http://127.0.0.1:${stack.collab.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', db: true });
  });

  it('refuses the WebSocket without a valid session cookie or from a foreign origin', async () => {
    expect(await upgradeStatus(stack.collabUrl, { origin: WEB_ORIGIN })).toBe(401);
    const forged = ada.cookie.replace(/agentic-crm-session=([^.;]+)\.[^;]+/, 'agentic-crm-session=$1.AAAA');
    expect(await upgradeStatus(stack.collabUrl, { origin: WEB_ORIGIN, cookie: forged })).toBe(401);
    expect(await upgradeStatus(stack.collabUrl, { origin: 'https://evil.example', cookie: ada.cookie })).toBe(403);
    expect(await upgradeStatus(stack.collabUrl, { origin: WEB_ORIGIN, cookie: ada.cookie })).toBe(101);
  });

  it('rejects documents of other workspaces and unknown documents', async () => {
    const id = await newDocument('secret');
    const outsider = connect(stack, id, mallory.cookie);
    await expect(outsider.authenticated).rejects.toThrow('not-found');
    outsider.close();
    const unknown = connect(stack, newId(), ada.cookie);
    await expect(unknown.authenticated).rejects.toThrow('not-found');
    unknown.close();
    expect(outsider.doc.getXmlFragment('default').length).toBe(0);
  });

  it('converges two clients and shares server-asserted presence', async () => {
    const id = await newDocument('# Shared');
    const a = connect(stack, id, ada.cookie, { user: { name: 'Spoofed name', color: '#000000' } });
    const b = connect(stack, id, grace.cookie);
    await Promise.all([a.synced, b.synced]);
    expect(await a.authenticated).toBe('read-write');
    appendParagraph(a.doc, 'from Ada');
    appendParagraph(b.doc, 'from Grace');
    await waitFor(() => yDocToBlocks(a.doc).length === 3 && yDocToBlocks(b.doc).length === 3, 5_000, 'convergence');
    expect(yDocToBlocks(a.doc)).toEqual(yDocToBlocks(b.doc));
    expect(yDocToBlocks(a.doc)[0]).toEqual(textBlock('h1', 'Shared'));

    // Awareness: B sees A under A's member name and colour, whatever A claimed.
    const adaMember = ws.members.get(ada.id) as string;
    const peer = await waitFor(
      () =>
        [...(b.provider.awareness?.getStates().values() ?? [])].find(
          (s) => (s.user as { memberId?: string } | undefined)?.memberId === adaMember,
        ),
      5_000,
      'awareness',
    );
    expect(peer.user).toMatchObject({ id: ada.id, memberId: adaMember, name: 'Ada Lovelace' });
    expect((peer.user as { color: string }).color).toMatch(/^#[0-9A-F]{6}$/);
    expect((peer.user as { color: string }).color).not.toBe('#000000');
    a.close();
    b.close();
  });

  it('persists debounced edits with projections and a change_log row, and restores them on reconnect', async () => {
    const id = await newDocument();
    const first = connect(stack, id, ada.cookie);
    await first.synced;
    appendParagraph(first.doc, 'persist me');
    await waitFor(
      async () => (await storedBlocks(stack, ws.ownerCtx, id)).some((b) => b.text === 'persist me'),
      5_000,
      'store',
    );
    first.close();
    await waitFor(() => stack.collab.stats().documents === 0, 5_000, 'unload');

    const view = await stack.domain.documents.get(ws.ownerCtx, id);
    expect(view.markdown).toContain('persist me');
    expect(view.searchText).toContain('persist me');
    const changes = await stack.database.kysely
      .selectFrom('change_log')
      .selectAll()
      .where('resource', '=', 'document')
      .where('resource_id', '=', id)
      .orderBy('id')
      .execute();
    expect(changes.at(-1)?.actor).toEqual({ type: 'workspace-member', id: ws.members.get(ada.id) });

    // A fresh client (new server-side load from Postgres) gets the content back.
    const second = connect(stack, id, grace.cookie);
    await second.synced;
    await waitFor(() => yDocToBlocks(second.doc).some((b) => b.text === 'persist me'), 5_000, 'restore');
    second.close();
  });

  it('pushes server-side content replacement to open editors and disconnects them on delete', async () => {
    const id = await newDocument('old body');
    const client = connect(stack, id, ada.cookie);
    await client.synced;
    await stack.domain.documents.replaceContent(ws.ownerCtx, { id, content: { markdown: '## New body\n- item' } });
    await waitFor(
      () =>
        yDocToBlocks(client.doc)
          .map((b) => b.text)
          .join('|') === 'New body|item',
      5_000,
      'replacement fan-out',
    );
    let closed = false;
    client.provider.on('close', () => {
      closed = true;
    });
    await stack.domain.documents.delete(ws.ownerCtx, id);
    await waitFor(() => closed || stack.collab.stats().documents === 0, 5_000, 'disconnect on delete');
    client.close();
    const again = connect(stack, id, ada.cookie);
    await expect(again.authenticated).rejects.toThrow('not-found');
    again.close();
  });

  it('disconnects editors of a note that was deleted (access re-checked through the owning note)', async () => {
    const companies = await stack.domain.schema.getObject(ws.ownerCtx, 'companies');
    const entityInstanceId = newId();
    await stack.domain.records.create(ws.ownerCtx, {
      entityDefinitionId: companies.id,
      entityInstanceId,
      values: { name: [{ value: 'Atlas Ventures' }] },
    });
    const note = await stack.domain.notes.create(ws.ownerCtx, {
      id: newId(),
      parentRecords: [{ entityDefinitionId: companies.id, entityInstanceId }],
    });
    expect(await stack.domain.documents.owner(ws.ownerCtx, note.documentId)).toEqual({ kind: 'note', id: note.id });
    const client = connect(stack, note.documentId, grace.cookie);
    await client.synced;
    expect(await client.authenticated).toBe('read-write');
    let closed = false;
    client.provider.on('close', () => {
      closed = true;
    });
    await stack.domain.notes.delete(ws.ownerCtx, note.id);
    await waitFor(() => closed, 5_000, 'close after note deletion');
    client.close();
    const again = connect(stack, note.documentId, grace.cookie);
    await expect(again.authenticated).rejects.toThrow('forbidden');
    again.close();
  });

  it('closes the connections of a signed-out session', async () => {
    const temp = await signUp(stack, 'Temp Member');
    const tempWs = await createWorkspace(stack, [temp]);
    const id = newId();
    await stack.domain.documents.create(tempWs.ownerCtx, { id, docType: 'note' });
    const client = connect(stack, id, temp.cookie);
    await client.synced;
    await waitFor(() => stack.collab.stats().connections > 0, 2_000, 'connected');
    let closed = false;
    client.provider.on('close', () => {
      closed = true;
    });
    await signOut(stack, temp);
    await waitFor(() => closed, 5_000, 'revocation close');
    client.close();
  });
});

describe('collab server: read-only access and shutdown', () => {
  let stack: Stack;
  let owner: TestUser;
  let reader: TestUser;
  let ws: Awaited<ReturnType<typeof createWorkspace>>;
  let readerMember = '';

  beforeAll(async () => {
    // Read-only on every object for the reader (resolved through the same permission hook the API uses).
    const resolver: PolicyResolver = {
      async resolve(_tx, subject, defs) {
        const scope = subject.memberId === readerMember ? 'read-only' : 'full-access';
        return new Map(defs.map((d) => [d.id, flagsForScope(scope)]));
      },
    };
    stack = await startStack({ debounceMs: 60_000, maxDebounceMs: 120_000 }, { policyResolver: resolver });
    owner = await signUp(stack, 'Owner Person');
    reader = await signUp(stack, 'Reader Person');
    ws = await createWorkspace(stack, [owner, reader]);
    readerMember = ws.members.get(reader.id) as string;
  });

  afterAll(async () => {
    await stack?.close();
  });

  async function noteDocument() {
    const companies = await stack.domain.schema.getObject(ws.ownerCtx, 'companies');
    const entityInstanceId = newId();
    await stack.domain.records.create(ws.ownerCtx, {
      entityDefinitionId: companies.id,
      entityInstanceId,
      values: { name: [{ value: 'Cedar Health' }] },
    });
    // A note on the record (notes service, S3-DATA): its body document is governed by the note's parent records.
    const note = await stack.domain.notes.create(
      ws.ownerCtx,
      { id: newId(), parentRecords: [{ entityDefinitionId: companies.id, entityInstanceId }] },
      { markdown: 'note body' },
    );
    return note.documentId;
  }

  it('gives readers a read-only connection whose edits are not applied', async () => {
    const id = await noteDocument();
    const editor = connect(stack, id, owner.cookie);
    const viewer = connect(stack, id, reader.cookie);
    await Promise.all([editor.synced, viewer.synced]);
    expect(await viewer.authenticated).toBe('readonly');
    appendParagraph(viewer.doc, 'reader edit');
    appendParagraph(editor.doc, 'owner edit');
    await waitFor(
      () => yDocToBlocks(viewer.doc).some((b) => b.text === 'owner edit'),
      5_000,
      'owner edit reaches reader',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(yDocToBlocks(editor.doc).map((b) => b.text)).toEqual(['note body', 'owner edit']);
    editor.close();
    viewer.close();
  });

  it('stores pending changes on graceful shutdown', async () => {
    const id = await noteDocument();
    const client = connect(stack, id, owner.cookie);
    await client.synced;
    appendParagraph(client.doc, 'saved on shutdown');
    // The debounce is 60 s: only the shutdown flush can persist this edit.
    await waitFor(() => stack.collab.stats().documents === 1, 2_000, 'document loaded');
    await new Promise((r) => setTimeout(r, 100));
    await stack.collab.stop();
    client.close();
    const stored = await stack.domain.documents.loadState(ws.ownerCtx, id);
    expect(stateToBlocks(stored?.state).map((b) => b.text)).toEqual(['note body', 'saved on shutdown']);
  });
});
