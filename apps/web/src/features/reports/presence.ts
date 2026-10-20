// Dashboard presence (H README §2.2; Attio `presence-reporting-dashboard:<ws>:<id>`): every tab on a dashboard, its
// report viewer or its editor joins the room `reporting-dashboard:<workspaceId>:<dashboardId>`; headers show one avatar
// per member in it. Ephemeral only (I4b); joining needs read access to the dashboard.
import { createContext, useEffect, useState } from 'react';
import { getRealtimeClient, useConnectionState } from '../../data/realtime/connection';
import { type ListPresenceUser, presentUsers } from '../lists/presence';

export const dashboardRoom = (workspaceId: string, dashboardId: string) =>
  `reporting-dashboard:${workspaceId}:${dashboardId}`;

export function useDashboardPresence(
  workspaceId: string,
  dashboardId: string,
  self: { userId: string; name: string },
): ListPresenceUser[] {
  const [users, setUsers] = useState<ListPresenceUser[]>([]);
  const { status } = useConnectionState();
  const client = getRealtimeClient();
  useEffect(() => {
    if (!client || !dashboardId) return;
    const room = client.joinRoom(dashboardRoom(workspaceId, dashboardId), { name: self.name });
    setUsers(presentUsers(room.members(), self));
    const off = room.onPresence((members) => setUsers(presentUsers(members, self)));
    return () => {
      off();
      room.leave();
      setUsers([]);
    };
    // `status` re-joins after a reconnect so the member list is current.
  }, [client, status, workspaceId, dashboardId, self.userId, self.name]);
  return users;
}

/** The dashboard page joins the room once and hands the members to its editor / viewer overlay through this. */
export const DashboardPresenceContext = createContext<ListPresenceUser[]>([]);
