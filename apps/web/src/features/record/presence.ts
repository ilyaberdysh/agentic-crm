// Record presence: every tab showing a record joins the room
// `record:<workspaceId>:<entityDefinitionId>:<entityInstanceId>`; the top bar shows a facepile of the *other* members
// in it (one avatar per user, X-04). Ephemeral only (I4b): nothing is stored.
import type { PresenceMember } from '@agentic-crm/realtime';
import { useEffect, useState } from 'react';
import { getRealtimeClient, useConnectionState } from '../../data/realtime/connection';

export interface PresentUser {
  userId: string;
  name: string;
}

export const recordRoom = (workspaceId: string, entityDefinitionId: string, entityInstanceId: string) =>
  `record:${workspaceId}:${entityDefinitionId}:${entityInstanceId}`;

/** Other users in the room (self excluded), one per user, in join order. */
export function otherUsers(members: readonly PresenceMember[], selfUserId: string): PresentUser[] {
  const seen = new Set<string>([selfUserId]);
  const out: PresentUser[] = [];
  for (const m of members) {
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    const name = typeof m.state?.name === 'string' && m.state.name ? m.state.name : 'Workspace member';
    out.push({ userId: m.userId, name });
  }
  return out;
}

export function useRecordPresence(
  workspaceId: string,
  entityDefinitionId: string,
  entityInstanceId: string,
  self: { userId: string; name: string },
): PresentUser[] {
  const [users, setUsers] = useState<PresentUser[]>([]);
  const { status } = useConnectionState();
  const client = getRealtimeClient();
  useEffect(() => {
    if (!client || !entityInstanceId) return;
    const room = client.joinRoom(recordRoom(workspaceId, entityDefinitionId, entityInstanceId), { name: self.name });
    setUsers(otherUsers(room.members(), self.userId));
    const off = room.onPresence((members) => setUsers(otherUsers(members, self.userId)));
    return () => {
      off();
      room.leave();
      setUsers([]);
    };
    // `status` re-joins after a reconnect so the member list is current.
  }, [client, status, workspaceId, entityDefinitionId, entityInstanceId, self.userId, self.name]);
  return users;
}
