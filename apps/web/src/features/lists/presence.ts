// List presence (BACKLOG 4.09;  "avatars of members present", the UI channel
// `presence-collection:<ws>:<listId>`): every tab on any view of a list joins the room
// `collection:<workspaceId>:<listId>`; the header shows one avatar per member in it (self included, like the object
// page's view facepile). Cell-level presence stays on the view room (features/table). Ephemeral only (I4b).
import type { PresenceMember } from '@agentic-crm/realtime';
import { useEffect, useState } from 'react';
import { getRealtimeClient, useConnectionState } from '../../data/realtime/connection';

export interface ListPresenceUser {
  userId: string;
  name: string;
}

export const listRoom = (workspaceId: string, listId: string) => `collection:${workspaceId}:${listId}`;

/** One entry per user in join order; custom name comes from `self` (the room echoes it anyway). */
export function presentUsers(
  members: readonly PresenceMember[],
  self: { userId: string; name: string },
): ListPresenceUser[] {
  const seen = new Set<string>();
  const out: ListPresenceUser[] = [];
  for (const m of members) {
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    const name = typeof m.state?.name === 'string' && m.state.name ? m.state.name : 'Workspace member';
    out.push({ userId: m.userId, name: m.userId === self.userId ? self.name : name });
  }
  return out;
}

export function useListPresence(
  workspaceId: string,
  listId: string,
  self: { userId: string; name: string },
): ListPresenceUser[] {
  const [users, setUsers] = useState<ListPresenceUser[]>([]);
  const { status } = useConnectionState();
  const client = getRealtimeClient();
  useEffect(() => {
    if (!client || !listId) return;
    const room = client.joinRoom(listRoom(workspaceId, listId), { name: self.name });
    setUsers(presentUsers(room.members(), self));
    const off = room.onPresence((members) => setUsers(presentUsers(members, self)));
    return () => {
      off();
      room.leave();
      setUsers([]);
    };
    // `status` re-joins after a reconnect so the member list is current.
  }, [client, status, workspaceId, listId, self.userId, self.name]);
  return users;
}
