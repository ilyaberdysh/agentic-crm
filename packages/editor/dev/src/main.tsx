// Editor dev page: sign in, create or open a document (collab dev endpoints), and edit it in two editors
// side by side (`?doc=<id>`), or one full-size note window (`&single=1`, used by the e2e and parity visual examples).
import { Button, ThemeProvider, Toaster } from '@agentic-crm/ui';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type Block,
  type EditorHandle,
  type EditorStatus,
  InsertMenuButton,
  type MentionItem,
  PresenceAvatars,
  type PresenceUser,
  RichTextEditor,
  RichTextPreview,
} from '../../src/index.ts';
import * as s from './dev.css.ts';

interface Session {
  user: { id: string; name: string; email: string };
  workspaces: Array<{ id: string; name: string; memberId: string; memberName: string }>;
}

const params = new URLSearchParams(location.search);
const collabUrl = `${location.origin.replace(/^http/, 'ws')}/collab`;

async function getJson<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const response = await fetch(path, { credentials: 'include', ...init });
  const body = response.headers.get('content-type')?.includes('json') ? ((await response.json()) as T) : null;
  return { status: response.status, body };
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={s.panel}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await fetch('/api/auth/sign-in/email', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (r.ok) onDone();
        else setError(`Sign-in failed (${r.status})`);
      }}
    >
      <strong>Sign in to the dev API</strong>
      <label>
        Email
        <input className={s.field} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label>
        Password
        <input
          className={s.field}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error ? <p>{error}</p> : null}
      <Button type="submit">Continue</Button>
    </form>
  );
}

const SAMPLE = [
  '# Kickoff notes',
  'Discussed the **rollout plan** with the team, see [the brief](https://example.com/brief).',
  '- Introductions',
  '  - Current tooling',
  '1. Agree on owners',
  '2. Schedule the follow-up',
].join('\n');

function NoteWindow({
  session,
  documentId,
  label,
  narrow,
}: {
  session: Session;
  documentId: string;
  label: string;
  narrow: boolean;
}) {
  const workspace = session.workspaces[0];
  const [handle, setHandle] = useState<EditorHandle | null>(null);
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState<string>('connecting');
  const mentionSearch = useCallback(
    async (query: string, { signal }: { signal: AbortSignal }) => {
      const q = new URLSearchParams({ q: query, workspaceId: workspace?.id ?? '' });
      const r = await fetch(`/collab/dev/mentions?${q}`, { credentials: 'include', signal });
      return ((await r.json()) as { items: MentionItem[] }).items;
    },
    [workspace?.id],
  );
  const uploadImage = useCallback(
    (file: File) =>
      new Promise<{ url: string; assetId: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ url: String(reader.result), assetId: `dev-${crypto.randomUUID()}` });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      }),
    [],
  );
  if (!workspace) return <p>No workspace for {session.user.email}</p>;
  return (
    <section className={`${s.window} ${narrow ? s.narrowWindow : ''}`} data-testid={`note-window-${label}`}>
      <div className={s.topBar}>
        <span>{label === 'single' ? 'Dev workspace' : `Editor ${label}`}</span>
        <span className={s.status} data-testid="editor-status">
          {status}
        </span>
      </div>
      <div className={s.headerRow}>
        <PresenceAvatars users={users} size={24} />
      </div>
      <div className={s.column}>
        <h1 className={s.title}>{params.get('title') ?? 'Editor test note'}</h1>
        <div className={s.meta}>{params.get('meta') ?? workspace.name}</div>
        <div className={s.body}>
          <RichTextEditor
            documentId={documentId}
            docType="note"
            collabUrl={collabUrl}
            user={{ id: session.user.id, memberId: workspace.memberId, name: workspace.memberName }}
            readOnly={params.get('readonly') === '1'}
            autofocus={label !== 'B' ? 'end' : false}
            onReady={setHandle}
            className={s.editorRoot}
            mentionSearch={mentionSearch}
            uploadImage={uploadImage}
            onAwarenessChange={setUsers}
            onStatusChange={(st: EditorStatus, detail) =>
              setStatus(detail?.reason ? `${st}: ${detail.reason}` : detail?.readOnly ? `${st} (read-only)` : st)
            }
          />
        </div>
      </div>
      <div className={s.insertSlot}>
        <InsertMenuButton handle={handle} />
      </div>
    </section>
  );
}

function Projection({ documentId }: { documentId: string }) {
  const [doc, setDoc] = useState<{ blocks: Block[]; markdown: string; version: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await getJson<{ blocks: Block[]; markdown: string; version: number }>(
        `/collab/dev/documents/${documentId}`,
      );
      if (alive && r.body) setDoc(r.body);
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [documentId]);
  if (!doc) return null;
  return (
    <aside className={s.projection} data-testid="projection">
      <strong>Stored projection (v{doc.version})</strong>
      <RichTextPreview blocks={doc.blocks} />
      <pre className={s.markdown} data-testid="projection-markdown">
        {doc.markdown}
      </pre>
    </aside>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | 'signed-out'>(null);
  const [documentId, setDocumentId] = useState(params.get('doc'));
  const load = useCallback(async () => {
    const r = await getJson<Session>('/collab/dev/session');
    setSession(r.status === 200 && r.body ? r.body : 'signed-out');
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (session === null) return null;
  if (session === 'signed-out') return <SignIn onDone={load} />;
  if (!documentId) {
    return (
      <div className={s.panel}>
        <p>Signed in as {session.user.email}.</p>
        <Button
          onPress={async () => {
            const r = await getJson<{ id: string }>('/collab/dev/documents', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ markdown: SAMPLE }),
            });
            if (r.body) {
              params.set('doc', r.body.id);
              history.replaceState(null, '', `?${params}`);
              setDocumentId(r.body.id);
            }
          }}
        >
          Create a document
        </Button>
      </div>
    );
  }
  const single = params.get('single') === '1';
  return (
    <div className={s.page}>
      <NoteWindow session={session} documentId={documentId} label={single ? 'single' : 'A'} narrow={!single} />
      {single ? null : <NoteWindow session={session} documentId={documentId} label="B" narrow />}
      {params.get('projection') === '0' ? null : <Projection documentId={documentId} />}
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <App />
        <Toaster />
      </ThemeProvider>
    </StrictMode>,
  );
