// Workflows index `/$ws/automations/workflows`:
// G-list-empty.png): header (Help, Ask AI); toolbar "Sorted by Last published" | Filter (Created by) … search, View
// settings (Group by, Show favorites, Show archived), "+ New workflow"; the Favorites strip; the table grouped by
// date buckets (default "Last published"; paused and never-published workflows fall into "Unpublished"). Rows link
// to the editor; hover shows the star and the workflow menu. Sort / filter / view settings are per user (local).

import {
  Button,
  Icon,
  IconButton,
  type IconName,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Submenu,
  Switch,
  Tooltip,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { usePersistentState } from '../../../lib/storage';
import { useDocumentTitle } from '../../../lib/useDocumentTitle';
import { useMembers } from '../../attributes/data/queries';
import { memberName } from '../../attributes/format/formatValue';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { timeAgo } from '../../comments/timeAgo';
import { useFavorites, useFavoriteToggle } from '../../favorites/data';
import { IndexState } from '../../notes/indexParts';
import * as notes from '../../notes/notesPage.css';
import { HelpButton, PageHeader } from '../../shell/PageHeader';
import { useWorkspace } from '../../shell/workspaceContext';
import { createWorkflow, reportError, useWorkflows, useWs } from '../data';
import {
  DEFAULT_LIST_SETTINGS,
  filterWorkflows,
  GROUP_LABELS,
  type GroupField,
  groupWorkflows,
  type ListSettings,
  publishedAt,
  SORT_LABELS,
  type SortField,
  sortWorkflows,
} from '../model/list';
import { editorPath } from '../paths';
import type { Workflow } from '../types';
import { StatusChip, WorkflowTile } from '../ui/parts';
import { WorkflowMenu } from '../ui/WorkflowMenu';
import * as s from './list.css';

const SORT_ICONS: Record<SortField, IconName> = {
  'created-at': 'clock',
  'last-published': 'calendar',
  runs: 'wfRetry',
  name: 'attrText',
  'last-failed-run': 'warning',
};

export function useNewWorkflow() {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const start = async () => {
    if (pending) return;
    setPending(true);
    try {
      const workflow = await createWorkflow(ws);
      await navigate({ href: href(editorPath(workflow.id)) });
    } catch (error) {
      reportError(error, 'Failed to create workflow');
    } finally {
      setPending(false);
    }
  };
  return { start, pending };
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

export function WorkflowsPage() {
  useDocumentTitle('Workflows');
  const [settings, setSettings] = usePersistentState<ListSettings>('workflows:list-settings', DEFAULT_LIST_SETTINGS);
  const conf = { ...DEFAULT_LIST_SETTINGS, ...settings };
  const patch = (p: Partial<ListSettings>) => setSettings((prev) => ({ ...DEFAULT_LIST_SETTINGS, ...prev, ...p }));
  const list = useWorkflows({ includeArchived: true });
  const members = useMembers();
  const favorites = useFavorites().data;
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const newWorkflow = useNewWorkflow();

  const all = list.data ?? [];
  const visible = useMemo(() => filterWorkflows(all, conf, query), [all, conf.showArchived, conf.createdBy, query]);
  const sorted = useMemo(() => sortWorkflows(visible, conf.sort, conf.direction), [visible, conf.sort, conf.direction]);
  const creatorName = (w: Workflow) =>
    memberName(members.find((m) => m.id === w.createdBy.id)) ||
    (w.createdBy.type === 'workflow' ? 'Workflow' : 'Unknown');
  const groups = useMemo(() => groupWorkflows(sorted, conf.group, { creatorName }), [sorted, conf.group, members]);
  const favoriteIds = new Set(
    (favorites?.favorites ?? []).filter((f) => f.favoriteType === 'workflow').map((f) => f.targetId),
  );
  const favoriteRows = sorted.filter((w) => favoriteIds.has(w.id));
  const empty = list.isSuccess && all.filter((w) => !w.isArchived).length === 0 && !conf.showArchived;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Workflows', icon: 'workflows' }]}
        actions={
          <>
            <HelpButton />
            <Button variant="secondary" size={28} icon="chat">
              Ask AI
            </Button>
          </>
        }
      />
      <div className={s.page} data-testid="workflows-page">
        <div className={notes.toolbar}>
          <SortMenu settings={conf} onChange={patch} />
          <span className={s.divider} />
          <FilterMenu settings={conf} onChange={patch} />
          <span className={notes.toolbarSpacer} />
          {searching ? (
            <div className={s.searchBox}>
              <Icon icon="search" size={14} />
              <input
                autoFocus
                className={s.searchInput}
                placeholder="Search workflows"
                aria-label="Search workflows"
                value={query}
                disabled={list.isPending}
                onChange={(e) => setQuery(e.target.value)}
                onBlur={() => !query && setSearching(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setQuery('');
                    setSearching(false);
                  }
                }}
              />
            </div>
          ) : (
            <IconButton icon="search" variant="secondary" aria-label="Search" onPress={() => setSearching(true)} />
          )}
          <ViewSettingsMenu settings={conf} onChange={patch} />
          <Button
            variant="primary"
            size={28}
            icon="add"
            isPending={newWorkflow.pending}
            onPress={() => void newWorkflow.start()}
            data-testid="new-workflow"
          >
            New workflow
          </Button>
        </div>
        {list.isError ? (
          <IndexState error text="Something went wrong trying to load workflows. Refresh the page to try again." />
        ) : empty ? (
          <EmptyState onNew={() => void newWorkflow.start()} pending={newWorkflow.pending} />
        ) : (
          <div className={s.scroll}>
            {conf.showFavorites && (
              <div className={notes.favorites} data-testid="workflow-favorites">
                <p className={notes.favoritesLabel}>Favorites</p>
                {favoriteRows.length === 0 ? (
                  <div className={notes.favoritesEmpty} style={{ height: 152 }}>
                    <span className={notes.favoritesEmptyTitle}>Favorites</span>
                    <span className={notes.favoritesEmptyText}>Workflows that you favorite will appear here</span>
                  </div>
                ) : (
                  <div>
                    {favoriteRows.map((w) => (
                      <WorkflowRow key={w.id} workflow={w} favorite creator={creatorName(w)} />
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className={`${s.columns} ${s.head} ${conf.showFavorites ? '' : s.headFirst}`} role="row">
              <HeadCell icon="workflows" label="Workflow" />
              <HeadCell icon="wfRetry" label="Runs" />
              <HeadCell icon="reports" label="Status" />
              <HeadCell icon="person" label="Created by" />
              <HeadCell icon="calendar" label="Last published" />
              <HeadCell icon="warning" label="Last failed run" />
            </div>
            {list.isPending
              ? null
              : groups.map((g) => (
                  <section key={g.key} data-testid="workflow-group" data-group={g.key}>
                    {conf.group !== 'none' && (
                      <div className={s.group}>
                        {g.label}
                        <span className={s.count}>{g.workflows.length}</span>
                      </div>
                    )}
                    {g.workflows.map((w) => (
                      <WorkflowRow key={w.id} workflow={w} favorite={favoriteIds.has(w.id)} creator={creatorName(w)} />
                    ))}
                  </section>
                ))}
            {!list.isPending && sorted.length === 0 && <IndexState text="No workflows match your filters." />}
          </div>
        )}
      </div>
    </>
  );
}

function HeadCell({ icon, label }: { icon: IconName; label: string }) {
  return (
    <div className={s.headCell} role="columnheader">
      <Icon icon={icon} size={14} className={s.headIcon} />
      {label}
    </div>
  );
}

function WorkflowRow({ workflow: w, favorite, creator }: { workflow: Workflow; favorite: boolean; creator: string }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const members = useMembers();
  const member = members.find((m) => m.id === w.createdBy.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const star = useFavoriteToggle({ favoriteType: 'workflow', targetId: w.id });
  const link = href(editorPath(w.id));
  const open = (newTab: boolean) => {
    if (newTab) window.open(link, '_blank');
    else void navigate({ href: link });
  };
  return (
    <div
      role="row"
      tabIndex={0}
      className={`${s.columns} ${s.row}`}
      data-testid="workflow-row"
      data-workflow-id={w.id}
      data-menu-open={menuOpen || undefined}
      onClick={(e) => open(e.metaKey || e.ctrlKey)}
      onAuxClick={(e) => e.button === 1 && open(true)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') open(e.metaKey || e.ctrlKey);
      }}
    >
      <div className={s.cell}>
        <WorkflowTile workflowId={w.id} />
        <span className={`${s.title} ${w.isArchived ? s.archivedTitle : ''}`}>{w.displayTitle}</span>
        <span
          className={s.rowActions}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
          style={favorite ? { display: 'inline-flex' } : undefined}
        >
          <IconButton
            icon={favorite ? 'favoriteFilled' : 'favorite'}
            size={20}
            aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            tooltip={favorite ? 'Remove from favorites' : 'Add to favorites'}
            onPress={star.toggle}
            style={favorite ? { color: '#f5a524' } : undefined}
          />
          <WorkflowMenu
            workflow={w}
            onOpenChange={setMenuOpen}
            trigger={<IconButton icon="moreVertical" size={20} aria-label="Workflow menu" />}
          />
        </span>
      </div>
      <div className={s.cell}>{w.runCount}</div>
      <div className={s.cell}>
        <StatusChip workflow={w} />
      </div>
      <div className={s.cell}>
        <MemberAvatar member={member} size={16} />
        <span className={s.truncate} style={{ maxWidth: 105 }}>
          {creator}
        </span>
      </div>
      <div className={s.cell}>{formatDate(publishedAt(w))}</div>
      <div className={`${s.cell} ${s.muted}`}>{w.lastRunFailedAt ? timeAgo(w.lastRunFailedAt) : ''}</div>
    </div>
  );
}

function SortMenu({ settings, onChange }: { settings: ListSettings; onChange: (p: Partial<ListSettings>) => void }) {
  return (
    <MenuTrigger>
      <AriaButton className={notes.sortButton} data-testid="workflows-sort">
        <Icon icon="sort" size={16} className={notes.muted} />
        <span className={notes.muted}>Sorted by</span>
        {SORT_LABELS[settings.sort]}
      </AriaButton>
      <Menu
        aria-label="Sort workflows"
        placement="bottom start"
        width={220}
        selectionMode="multiple"
        selectedKeys={[settings.sort, settings.direction]}
        onSelectionChange={(keys) => {
          for (const key of keys as Set<string>) {
            if ((key === 'asc' || key === 'desc') && key !== settings.direction) onChange({ direction: key });
            if (key in SORT_LABELS && key !== settings.sort) onChange({ sort: key as SortField });
          }
        }}
      >
        <MenuSection>
          {(Object.keys(SORT_LABELS) as SortField[]).map((k) => (
            <MenuItem key={k} id={k} icon={SORT_ICONS[k]}>
              {SORT_LABELS[k]}
            </MenuItem>
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuSection>
          <MenuItem id="asc" icon="arrowUp">
            Ascending
          </MenuItem>
          <MenuItem id="desc" icon="arrowDown">
            Descending
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

function FilterMenu({ settings, onChange }: { settings: ListSettings; onChange: (p: Partial<ListSettings>) => void }) {
  const members = useMembers();
  const active = settings.createdBy.length > 0;
  const names = settings.createdBy.map((id) => memberName(members.find((m) => m.id === id)) || 'Unknown');
  return (
    <MenuTrigger>
      <AriaButton className={s.filterButton} data-active={active || undefined} data-testid="workflows-filter">
        <Icon icon="filter" size={14} />
        {active ? `Created by ${names.join(', ')}` : 'Filter'}
      </AriaButton>
      <Menu aria-label="Filter workflows" placement="bottom start" width={240}>
        <Submenu label="Created by" icon="person" menuWidth={260}>
          {members.map((m) => {
            const on = settings.createdBy.includes(m.id);
            return (
              <MenuItem
                key={m.id}
                id={`member-${m.id}`}
                icon={<MemberAvatar member={m} size={16} />}
                trailing={on ? <Icon icon="check" size={14} /> : undefined}
                onAction={() =>
                  onChange({
                    createdBy: on ? settings.createdBy.filter((x) => x !== m.id) : [...settings.createdBy, m.id],
                  })
                }
              >
                {memberName(m)}
              </MenuItem>
            );
          })}
        </Submenu>
        {active && <MenuSeparator />}
        {active && (
          <MenuItem id="clear" icon="close" onAction={() => onChange({ createdBy: [] })}>
            Clear filter
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}

function ViewSettingsMenu({
  settings,
  onChange,
}: {
  settings: ListSettings;
  onChange: (p: Partial<ListSettings>) => void;
}) {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="viewSettings" data-testid="workflows-view-settings">
        View settings
      </Button>
      <Menu aria-label="View settings" placement="bottom end" width={260}>
        <Submenu
          label="Group by"
          icon="rows"
          trailing={<span className={notes.muted}>{GROUP_LABELS[settings.group]}</span>}
        >
          {(['created-at', 'status', 'last-published', 'creator'] as GroupField[]).map((k) => (
            <MenuItem
              key={k}
              id={`group-${k}`}
              onAction={() => onChange({ group: k })}
              trailing={settings.group === k ? <Icon icon="check" size={14} /> : undefined}
            >
              {GROUP_LABELS[k]}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            id="group-none"
            onAction={() => onChange({ group: 'none' })}
            trailing={settings.group === 'none' ? <Icon icon="check" size={14} /> : undefined}
          >
            None
          </MenuItem>
        </Submenu>
        <MenuSeparator />
        <MenuItem
          id="favorites"
          icon="favorite"
          onAction={() => onChange({ showFavorites: !settings.showFavorites })}
          trailing={
            <Switch
              isSelected={settings.showFavorites}
              aria-label="Show favorites"
              onChange={(v) => onChange({ showFavorites: v })}
            />
          }
        >
          Show favorites
        </MenuItem>
        <MenuItem
          id="archived"
          icon="folder"
          onAction={() => onChange({ showArchived: !settings.showArchived })}
          trailing={
            <Switch
              isSelected={settings.showArchived}
              aria-label="Show archived"
              onChange={(v) => onChange({ showArchived: v })}
            />
          }
        >
          Show archived
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

function EmptyState({ onNew, pending }: { onNew: () => void; pending: boolean }) {
  return (
    <div className={s.empty} data-testid="workflows-empty">
      <div className={s.emptyArt} aria-hidden="true">
        <Icon icon="objects" size={72} strokeWidth={0.9} />
      </div>
      <h2 className={s.emptyTitle}>Workflows</h2>
      <p className={s.emptyText}>No workflows yet! Create your first workflow to get started.</p>
      <Button variant="primary" size={28} icon="add" isPending={pending} onPress={onNew}>
        New workflow
      </Button>
      <div className={s.learnMore}>
        <span className={s.learnLabel}>Learn more</span>
        <Tooltip content="Open the workflows guide">
          <a
            className={s.academyCard}
            href="https://github.com/ilyaberdysh/agentic-crm#what-works-today"
            target="_blank"
            rel="noreferrer"
          >
            <span className={s.academyTile}>
              <Icon icon="wfAcademy" size={20} />
            </span>
            Workflows
          </a>
        </Tooltip>
      </div>
    </div>
  );
}
