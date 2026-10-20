// Session: who is signed in, sign-in / sign-up / sign-out, expiry handling (D-15).
// Email + password through Better Auth (/api/auth/*); the session cookie is HttpOnly. Sign-out in one tab signs out
// every tab (BroadcastChannel + storage event, like the "agentic-crm:sign-out").
import { queryOptions, useQuery } from '@tanstack/react-query';
import { writeRaw } from '../lib/storage';
import { keys } from './keys';
import { resetAppQueues } from './mutations';
import { queryClient, setUnauthorizedHandler } from './queryClient';
import { stopRealtime } from './realtime/connection';
import { api, isUnauthorized, type RouterOutputs, requestJson, resetAcceptAfter, setCurrentWorkspace } from './trpc';

export type Me = RouterOutputs['me'];

async function fetchMe(): Promise<Me | null> {
  try {
    return await api.me.query();
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
}

/** The signed-in user, or null when signed out. */
export const meQuery = () =>
  queryOptions({
    queryKey: keys.me(),
    queryFn: fetchMe,
    staleTime: 10 * 60_000,
  });

export function useMe(): Me | null {
  return useQuery(meQuery()).data ?? null;
}

export function firstName(me: Me | null): string {
  const name = me?.user.name?.trim() ?? '';
  return name.split(/\s+/)[0] ?? '';
}

// ---- sign in / up ---------------------------------------------------------------------------------------------

export interface Credentials {
  email: string;
  password: string;
}

export function signIn({ email, password }: Credentials): Promise<unknown> {
  return requestJson('/api/auth/sign-in/email', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), password, rememberMe: true },
  });
}

export function signUp({ email, password, name }: Credentials & { name: string }): Promise<unknown> {
  return requestJson('/api/auth/sign-up/email', {
    method: 'POST',
    json: { email: email.trim().toLowerCase(), password, name: name.trim() },
  });
}

// ---- sign out -------------------------------------------------------------------------------------------------

const SIGN_OUT_CHANNEL = 'ar:sign-out';
const SIGN_OUT_KEY = 'sign-out';

let navigateToSignIn: (origin: string | null) => void = (origin) => {
  window.location.assign(origin ? `/auth/sign-in?origin=${encodeURIComponent(origin)}` : '/auth/sign-in');
};

/** Drops everything user-specific held in this tab. */
function clearLocalSession(): void {
  stopRealtime();
  resetAppQueues();
  resetAcceptAfter();
  setCurrentWorkspace(null);
  queryClient.clear();
}

function broadcastSignOut(): void {
  try {
    const channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
    channel.postMessage('sign-out');
    channel.close();
  } catch {
    // no BroadcastChannel: the storage event below still reaches other tabs
  }
  writeRaw(SIGN_OUT_KEY, String(Date.now()));
  writeRaw(SIGN_OUT_KEY, null);
}

/** Sidebar "Sign out" and the auth-page footers: end the session server-side and land on the sign-in page. */
export function signOut(): void {
  broadcastSignOut();
  clearLocalSession();
  // Server clears the cookie and redirects to /auth/sign-in (GET /auth/logout).
  window.location.assign('/api/auth/logout');
}

// ---- expiry  --------------------------------------------------------------------------------

/** Re-checks the session after a 401: 3 attempts, 100 ms × 2 backoff; network errors count as signed in. */
export async function verifySession(): Promise<'signed-in' | 'signed-out'> {
  let delay = 100;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('/api/auth/whoami', { credentials: 'include', cache: 'no-store' });
      if (response.status === 401) return 'signed-out';
      if (response.ok) return 'signed-in';
    } catch {
      // network: try again, then assume still signed in
    }
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  return 'signed-in';
}

let checking: Promise<void> | null = null;

/** Single-flight: any 401 → whoami; only a 401 from whoami signs the tab out (keeping the page as origin). */
export function handleUnauthorized(): Promise<void> {
  if (checking) return checking;
  checking = verifySession()
    .then((state) => {
      if (state !== 'signed-out') return;
      const here = `${window.location.pathname}${window.location.search}`;
      clearLocalSession();
      navigateToSignIn(here.startsWith('/auth/') ? null : here);
    })
    .finally(() => {
      checking = null;
    });
  return checking;
}

/** Wires 401 handling and cross-tab sign-out. `navigate` lets the router do the redirect without a reload. */
export function installSessionHandling(navigate: (origin: string | null) => void): () => void {
  navigateToSignIn = navigate;
  setUnauthorizedHandler(() => void handleUnauthorized());
  const onRemoteSignOut = () => {
    clearLocalSession();
    navigateToSignIn(null);
  };
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
    channel.onmessage = onRemoteSignOut;
  } catch {
    channel = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === `ar:${SIGN_OUT_KEY}` && e.newValue) onRemoteSignOut();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    setUnauthorizedHandler(null);
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}
