// View presence (BACKLOG 2.15;  realtime; ARCHITECTURE I4b): every tab on a view joins the room
// `view:<workspaceId>:<viewId>`. Room *state* carries who is here and their active cell (the UI `__set_status`
// location); *ephemeral* messages carry the live draft while a peer edits (`payload.draft.values`). Nothing here is
// the source of truth: the committed value arrives through the normal write path + invalidation.
import type { PresenceMember } from '@agentic-crm/realtime';
import type { RoomHandle } from '@agentic-crm/realtime/client';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { getRealtimeClient, useConnectionState } from '../../data/realtime/connection';

export interface PresenceCell {
  recordId: string;
  columnKey: string;
}

export interface Peer {
  clientId: string;
  userId: string;
  name: string;
  cell: PresenceCell | null;
  /** Live draft values while the peer edits `cell` (ephemeral). */
  draft: unknown[] | null;
}

export interface PresenceUser {
  userId: string;
  name: string;
}

type DraftMessage =
  | { t: 'draft'; cell: PresenceCell; values: unknown[] }
  | { t: 'draft-clear' }
  | { t: 'request-drafts' };

export const cellKey = (recordId: string, columnKey: string) => `${recordId}:${columnKey}`;

const DRAFT_THROTTLE_MS = 80;
const EMPTY: Peer[] = [];

export class ViewPresence {
  private room: RoomHandle | null = null;
  private members: PresenceMember[] = [];
  private selfClientId: string | null = null;
  private readonly drafts = new Map<string, { cell: PresenceCell; values: unknown[] }>();
  private peers: Peer[] = [];
  private users: PresenceUser[] = [];
  private byCell = new Map<string, Peer[]>();
  private readonly listeners = new Set<() => void>();
  private readonly cellListeners = new Map<string, Set<() => void>>();
  private local: { cell: PresenceCell | null; draft: { cell: PresenceCell; values: unknown[] } | null } = {
    cell: null,
    draft: null,
  };
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private draftPendingAt = 0;

  constructor(private readonly self: { userId: string; name: string }) {}

  // ---- room lifecycle --------------------------------------------------------------------------------------------

  attach(room: RoomHandle, selfClientId: string | null): () => void {
    this.room = room;
    this.selfClientId = selfClientId;
    const offPresence = room.onPresence((members) => this.setMembers(members));
    const offEphemeral = room.onEphemeral((message) =>
      this.onEphemeral(message.clientId ?? message.from, message.payload),
    );
    this.setMembers(room.members());
    if (this.local.cell) room.setState(this.stateOf());
    room.publish({ t: 'request-drafts' } satisfies DraftMessage);
    return () => {
      offPresence();
      offEphemeral();
      if (this.draftTimer) clearTimeout(this.draftTimer);
      this.draftTimer = null;
      room.leave();
      this.room = null;
      this.drafts.clear();
      this.setMembers([]);
    };
  }

  private stateOf(): Record<string, unknown> {
    return { name: this.self.name, cell: this.local.cell };
  }

  // ---- local → room ----------------------------------------------------------------------------------------------

  setActiveCell(cell: PresenceCell | null): void {
    const prev = this.local.cell;
    if (prev?.recordId === cell?.recordId && prev?.columnKey === cell?.columnKey) return;
    this.local.cell = cell;
    this.room?.setState(this.stateOf());
  }

  /** The live value while editing `cell` (null = editing ended). Throttled; the last draft always goes out. */
  setDraft(cell: PresenceCell, values: unknown[] | null): void {
    if (values === null) {
      if (this.draftTimer) clearTimeout(this.draftTimer);
      this.draftTimer = null;
      if (this.local.draft) this.room?.publish({ t: 'draft-clear' } satisfies DraftMessage);
      this.local.draft = null;
      return;
    }
    this.local.draft = { cell, values };
    const now = Date.now();
    if (this.draftTimer) return;
    const wait = Math.max(0, DRAFT_THROTTLE_MS - (now - this.draftPendingAt));
    this.draftTimer = setTimeout(() => {
      this.draftTimer = null;
      this.draftPendingAt = Date.now();
      const draft = this.local.draft;
      if (draft) this.room?.publish({ t: 'draft', cell: draft.cell, values: draft.values } satisfies DraftMessage);
    }, wait);
  }

  // ---- room → local ----------------------------------------------------------------------------------------------

  private onEphemeral(from: string, payload: Record<string, unknown>): void {
    const message = payload as DraftMessage;
    if (message.t === 'request-drafts') {
      const draft = this.local.draft;
      if (draft) this.room?.publish({ t: 'draft', cell: draft.cell, values: draft.values } satisfies DraftMessage);
      return;
    }
    if (message.t === 'draft' && message.cell && Array.isArray(message.values)) {
      this.drafts.set(from, { cell: message.cell, values: message.values });
    } else if (message.t === 'draft-clear') {
      this.drafts.delete(from);
    } else return;
    this.rebuild();
  }

  private setMembers(members: PresenceMember[]): void {
    this.members = members;
    const present = new Set(members.map((m) => m.clientId ?? m.userId));
    for (const id of [...this.drafts.keys()]) if (!present.has(id)) this.drafts.delete(id);
    this.rebuild();
  }

  private rebuild(): void {
    const users: PresenceUser[] = [];
    const seen = new Set<string>();
    const peers: Peer[] = [];
    for (const m of this.members) {
      const name = typeof m.state.name === 'string' && m.state.name ? m.state.name : 'Someone';
      if (!seen.has(m.userId)) {
        seen.add(m.userId);
        users.push({ userId: m.userId, name: m.userId === this.self.userId ? this.self.name : name });
      }
      const clientId = m.clientId ?? m.userId;
      if (clientId === this.selfClientId) continue;
      const cell = parseCell(m.state.cell);
      const draft = this.drafts.get(clientId);
      peers.push({
        clientId,
        userId: m.userId,
        name,
        cell,
        draft:
          draft && cell && draft.cell.recordId === cell.recordId && draft.cell.columnKey === cell.columnKey
            ? draft.values
            : null,
      });
    }
    const byCell = new Map<string, Peer[]>();
    for (const p of peers) {
      if (!p.cell) continue;
      const key = cellKey(p.cell.recordId, p.cell.columnKey);
      byCell.set(key, [...(byCell.get(key) ?? []), p]);
    }
    const changedCells = new Set<string>();
    for (const key of new Set([...this.byCell.keys(), ...byCell.keys()])) {
      if (!samePeers(this.byCell.get(key), byCell.get(key))) changedCells.add(key);
    }
    this.byCell = byCell;
    const usersChanged =
      users.length !== this.users.length ||
      users.some((u, i) => u.userId !== this.users[i]?.userId || u.name !== this.users[i]?.name);
    this.peers = peers;
    if (usersChanged) this.users = users;
    for (const key of changedCells) for (const l of this.cellListeners.get(key) ?? []) l();
    for (const l of this.listeners) l();
  }

  // ---- reads -----------------------------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeCell(key: string, listener: () => void): () => void {
    let set = this.cellListeners.get(key);
    if (!set) {
      set = new Set();
      this.cellListeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.cellListeners.delete(key);
    };
  }

  peersAt(key: string): Peer[] {
    return this.byCell.get(key) ?? EMPTY;
  }

  getUsers = (): PresenceUser[] => this.users;

  getPeers = (): Peer[] => this.peers;
}

function parseCell(value: unknown): PresenceCell | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return typeof v.recordId === 'string' && typeof v.columnKey === 'string'
    ? { recordId: v.recordId, columnKey: v.columnKey }
    : null;
}

function samePeers(a: Peer[] | undefined, b: Peer[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((p, i) => p.clientId === b[i]?.clientId && p.name === b[i]?.name && p.draft === b[i]?.draft);
}

/** Joins the view room while mounted; re-joins after reconnects (the realtime client re-enters rooms itself). */
export function useViewPresence(
  workspaceId: string,
  viewId: string,
  self: { userId: string; name: string },
): ViewPresence {
  const presence = useMemo(() => new ViewPresence(self), [self.userId, self.name, viewId]);
  const { status } = useConnectionState();
  const client = getRealtimeClient();
  const connected = status === 'connected';
  useEffect(() => {
    if (!client) return;
    const room = client.joinRoom(`view:${workspaceId}:${viewId}`, { name: self.name, cell: null });
    return presence.attach(room, client.clientId);
    // `connected` re-attaches so custom clientId (from the server's `ready`) is known.
  }, [client, connected, presence, workspaceId, viewId, self.name]);
  return presence;
}

export function usePresenceUsers(presence: ViewPresence): PresenceUser[] {
  return useSyncExternalStore(presence.subscribe, presence.getUsers, presence.getUsers);
}

export function usePeersAt(presence: ViewPresence | undefined, key: string): Peer[] {
  return useSyncExternalStore(
    (l) => (presence ? presence.subscribeCell(key, l) : () => {}),
    () => (presence ? presence.peersAt(key) : EMPTY),
    () => EMPTY,
  );
}
