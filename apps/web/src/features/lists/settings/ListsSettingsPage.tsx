// Settings → Lists (J objects-lists §4): "Lists — Modify and add lists in your workspace" + "+ Create list"; search
// "Search lists"; table List (emoji + name) · Created by · Entries (count or "Empty") · ⋮ (Edit, Duplicate list,
// View list, Copy ID, Copy Slug, Delete list). Admins see every list (scope `all`). Empty: "No lists yet — There
// are currently no lists created".
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SearchField,
  Skeleton,
} from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type KeyboardEvent, useMemo, useState } from 'react';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { ActorLabel, copyToClipboard } from '../../notes/actors';
import * as os from '../../settings/objects/objects.css';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import * as shell from '../../shell/shell.css';
import { useWorkspace } from '../../shell/workspaceContext';
import { type List, listsQuery, sortLists } from '../data';
import { listPath, openListsDialog } from '../flows';
import { ListIcon } from '../icon';
import { ListDialogs } from '../ListPage';
import * as s from '../lists.css';

export function filterLists(lists: readonly List[], query: string): List[] {
  const q = query.trim().toLowerCase();
  return q ? lists.filter((l) => l.name.toLowerCase().includes(q) || l.apiSlug.includes(q)) : [...lists];
}

export function ListsSettingsPage() {
  useDocumentTitle('Lists');
  const { workspace, href, isAdmin } = useWorkspace();
  // Admins see every list here regardless of their own access (J objects-lists §4).
  const lists = useQuery(listsQuery(workspace, isAdmin ? 'all' : 'readable'));
  const [query, setQuery] = useState('');
  const visible = useMemo(() => filterLists(sortLists(lists.data ?? [], 'custom'), query), [lists.data, query]);
  return (
    <>
      <PageHeader crumbs={[{ label: 'Lists', icon: 'list' }]} actions={<HelpButton />} />
      <div className={shell.content}>
        <div className={os.page} data-testid="settings-lists">
          <div className={os.headerRow}>
            <div>
              <h1 className={os.pageTitle}>Lists</h1>
              <p className={os.pageDescription}>Modify and add lists in your workspace</p>
            </div>
            <Button
              size={28}
              icon="add"
              onPress={() => openListsDialog({ kind: 'create-list', then: 'open-settings' })}
            >
              Create list
            </Button>
          </div>
          <div className={os.pageRule} />
          <div className={os.toolbar}>
            <SearchField
              aria-label="Search lists"
              placeholder="Search lists"
              size={32}
              value={query}
              onChange={setQuery}
              className={os.toolbarSearch}
            />
          </div>
          <div className={os.table} role="table" aria-label="Lists">
            <div className={`${os.tableHeader} ${s.listsGrid}`} role="row">
              <div className={os.headerCell} role="columnheader">
                <Icon icon="list" size={14} className={os.headerIcon} />
                List
              </div>
              <div className={os.headerCell} role="columnheader">
                <Icon icon="person" size={14} className={os.headerIcon} />
                Created by
              </div>
              <div className={os.headerCell} role="columnheader">
                <Icon icon="record" size={14} className={os.headerIcon} />
                Entries
              </div>
              <div role="columnheader" aria-label="Actions" />
            </div>
            {lists.isPending &&
              [0, 1, 2].map((i) => (
                <div key={i} className={`${os.row} ${s.listsGrid}`} data-static role="row">
                  <Skeleton shape="text" width={140} />
                  <Skeleton shape="text" width={100} />
                  <Skeleton shape="text" width={32} />
                </div>
              ))}
            {lists.isError && (
              <ErrorState
                message="Failed to load lists"
                iconSize={16}
                style={{ padding: 24 }}
                actions={
                  <Button variant="secondary" size={28} onPress={() => void lists.refetch()}>
                    Retry
                  </Button>
                }
              />
            )}
            {lists.data && lists.data.length === 0 && (
              <EmptyState
                icon="list"
                title="No lists yet"
                description="There are currently no lists created"
                style={{ padding: '40px 24px' }}
              />
            )}
            {visible.map((l) => (
              <ListRow key={l.id} list={l} settingsHref={href(`settings/data/lists/${l.id}/general`)} />
            ))}
            {lists.data && lists.data.length > 0 && visible.length === 0 && (
              <div className={os.tableEmpty}>No lists match that search</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ListRow({ list, settingsHref }: { list: List; settingsHref: string }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<'duplicate' | 'delete' | null>(null);
  const open = () => void navigate({ href: settingsHref });
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open();
    }
  };
  return (
    <>
      <div
        className={`${os.row} ${s.listsGrid}`}
        role="row"
        tabIndex={0}
        onClick={open}
        onKeyDown={onKeyDown}
        data-testid="settings-list-row"
      >
        <div className={os.cell} role="cell">
          <ListIcon icon={list.icon} size={16} />
          <span className={os.cellText}>{list.name}</span>
        </div>
        <div className={os.cell} role="cell">
          <ActorLabel actor={list.createdBy} />
        </div>
        <div className={os.cell} role="cell">
          {list.entryCount === null ? (
            ''
          ) : list.entryCount === 0 ? (
            <span className={os.muted}>Empty</span>
          ) : (
            list.entryCount.toLocaleString()
          )}
        </div>
        <div
          className={os.rowActions}
          role="cell"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label="Options" variant="ghost" size={28} />
            <Menu
              aria-label="Options"
              placement="bottom end"
              width={180}
              onAction={(key) => {
                if (key === 'edit') open();
                else if (key === 'duplicate') setDialog('duplicate');
                else if (key === 'view') void navigate({ href: href(listPath(list)) });
                else if (key === 'copy-id') void copyToClipboard(list.id);
                else if (key === 'copy-slug') void copyToClipboard(list.apiSlug);
                else if (key === 'delete') setDialog('delete');
              }}
            >
              <MenuItem id="edit" icon="edit">
                Edit
              </MenuItem>
              <MenuItem id="duplicate" icon="duplicate">
                Duplicate list
              </MenuItem>
              <MenuItem id="view" icon="arrowUpRight">
                View list
              </MenuItem>
              <MenuItem id="copy-id" icon="copy">
                Copy ID
              </MenuItem>
              <MenuItem id="copy-slug" icon="copy">
                Copy Slug
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger">
                Delete list
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      </div>
      <ListDialogs list={list} dialog={dialog} onClose={() => setDialog(null)} afterDelete="stay" />
    </>
  );
}
