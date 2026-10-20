// Sidebar "Favorites" (BACKLOG 3.17; B sidebar §6; evidence B/sidebar-favorites-dragging.png,
// sidebar-favorites-folder-menu.png, dialog-delete-folder.png): shown with ≥ 1 favourite or folder (or while creating
// one). Hover "+" folder action → inline "Folder name..." row at the top. Rows by type (record, view, note, template)
// with a hover "Remove favorite"; folders open / close (persisted per folder, default open) with "No items" when empty
// and ⋮ Rename / Delete folder (deleting removes its favourites too). Drag and drop (5 px to start): grey placeholder,
// overlay 20 px below the pointer, 2 px drop lines, drop into folders (closed folders open after 1.5 s).
import {
  AlertDialog,
  Icon,
  IconButton,
  type IconName,
  Menu,
  MenuItem,
  MenuTrigger,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { objectPath, useObjects } from '../../data/objects';
import { api, errorEnvelopeOf, inWorkspace } from '../../data/trpc';
import { readJson, writeJson } from '../../lib/storage';
import { useObjectDefinition } from '../attributes/data/queries';
import { RecordAvatar, recordKind, recordPath } from '../attributes/ui/primitives';
import { openNewNote } from '../notes/NewNote';
import { openNote } from '../overlays/store';
import { SidebarSection } from '../shell/SidebarSection';
import * as shell from '../shell/shell.css';
import { useSidebar } from '../shell/sidebarState';
import { useWorkspace } from '../shell/workspaceContext';
import {
  createDirectory,
  deleteDirectory,
  type Favorite,
  type FavoriteDirectory,
  favoriteTree,
  moveFavorite,
  removeFavorite,
  updateDirectory,
  useFavorites,
} from './data';
import { type DropTarget, type FlatRow, flatten, resolveDrop } from './dnd';
import * as s from './favorites.css';

const folderKey = (id: string) => `favorite-directory:${id}`;

function useFolderOpen(): [(id: string) => boolean, (id: string, open: boolean) => void] {
  const [version, setVersion] = useState(0);
  const isOpen = useCallback((id: string) => readJson<boolean>(folderKey(id), true), [version]);
  const setOpen = useCallback((id: string, open: boolean) => {
    writeJson(folderKey(id), open);
    setVersion((v) => v + 1);
  }, []);
  return [isOpen, setOpen];
}

// ---- rows ----------------------------------------------------------------------------------------------------------------

function RecordIcon({ entityDefinitionId }: { entityDefinitionId: string | null }) {
  const definition = useObjectDefinition(entityDefinitionId);
  return <RecordAvatar kind={recordKind(definition)} size={16} />;
}

const TYPE_ICON: Partial<Record<Favorite['favoriteType'], IconName>> = {
  note: 'notes',
  'note-template': 'noteTemplate',
  'entity-view': 'table',
  'collection-view': 'list',
  'email-template': 'emails',
  'reporting-dashboard': 'dashboards',
  workflow: 'workflows',
  sequence: 'sequences',
  'call-recording': 'meeting',
  'merlin-thread': 'chat',
};

const UNTITLED: Partial<Record<Favorite['favoriteType'], string>> = {
  record: 'Untitled record',
  note: 'Untitled note',
  'note-template': 'Untitled note template',
  'reporting-dashboard': 'Untitled dashboard',
};

function FavoriteContent({ favorite }: { favorite: Favorite }) {
  if (favorite.target.state === 'forbidden') {
    return (
      <>
        <span className={s.rowIcon}>
          <Icon icon="lock" size={16} />
        </span>
        <span className={s.label}>Private item</span>
      </>
    );
  }
  const label = favorite.target.label || UNTITLED[favorite.favoriteType] || 'Untitled';
  return (
    <>
      <span className={s.rowIcon}>
        {favorite.favoriteType === 'record' ? (
          <RecordIcon entityDefinitionId={favorite.entityDefinitionId} />
        ) : (
          <Icon icon={TYPE_ICON[favorite.favoriteType] ?? 'favorite'} size={16} />
        )}
      </span>
      <span className={s.label}>{label}</span>
      {favorite.target.secondaryLabel && <span className={s.secondary}>{favorite.target.secondaryLabel}</span>}
    </>
  );
}

export function useOpenFavorite() {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const objects = useObjects(workspace).data;
  return (favorite: Favorite) => {
    const object = objects?.find((o) => o.id === favorite.entityDefinitionId);
    switch (favorite.favoriteType) {
      case 'record': {
        const path = recordPath(workspace.slug, object as Parameters<typeof recordPath>[1], favorite.targetId);
        if (path) void navigate({ href: path });
        return;
      }
      case 'entity-view':
        if (object) void navigate({ href: href(`${objectPath(object)}/view/${favorite.targetId}`) });
        return;
      case 'note':
        openNote(favorite.targetId);
        return;
      case 'note-template':
        // B sidebar §6: a favourite template creates a new note from it.
        openNewNote({ templateId: favorite.targetId });
        return;
      case 'call-recording':
        // The call page needs the meeting id too: read it from the call, then open the transcript.
        void api.calls.get
          .query({ recordingId: favorite.targetId }, inWorkspace({ id: workspace.id, slug: workspace.slug }))
          .then((call) =>
            navigate({ href: `/${workspace.slug}/calls/${call.meetingId}/${favorite.targetId}/transcript` }),
          )
          .catch((e) => toast.error({ title: 'Failed to open the call', description: errorEnvelopeOf(e).message }));
        return;
      case 'reporting-dashboard':
        void navigate({ href: href(`reports/dashboard/${favorite.targetId}`) });
        return;
      default:
        toast({ title: 'This item arrives in a later slice' });
    }
  };
}

function DragHandle({ row, children }: { row: FlatRow; children: (bind: Record<string, unknown>) => ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: row.id, data: row });
  if (isDragging)
    return <div ref={setNodeRef} className={s.placeholder} data-fav-row={row.id} data-drag-placeholder="" />;
  return <>{children({ ref: setNodeRef, ...attributes, ...listeners, tabIndex: 0 })}</>;
}

function FavoriteRow({
  favorite,
  row,
  current,
  dropFolder,
}: {
  favorite: Favorite;
  row: FlatRow;
  current: boolean;
  dropFolder?: boolean;
}) {
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const open = useOpenFavorite();
  if (favorite.target.state === 'missing') return null;
  const ws = { id: workspace.id, slug: workspace.slug };
  return (
    <DragHandle row={row}>
      {(bind) => (
        <div
          {...bind}
          role="link"
          className={`${s.row} ${row.parentId ? s.indented : ''}`}
          data-fav-row={row.id}
          data-current={current || undefined}
          data-drop-folder={dropFolder || undefined}
          data-testid="favorite-row"
          data-favorite-type={favorite.favoriteType}
          title={
            favorite.target.secondaryLabel
              ? `${favorite.target.label} (${favorite.target.secondaryLabel})`
              : (favorite.target.label ?? undefined)
          }
          onClick={() => open(favorite)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open(favorite);
          }}
        >
          <FavoriteContent favorite={favorite} />
          <span className={s.rowSpacer} />
          <span className={s.action}>
            <IconButton
              icon="favoriteRemove"
              aria-label="Remove favorite"
              tooltip="Remove favorite"
              size={20}
              onPress={() => void removeFavorite(client, ws, favorite.id)}
            />
          </span>
        </div>
      )}
    </DragHandle>
  );
}

function FolderRow({
  directory,
  row,
  open,
  onToggle,
  isDropTarget,
  isEmpty,
}: {
  directory: FavoriteDirectory;
  row: FlatRow;
  open: boolean;
  onToggle: () => void;
  isDropTarget: boolean;
  isEmpty: boolean;
}) {
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const ws = { id: workspace.id, slug: workspace.slug };
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(directory.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const sidebar = useSidebar();
  const commit = () => {
    setRenaming(false);
    const title = name.trim();
    if (!title) {
      setConfirm(true);
      return;
    }
    if (title !== directory.title) void updateDirectory(client, ws, directory.id, { title });
  };
  return (
    <>
      <DragHandle row={row}>
        {(bind) => (
          <div
            {...(renaming ? {} : bind)}
            role="button"
            className={s.row}
            data-fav-row={row.id}
            data-folder={directory.id}
            data-drop-folder={isDropTarget || undefined}
            aria-expanded={open}
            data-testid="favorite-folder"
            onClick={() => !renaming && onToggle()}
            onKeyDown={(e) => {
              if (renaming) return;
              if (e.key === 'Enter' || e.key === ' ') onToggle();
              if (e.key === 'r') {
                e.preventDefault();
                setName(directory.title);
                setRenaming(true);
              }
            }}
          >
            <span className={s.rowIcon}>
              <Icon icon={open ? 'folderOpen' : 'folder'} size={16} className={s.folderGlyph} />
            </span>
            {renaming ? (
              <input
                className={s.folderInput}
                value={name}
                aria-label="Folder name"
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') {
                    setName(directory.title);
                    setRenaming(false);
                  }
                }}
                onBlur={commit}
              />
            ) : (
              <span className={s.label}>{directory.title}</span>
            )}
            <span className={s.rowSpacer} />
            {!renaming && (
              <span className={s.action} data-open={menuOpen || undefined}>
                <MenuTrigger
                  onOpenChange={(o) => {
                    setMenuOpen(o);
                    sidebar.holdOpen(o);
                  }}
                >
                  <IconButton icon="moreVertical" aria-label="Folder options" tooltip="Folder options" size={20} />
                  <Menu
                    aria-label="Folder options"
                    placement="bottom start"
                    width={180}
                    onAction={(key) => {
                      if (key === 'rename') {
                        setName(directory.title);
                        setRenaming(true);
                      }
                      if (key === 'delete') setConfirm(true);
                    }}
                  >
                    <MenuItem id="rename" icon="edit">
                      Rename
                    </MenuItem>
                    <MenuItem id="delete" icon="delete" variant="danger">
                      Delete folder
                    </MenuItem>
                  </Menu>
                </MenuTrigger>
              </span>
            )}
          </div>
        )}
      </DragHandle>
      {open && isEmpty && <div className={s.noItems}>No items</div>}
      <AlertDialog
        isOpen={confirm}
        onOpenChange={(o) => {
          setConfirm(o);
          if (!o) setName(directory.title);
        }}
        title="Delete folder"
        description="Are you sure you want to delete this folder?"
        confirmLabel="Confirm"
        onConfirm={() => void deleteDirectory(client, ws, directory.id)}
      />
    </>
  );
}

function NewFolderRow({ onDone }: { onDone: () => void }) {
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const commit = () => {
    const title = name.trim();
    if (title) void createDirectory(client, { id: workspace.id, slug: workspace.slug }, title);
    onDone();
  };
  return (
    <div className={s.row} data-testid="favorite-new-folder">
      <span className={s.rowIcon}>
        <Icon icon="folder" size={16} />
      </span>
      <input
        className={s.folderInput}
        placeholder="Folder name..."
        aria-label="Folder name"
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        onBlur={commit}
      />
    </div>
  );
}

// ---- section -------------------------------------------------------------------------------------------------------------

export function FavoritesSection() {
  const { workspace } = useWorkspace();
  const client = useQueryClient();
  const sidebar = useSidebar();
  const favorites = useFavorites();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [creating, setCreating] = useState(false);
  const [isOpen, setOpen] = useFolderOpen();
  const tree = useMemo(() => favoriteTree(favorites.data), [favorites.data]);
  const rows = useMemo(() => flatten(tree, isOpen), [tree, isOpen]);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<FlatRow | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const [lineTop, setLineTop] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const hoverTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(
    () => () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current.timer);
    },
    [],
  );

  const byId = useMemo(() => new Map((favorites.data?.favorites ?? []).map((f) => [f.id, f])), [favorites.data]);
  const directoryById = useMemo(
    () => new Map((favorites.data?.directories ?? []).map((d) => [d.id, d])),
    [favorites.data],
  );

  const onDragStart = (e: DragStartEvent) => {
    const ev = e.activatorEvent as PointerEvent;
    start.current = { x: ev.clientX, y: ev.clientY };
    setDragging(e.active.data.current as FlatRow);
    sidebar.holdOpen(true);
  };

  const onDragMove = (e: DragMoveEvent) => {
    const list = listRef.current;
    if (!list || !start.current || !dragging) return;
    const y = start.current.y + e.delta.y;
    const els = [...list.querySelectorAll<HTMLElement>('[data-fav-row]')];
    const listRect = list.getBoundingClientRect();
    let next: DropTarget = { kind: 'line', index: rows.length };
    let top = (els[els.length - 1]?.getBoundingClientRect().bottom ?? listRect.top) - listRect.top;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const id = el.dataset.favRow as string;
      const folder = el.dataset.folder;
      if (folder && dragging.kind === 'favorite' && y >= r.top + r.height * 0.25 && y <= r.bottom - r.height * 0.25) {
        next = { kind: 'folder', directoryId: folder };
        top = -1;
        break;
      }
      if (y < r.top + r.height / 2) {
        next = { kind: 'line', index: rows.findIndex((row) => row.id === id) };
        top = r.top - listRect.top;
        break;
      }
    }
    setTarget(next);
    setLineTop(next.kind === 'line' && resolveDrop(tree, rows, dragging, next) ? top : null);
    // Hovering a closed folder for 1.5 s opens it.
    if (next.kind === 'folder' && !isOpen(next.directoryId)) {
      if (hoverTimer.current?.id !== next.directoryId) {
        if (hoverTimer.current) clearTimeout(hoverTimer.current.timer);
        const id = next.directoryId;
        hoverTimer.current = { id, timer: setTimeout(() => setOpen(id, true), 1500) };
      }
    } else if (hoverTimer.current) {
      clearTimeout(hoverTimer.current.timer);
      hoverTimer.current = null;
    }
  };

  const onDragEnd = (_e: DragEndEvent) => {
    const row = dragging;
    const drop = target;
    setDragging(null);
    setTarget(null);
    setLineTop(null);
    sidebar.holdOpen(false);
    if (!row || !drop) return;
    const result = resolveDrop(tree, rows, row, drop);
    if (!result) return;
    const ws = { id: workspace.id, slug: workspace.slug };
    if (row.kind === 'directory') void updateDirectory(client, ws, row.id, { sortOrder: result.sortOrder });
    else void moveFavorite(client, ws, row.id, result.parentId, result.sortOrder);
  };

  const hasAny = (favorites.data?.favorites.length ?? 0) + (favorites.data?.directories.length ?? 0) > 0;
  if (!hasAny && !creating && !favorites.isPending) return null;
  if (favorites.isPending) return null;

  const isCurrent = (f: Favorite) => {
    if (f.favoriteType === 'record') return pathname.endsWith(`/${f.targetId}`);
    if (f.favoriteType === 'entity-view') return pathname.endsWith(`/view/${f.targetId}`);
    return false;
  };

  const actions = (
    <IconButton
      icon="folderAdd"
      aria-label="New favorites folder"
      tooltip="Create new favorites folder"
      size={20}
      className={shell.sectionAction}
      onPress={() => setCreating(true)}
    />
  );

  const draggedFavorite = dragging?.kind === 'favorite' ? byId.get(dragging.id) : undefined;
  const draggedFolder = dragging?.kind === 'directory' ? directoryById.get(dragging.id) : undefined;

  return (
    <SidebarSection id="favorites" title="Favorites" actions={actions}>
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={() => onDragEnd({} as DragEndEvent)}
      >
        <div ref={listRef} className={s.list} data-testid="favorites-section">
          {creating && <NewFolderRow onDone={() => setCreating(false)} />}
          {favorites.isPending &&
            [96, 120].map((w) => (
              <div key={w} className={s.skeleton}>
                <Skeleton shape="circle" width={16} />
                <Skeleton width={w} height={10} />
              </div>
            ))}
          {tree.top.map((item) => {
            if (item.kind === 'favorite') {
              const row = rows.find((r) => r.id === item.favorite.id) as FlatRow;
              return (
                <FavoriteRow
                  key={item.favorite.id}
                  favorite={item.favorite}
                  row={row}
                  current={isCurrent(item.favorite)}
                />
              );
            }
            const d = item.directory;
            const row = rows.find((r) => r.id === d.id) as FlatRow;
            const open = isOpen(d.id);
            const children = tree.children.get(d.id) ?? [];
            return (
              <div key={d.id} style={{ display: 'contents' }}>
                <FolderRow
                  directory={d}
                  row={row}
                  open={open}
                  onToggle={() => setOpen(d.id, !open)}
                  isDropTarget={target?.kind === 'folder' && target.directoryId === d.id}
                  isEmpty={children.length === 0}
                />
                {open &&
                  children.map((f) => {
                    const childRow = rows.find((r) => r.id === f.id) as FlatRow;
                    return <FavoriteRow key={f.id} favorite={f} row={childRow} current={isCurrent(f)} />;
                  })}
              </div>
            );
          })}
          {lineTop !== null && <div className={s.dropLine} style={{ top: lineTop }} data-testid="favorite-drop-line" />}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging ? (
            <div
              className={`${s.overlay} ${draggedFolder ? s.overlayFolder : ''}`}
              style={{ transform: 'translateY(20px)' }}
            >
              {draggedFavorite ? (
                <FavoriteContent favorite={draggedFavorite} />
              ) : draggedFolder ? (
                <>
                  <Icon icon="folder" size={16} />
                  <span className={s.label}>{draggedFolder.title}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </SidebarSection>
  );
}
