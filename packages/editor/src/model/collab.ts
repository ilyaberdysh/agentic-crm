// Contract between the editor (HocuspocusProvider) and apps/collab (Hocuspocus server).
//
// Transport: one WebSocket per tab to `collabUrl` (dev: ws://localhost:5173/collab, proxied to port 4101),
// authenticated by the `agentic-crm-session` cookie on the upgrade request; documents are multiplexed on it.
// Document name = the document id (a note's id). The server resolves its workspace, checks membership and the
// document's parent permissions, and answers the provider's auth message with `authenticated` (scope read-write or
// readonly) or `permission-denied` with one of the reasons below.
// Awareness (y-protocols): each client publishes `user` (identity, rewritten by the server from the session so it
// cannot be spoofed) and `cursor` (Yjs relative anchor/head, written by the caret plugin).

export type CollabDenyReason = 'unauthorized' | 'forbidden' | 'not-found';

export interface CollabAwarenessUser {
  /** Auth user id: presence is de-duplicated per user (one avatar per user, X-04). */
  id: string;
  /** Workspace member id (colour seed, mentions). */
  memberId: string;
  name: string;
  /** Peer colour (presenceColor(memberId)). */
  color: string;
  avatarUrl?: string | null;
}

/** WebSocket close codes the server uses on the whole socket. */
export const CollabCloseCode = {
  /** Session missing, expired or signed out: do not reconnect until signed in again. */
  unauthorized: 4401,
  /** The document was deleted while open. */
  documentDeleted: 4404,
} as const;
