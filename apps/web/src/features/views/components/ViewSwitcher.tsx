// View switcher (C1 README §3.1, evidence C1/07, 08): button with the view-type tile, title and chevron (hotkey `v`);
// popover 264 px with "Search views..." (fuzzy), the views (current in accent), a hover "⋮" with the view options
// menu (Add to favorites, Rename, Duplicate, Delete, "Created by …"), drag reorder, and "+ Create new view".
import type { View } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  IconTile,
  MenuItem,
  MenuList,
  MenuSeparator,
  MenuTrigger,
  PopoverPanel,
  toast,
} from '@agentic-crm/ui';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { Dialog } from 'react-aria-components';
import { useShortcut } from '../../../lib/shortcuts';
import { dedupeTitle, deleteView, duplicateView, updateView, useMembers, useViews, useWorkspaceRef } from '../data';
import { actorName, formatCreatedAt, fuzzyMatch } from '../format';
import { useVerticalReorder } from '../useVerticalReorder';
import { rankBetweenViews } from '../useViewDraft';
import * as s from '../views.css';
import { CreateViewDialog, TitleDialog } from './dialogs';

export function ViewTypeTile({ type }: { type: View['type'] }) {
  return (
    <IconTile icon={type === 'kanban' ? 'kanban' : 'table'} color={type === 'kanban' ? 'blue' : 'green'} size={16} />
  );
}

export interface ViewSwitcherProps {
  entityDefinitionId: string;
  currentViewId: string | null;
  /** Go to a view (null: the object has no views left → "Start with a view"). */
  onNavigate: (viewId: string | null) => void;
  /** Binds `v` (default true). */
  shortcut?: boolean;
  onCreateStatusAttribute?: () => void;
}

export function ViewSwitcher({
  entityDefinitionId,
  currentViewId,
  onNavigate,
  shortcut = true,
  onCreateStatusAttribute,
}: ViewSwitcherProps) {
  const ws = useWorkspaceRef();
  const views = useViews(entityDefinitionId).data ?? [];
  const current = views.find((v) => v.id === currentViewId);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<View | null>(null);
  const [deleting, setDeleting] = useState<View | null>(null);

  useShortcut(shortcut ? 'v' : null, () => setOpen(true));

  const visible = useMemo(() => views.filter((v) => fuzzyMatch(v.title, query)), [views, query]);
  const createIndex = visible.length; // the "Create new view" row follows the views

  const reorder = useVerticalReorder(listRef, (from, to) => {
    const moved = visible[from];
    if (!moved || query) return;
    const rest = visible.filter((v) => v.id !== moved.id);
    const sortOrder = rankBetweenViews(rest[to - 1], rest[to]);
    if (sortOrder) updateView(ws, moved, { sortOrder }).catch(() => toast.error('Failed to move view'));
  });

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      setActive(
        Math.max(
          0,
          views.findIndex((v) => v.id === currentViewId),
        ),
      );
    }
  };

  const go = (view: View) => {
    setOpen(false);
    onNavigate(view.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const count = visible.length + 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + count) % count);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active === createIndex) {
        setOpen(false);
        setCreating(true);
      } else if (visible[active]) go(visible[active] as View);
    }
  };

  const duplicate = async (view: View) => {
    setOpen(false);
    const toastId = toast.neutral({
      title: 'Duplicate view',
      description: `Duplicating ${view.title}...`,
      durationMs: Infinity,
    });
    try {
      const created = await duplicateView(ws, view, {
        title: dedupeTitle(
          view.title,
          views.map((v) => v.title),
        ),
      });
      toast.dismiss(toastId);
      toast.success({ title: 'Duplicate view', description: 'View successfully duplicated' });
      onNavigate(created.id);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error({ title: 'Failed to duplicate view', description: err instanceof Error ? err.message : undefined });
    }
  };

  const remove = async (view: View) => {
    const remaining = views.filter((v) => v.id !== view.id);
    try {
      await deleteView(ws, view);
      toast.success({ title: 'View deleted', description: `${view.title} was deleted successfully` });
      if (view.id === currentViewId) onNavigate(remaining[0]?.id ?? null);
    } catch (err) {
      toast.error({ title: 'Failed to delete view', description: err instanceof Error ? err.message : undefined });
    }
  };

  const dropTop = reorder.dropLineTop();

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size={28}
        icon={<ViewTypeTile type={current?.type ?? 'table'} />}
        chevron
        isActive={open}
        onPress={() => openChange(true)}
        aria-label={current ? `${current.title}, switch view` : 'Switch view'}
        data-testid="view-switcher"
      >
        {current?.title ?? 'Views'}
      </Button>
      <PopoverPanel triggerRef={triggerRef} isOpen={open} onOpenChange={openChange} className={s.switcherPanel}>
        <Dialog aria-label="Views" className={s.panelColumn}>
          <div className={s.searchRow}>
            <input
              className={s.searchInput}
              type="search"
              placeholder="Search views..."
              aria-label="Search views..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              autoFocus
            />
          </div>
          <div ref={listRef} className={s.list} role="listbox" aria-label="Views" style={{ position: 'relative' }}>
            {visible.length === 0 && <div className={s.empty}>No views found</div>}
            {visible.map((view, i) => (
              <div
                key={view.id}
                role="option"
                aria-selected={view.id === currentViewId}
                tabIndex={-1}
                data-reorder-index={i}
                data-active={i === active || undefined}
                className={`${s.row} ${view.id === currentViewId ? s.rowSelected : ''} ${reorder.dragging === i ? s.sortRowDragging : ''}`}
                onMouseMove={() => setActive(i)}
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest('button')) return;
                  if (!query) reorder.onPointerDown(i, e);
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button') || reorder.didDragRecently()) return;
                  go(view);
                }}
                onKeyDown={() => {}}
              >
                <ViewTypeTile type={view.type} />
                <span className={s.rowLabel}>{view.title}</span>
                <ViewOptionsMenu
                  view={view}
                  onRename={() => {
                    setOpen(false);
                    setRenaming(view);
                  }}
                  onDuplicate={() => void duplicate(view)}
                  onDelete={() => {
                    setOpen(false);
                    setDeleting(view);
                  }}
                />
              </div>
            ))}
            {dropTop !== null && <div className={s.dropLine} style={{ top: dropTop }} />}
          </div>
          <hr className={s.separator} />
          <div
            role="button"
            tabIndex={-1}
            className={s.row}
            data-active={active === createIndex || undefined}
            onMouseMove={() => setActive(createIndex)}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
            onKeyDown={() => {}}
          >
            <Icon icon="add" size={16} className={s.rowIcon} />
            <span className={s.rowLabel}>Create new view</span>
          </div>
        </Dialog>
      </PopoverPanel>

      <CreateViewDialog
        entityDefinitionId={entityDefinitionId}
        isOpen={creating}
        onOpenChange={setCreating}
        onCreated={(view) => onNavigate(view.id)}
        onCreateStatusAttribute={onCreateStatusAttribute}
      />
      <TitleDialog
        isOpen={renaming !== null}
        onOpenChange={(o) => !o && setRenaming(null)}
        heading={`Edit ${renaming?.title ?? ''}`}
        initialTitle={renaming?.title ?? ''}
        label="Title"
        required
        submitLabel="Save"
        onSubmit={async (title) => {
          if (!renaming) return;
          try {
            await updateView(ws, renaming, { title });
          } catch (err) {
            toast.error({
              title: 'Failed to rename view',
              description: err instanceof Error ? err.message : undefined,
            });
            throw err;
          }
        }}
      />
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Are you sure?"
        description="Are you sure you want to delete this view?"
        confirmLabel="Delete view"
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
    </>
  );
}

/** The row "⋮" menu (evidence C1/08). */
function ViewOptionsMenu({
  view,
  onRename,
  onDuplicate,
  onDelete,
}: {
  view: View;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const members = useMembers();
  return (
    <MenuTrigger>
      <IconButton icon="moreVertical" size={20} aria-label="View options" className={s.viewRowMenu} />
      <PopoverPanel placement="end top" offset={8} crossOffset={-4} width={160}>
        <MenuList
          aria-label="View options"
          onAction={(key) => {
            if (key === 'favorite') toast.neutral({ title: 'Favorites are not available yet' });
            if (key === 'rename') onRename();
            if (key === 'duplicate') onDuplicate();
            if (key === 'delete') onDelete();
          }}
        >
          <MenuItem id="favorite" icon="favorite">
            Add to favorites
          </MenuItem>
          <MenuItem id="rename" icon="edit">
            Rename
          </MenuItem>
          <MenuItem id="duplicate" icon="copy">
            Duplicate
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="delete" icon="delete" variant="danger">
            Delete
          </MenuItem>
        </MenuList>
        <hr className={s.separator} />
        <div className={s.menuFooterNote}>
          {`Created by ${actorName(view.createdBy, members)}\n${formatCreatedAt(view.createdAt)}`}
        </div>
      </PopoverPanel>
    </MenuTrigger>
  );
}
