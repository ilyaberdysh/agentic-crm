// Shared chrome of the notes and templates index pages (E README §2.1, §2.4; B.19): header tabs "Notes n" /
// "Templates n", "Sorted by Creation date" menu, View settings, the favourites strip and the index states.
import {
  Button,
  Icon,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Submenu,
  Switch,
} from '@agentic-crm/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { AskButton } from '../ask/AskButton';
import { HelpButton, PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { useNotesList, useNoteTemplates } from './data';
import * as s from './notesPage.css';

export function NotesHeader({ active }: { active: 'notes' | 'templates' }) {
  const { href } = useWorkspace();
  const notes = useNotesList({ limit: 1, includeContent: false });
  const templates = useNoteTemplates({ includeContent: false });
  const tab = (
    key: 'notes' | 'templates',
    label: string,
    icon: 'notes' | 'noteTemplate',
    count: number | undefined,
  ) => (
    <Link
      to={href(key === 'notes' ? 'notes' : 'notes/templates')}
      className={s.tab}
      aria-current={active === key ? 'page' : undefined}
      data-testid={`notes-tab-${key}`}
    >
      <Icon icon={icon} size={16} className={s.tabIcon} />
      {label}
      <span className={s.count}>{count ?? 0}</span>
    </Link>
  );
  return (
    <PageHeader
      start={
        <nav className={s.tabs} aria-label="Notes">
          {tab('notes', 'Notes', 'notes', notes.data?.total)}
          {tab('templates', 'Templates', 'noteTemplate', templates.data?.templates.length)}
        </nav>
      }
      actions={
        <>
          <HelpButton />
          <AskButton />
        </>
      }
    />
  );
}

export type SortDirection = 'asc' | 'desc';

/** "Sorted by Creation date": Creation date (only field) · Ascending / Descending (default descending). */
export function SortMenu({ direction, onChange }: { direction: SortDirection; onChange: (d: SortDirection) => void }) {
  return (
    <MenuTrigger>
      <AriaButton className={s.sortButton} data-testid="notes-sort">
        <Icon icon="sort" size={16} className={s.muted} />
        <span className={s.muted}>Sorted by</span>
        Creation date
      </AriaButton>
      <Menu
        aria-label="Sort"
        placement="bottom start"
        width={220}
        selectionMode="multiple"
        selectedKeys={['field', direction]}
        onSelectionChange={(keys) => {
          for (const key of keys as Set<string>)
            if ((key === 'asc' || key === 'desc') && key !== direction) onChange(key);
        }}
      >
        <MenuSection>
          <MenuItem id="field" icon="clock">
            Creation date
          </MenuItem>
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

/** View settings: "Group by ▸ Creation date | None" (notes only) and the "Show favorites" switch. */
export function ViewSettingsMenu({
  groupBy,
  onGroupBy,
  showFavorites,
  onShowFavorites,
}: {
  groupBy?: 'created' | 'none';
  onGroupBy?: (g: 'created' | 'none') => void;
  showFavorites: boolean;
  onShowFavorites: (v: boolean) => void;
}) {
  return (
    <MenuTrigger>
      <Button variant="secondary" size={28} icon="viewSettings" data-testid="notes-view-settings">
        View settings
      </Button>
      <Menu aria-label="View settings" placement="bottom end" width={240}>
        {groupBy && onGroupBy ? (
          <>
            <Submenu
              label="Group by"
              icon="rows"
              trailing={<span className={s.muted}>{groupBy === 'created' ? 'Creation date' : 'None'}</span>}
            >
              <MenuItem id="group-created" onAction={() => onGroupBy('created')}>
                Creation date
              </MenuItem>
              <MenuItem id="group-none" onAction={() => onGroupBy('none')}>
                None
              </MenuItem>
            </Submenu>
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem
          id="favorites"
          icon="favorite"
          onAction={() => onShowFavorites(!showFavorites)}
          trailing={<Switch isSelected={showFavorites} aria-label="Show favorites" onChange={onShowFavorites} />}
        >
          Show favorites
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

export function FavoritesStrip({ emptyText, children }: { emptyText: string; children?: ReactNode }) {
  return (
    <section className={s.favorites} aria-label="Favorites" data-testid="favorites-strip">
      <p className={s.favoritesLabel}>Favorites</p>
      {children ? (
        <div className={s.favoritesRow}>{children}</div>
      ) : (
        <div className={s.favoritesEmpty}>
          <span className={s.favoritesEmptyTitle}>Favorites</span>
          <span className={s.favoritesEmptyText}>{emptyText}</span>
        </div>
      )}
    </section>
  );
}

export function IndexState({ title, text, error }: { title?: string; text: string; error?: boolean }) {
  return (
    <div className={s.state} data-testid="index-state">
      {title && <span className={s.stateTitle}>{title}</span>}
      <span className={error ? s.stateError : s.stateText}>{text}</span>
    </div>
  );
}

export function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className={s.groupHeader} data-testid="notes-group">
      {label}
      <span className={s.count}>{count}</span>
    </div>
  );
}
