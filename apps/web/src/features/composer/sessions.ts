// The registry of open composer sessions and their wiring to tRPC. A session is created when the window opens
// (`openComposer`, or a reload / reopen through `?modal=composer&id=`) and dropped when the window is closed: the
// overlay store tells us whether a draft is still open (modal, floating or minimised in the dock).
import { useSyncExternalStore } from 'react';
import { emailKeys } from '../../data/emailKeys';
import { queryClient } from '../../data/queryClient';
import { api, getCurrentWorkspace, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { overlayStore } from '../overlays';
import { deleteDraft } from './data';
import { type ComposerApi, type ComposerSeed, ComposerSession, type SessionSnapshot } from './session';

function realApi(ws: WorkspaceRef): ComposerApi {
  const ctx = inWorkspace(ws);
  return {
    create: async (input) => {
      const out = await api.email.drafts.create.mutate(input, ctx);
      noteAcceptAfter(ws.id, out.seq);
      void queryClient.invalidateQueries({ queryKey: emailKeys.drafts(ws.id) });
      return out.draft;
    },
    get: (draftId) => api.email.drafts.get.query({ draftId }, ctx),
    update: async (input) => {
      const out = await api.email.drafts.update.mutate(input, ctx);
      noteAcceptAfter(ws.id, out.seq);
      return out.draft;
    },
    remove: (draftId) => deleteDraft(queryClient, ws, draftId),
    createAttachment: async (input) => {
      const out = await api.email.drafts.attachments.create.mutate(input, ctx);
      noteAcceptAfter(ws.id, out.seq);
      return { attachment: out.attachment, uploadUrl: out.uploadUrl };
    },
    upload: async (url, file, contentType) => {
      const response = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: file }).catch(
        () => null,
      );
      if (!response?.ok) throw new Error('Failed to upload attachment');
    },
    commitAttachment: async (input) => {
      const out = await api.email.drafts.attachments.commit.mutate(input, ctx);
      noteAcceptAfter(ws.id, out.seq);
      return out.attachment;
    },
    removeAttachment: async (input) => {
      const out = await api.email.drafts.attachments.remove.mutate(input, ctx);
      noteAcceptAfter(ws.id, out.seq);
    },
    signature: async (mailboxId, signatureId) => {
      const list = await queryClient.fetchQuery({
        queryKey: emailKeys.signatures(ws.id, mailboxId),
        queryFn: () => api.email.signatures.list.query({ mailboxId }, ctx),
        staleTime: 30_000,
      });
      const found = list.find((s) => s.id === signatureId);
      return found ? { id: found.id, body: found.body as never } : null;
    },
  };
}

const sessions = new Map<string, ComposerSession>();
const listeners = new Set<() => void>();
let version = 0;

const bump = () => {
  version++;
  for (const l of listeners) l();
};

/** The session of a draft (created and started on first use). `seed` makes it a new draft. */
export function ensureSession(id: string, seed?: ComposerSeed): ComposerSession {
  const existing = sessions.get(id);
  if (existing) return existing;
  const ws = getCurrentWorkspace();
  if (!ws) throw new Error('No workspace');
  const session = new ComposerSession(id, realApi(ws), { newId });
  sessions.set(id, session);
  bump();
  void session.start(seed);
  return session;
}

export function peekSession(id: string): ComposerSession | undefined {
  return sessions.get(id);
}

/** Which composer drafts are open: modal / floating / minimised. */
function openDraftIds(): Set<string> {
  const state = overlayStore.getState();
  const ids = new Set<string>();
  for (const entry of state.stack) if (entry.type === 'window' && entry.kind === 'composer') ids.add(entry.id);
  for (const w of state.detached) if (w.kind === 'composer') ids.add(w.id);
  return ids;
}

/** Sessions whose window is gone are closed: pending edits are saved, an empty draft is deleted. */
export function sweepSessions(): void {
  const open = openDraftIds();
  for (const [id, session] of sessions) {
    if (open.has(id) || session.getSnapshot().status === 'loading') continue;
    sessions.delete(id);
    void session.close().then(bump);
    bump();
  }
}

let started = false;
/** Called once by the feature's registration. */
export function watchOverlays(): void {
  if (started) return;
  started = true;
  overlayStore.subscribe(sweepSessions);
}

const NONE: SessionSnapshot = {
  status: 'loading',
  draft: null,
  error: null,
  uploads: [],
  saving: false,
  saveError: null,
  signatureBlocks: null,
  finished: false,
};

/** The session of a draft with its snapshot; starts it when the window was opened by a URL. */
export function useComposerSession(id: string): { session: ComposerSession; snapshot: SessionSnapshot } {
  const session = ensureSession(id);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, () => NONE);
  return { session, snapshot };
}

/** The title / state of a draft for the dock bubble: from the open session (live), else loading. */
export function useDraftSubject(id: string): string {
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    const inner = sessions.get(id)?.subscribe(cb);
    return () => {
      listeners.delete(cb);
      inner?.();
    };
  };
  const read = () => {
    const snap = sessions.get(id)?.getSnapshot();
    return `${version}|${snap?.draft?.subject.text ?? ''}`;
  };
  const value = useSyncExternalStore(subscribe, read, read);
  return value.slice(value.indexOf('|') + 1);
}
