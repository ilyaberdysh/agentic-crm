// One realtime connection per tab (D-08, BACKLOG 1.08 client side): connects after sign-in, subscribes to the
// workspace of the current route, maps invalidations onto the query cache and exposes the connection state that
// drives the offline banner (system-ui §5). Reconnect backoff 1/2/5/10/30/60 s lives in packages/realtime.
import { type ConnectionStatus, RealtimeClient } from '@agentic-crm/realtime/client';
import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { applyContinuityLost, applyInvalidation } from './invalidation';

export interface ConnectionState {
  status: ConnectionStatus;
  /** The browser reports no network (navigator.onLine / offline event). */
  browserOffline: boolean;
  /** When connectivity was lost (ms epoch); null while connected or before the first connection. */
  offlineSince: number | null;
  /** True once a connection has been established in this tab. */
  everConnected: boolean;
}

type Listener = () => void;

class ConnectionStore {
  private state: ConnectionState = {
    status: 'idle',
    browserOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
    offlineSince: null,
    everConnected: false,
  };
  private readonly listeners = new Set<Listener>();

  get = (): ConnectionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<ConnectionState>): void {
    const next = { ...this.state, ...patch };
    const lost = next.browserOffline || (next.everConnected && next.status === 'reconnecting');
    if (lost && next.offlineSince === null) next.offlineSince = Date.now();
    if (!lost) next.offlineSince = null;
    this.state = next;
    for (const l of this.listeners) l();
  }
}

export const connectionStore = new ConnectionStore();

let client: RealtimeClient | null = null;

function realtimeUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/realtime`;
}

export interface RealtimeHooks {
  queryClient: QueryClient;
  /** The server refused the session (4401): re-check the session. */
  onUnauthorized: () => void;
  /** Our membership of a subscribed workspace was removed. */
  onUnsubscribed?: (workspaceId: string) => void;
}

let hooks: RealtimeHooks | null = null;

/** Called once at boot, before anything subscribes. */
export function configureRealtime(next: RealtimeHooks): void {
  hooks = next;
  window.addEventListener('online', () => connectionStore.update({ browserOffline: false }));
  window.addEventListener('offline', () => connectionStore.update({ browserOffline: true }));
}

function ensureClient(): RealtimeClient {
  if (client) return client;
  const h = hooks;
  if (!h) throw new Error('configureRealtime() must run before the realtime client is used');
  client = new RealtimeClient({
    url: realtimeUrl,
    onInvalidate: (message) => void applyInvalidation(h.queryClient, message),
    onContinuityLost: (workspaceId) => void applyContinuityLost(h.queryClient, workspaceId),
    onUnsubscribed: (workspaceId) => h.onUnsubscribed?.(workspaceId),
    onStatusChange: (status) => {
      connectionStore.update({
        status,
        everConnected: connectionStore.get().everConnected || status === 'connected',
      });
      if (status === 'unauthorized') h.onUnauthorized();
    },
  });
  return client;
}

/** Connects for the signed-in user (idempotent). Subscriptions made earlier are sent once the socket is ready. */
export function startRealtime(): void {
  ensureClient().connect();
}

/** Sign-out: close the socket and forget subscriptions. */
export function stopRealtime(): void {
  client?.close();
  client = null;
  connectionStore.update({ status: 'closed', everConnected: false });
}

/** "retry" in the offline banner: skip the backoff wait. */
export function reconnectNow(): void {
  client?.reconnectNow();
}

export function getRealtimeClient(): RealtimeClient | null {
  return client;
}

/** Subscribes to a workspace's invalidations while mounted (ref-counted in the client). */
export function useRealtimeWorkspace(workspaceId: string | null | undefined): void {
  useEffect(() => {
    if (!workspaceId || !hooks) return;
    return ensureClient().subscribeWorkspace(workspaceId);
  }, [workspaceId]);
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(connectionStore.subscribe, connectionStore.get, connectionStore.get);
}
