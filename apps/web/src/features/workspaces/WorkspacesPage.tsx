// `/workspaces` — workspace picker (legacy-welcome): member workspaces, then invited ones
// ("Invited" badge → join link); search only above 5 entries (⌘F focuses it, ↓ moves to the first row);
// ↑/↓/Home/End move between rows. Signed out (or failing) → the error state with Sign out.
import { Avatar, Badge, Icon, SearchField } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, type MouseEvent, useMemo, useRef, useState } from 'react';
import { myInvitesQuery } from '../../data/invites';
import { meQuery } from '../../data/session';
import { workspacesQuery } from '../../data/workspaces';
import { useShortcut } from '../../lib/shortcuts';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { AuthLayout } from '../auth/AuthLayout';
import * as a from '../auth/auth.css';
import * as s from './workspaces.css';

interface Entry {
  key: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  seed: string;
  invited: boolean;
  to: string;
}

export function WorkspacesPage() {
  useDocumentTitle('Workspaces');
  const me = useQuery(meQuery());
  const signedIn = Boolean(me.data);
  const workspaces = useQuery({ ...workspacesQuery(), enabled: signedIn });
  const invites = useQuery({ ...myInvitesQuery(), enabled: signedIn });
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const entries = useMemo<Entry[]>(() => {
    const members = (workspaces.data ?? []).map((w) => ({
      key: w.id,
      name: w.name,
      slug: w.slug,
      logoUrl: w.logoUrl,
      seed: w.id,
      invited: false,
      to: `/${w.slug}`,
    }));
    const memberSlugs = new Set(members.map((m) => m.slug));
    const invited = (invites.data ?? [])
      .filter((i) => !memberSlugs.has(i.workspace.slug))
      .map((i) => ({
        key: i.id,
        name: i.workspace.name,
        slug: i.workspace.slug,
        logoUrl: i.workspace.logoUrl,
        seed: i.workspace.id,
        invited: true,
        to: `/auth/join/${i.workspace.slug}?invite=${i.id}`,
      }));
    return [...members.sort((x, y) => x.name.localeCompare(y.name)), ...invited];
  }, [workspaces.data, invites.data]);

  const showSearch = entries.length > 5;
  const q = query.trim().toLowerCase();
  const visible = q ? entries.filter((e) => e.name.toLowerCase().includes(q) || e.slug.includes(q)) : entries;

  useShortcut(showSearch ? 'mod+f' : null, () => searchRef.current?.focus());

  const failed = me.isError || (me.isSuccess && !me.data) || workspaces.isError;
  if (failed) {
    return (
      <AuthLayout signOut contentClassName={a.status}>
        <Icon icon="empty" size={48} className={s.errorIllustration} />
        <div className={a.statusText}>Something went wrong.</div>
        <div className={a.statusText}>Try signing out and in again. If the issue persists, please contact support.</div>
      </AuthLayout>
    );
  }

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-row]') ?? [])];
  // Rows are plain anchors (own focus model); a plain click still navigates client-side.
  const openRow = (event: MouseEvent, href: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void navigate({ href });
  };
  const onListKeyDown = (event: KeyboardEvent) => {
    const all = rows();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLAnchorElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : Math.min(all.length - 1, index + 1);
    if (event.key === 'ArrowUp') next = index < 0 ? all.length - 1 : Math.max(0, index - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = all.length - 1;
    if (next === null) return;
    event.preventDefault();
    all[next]?.focus();
  };

  return (
    <AuthLayout signOut wide>
      <div className={s.column}>
        <div className={s.titleBlock}>
          <h1 className={s.title}>Workspaces</h1>
          <p className={s.subtitle}>Jump into an existing workspace or add a new one</p>
        </div>
        <div className={`${s.divider} ${s.dividerFaint}`} />
        {showSearch && (
          <SearchField
            ref={searchRef}
            aria-label="Search workspaces"
            placeholder="Search..."
            size={32}
            autoFocus
            value={query}
            onChange={setQuery}
            className={s.search}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                rows()[0]?.focus();
              }
            }}
          />
        )}
        <div ref={listRef} className={s.list} role="group" aria-label="Workspaces" onKeyDown={onListKeyDown}>
          {workspaces.isPending && <div className={s.empty}>Loading...</div>}
          {!workspaces.isPending && visible.length === 0 && (
            <div className={s.empty}>
              {q ? `No workspaces found matching "${query.trim()}"` : 'No workspaces found'}
            </div>
          )}
          {visible.map((e) => (
            <a key={e.key} href={e.to} data-row className={s.row} onClick={(ev) => openRow(ev, e.to)}>
              <Avatar kind="workspace" name={e.name} src={e.logoUrl} seed={e.seed} size={28} />
              <span className={s.rowText}>
                <span className={s.rowName}>
                  {e.name}
                  {e.invited && (
                    <Badge variant="secondary" size={16}>
                      Invited
                    </Badge>
                  )}
                </span>
                <span className={s.rowUrl}>
                  {window.location.host}/{e.slug}
                </span>
              </span>
              <Icon icon="chevronRight" size={16} className={s.rowChevron} />
            </a>
          ))}
        </div>
        <div className={s.divider} style={{ margin: '0 0 24px' }} />
        <Link to="/welcome/workspace-details" className={s.addRow}>
          <Icon icon="add" size={16} />
          Add new workspace
        </Link>
      </div>
    </AuthLayout>
  );
}
