// The pages of the palette: Quick actions (root), Search records, and the pages pushed from them — Note templates,
// Choose record (for a new note), Choose list, Upcoming meetings, Choose object. Each maps its data to shell rows.

import { addDays, localDateOf } from '@agentic-crm/contracts';
import { Button, Icon, type IconName, IconTile, useTheme, useThemeSettings } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { type ObjectSummary, objectPath, useObjects } from '../../data/objects';
import { queryClient } from '../../data/queryClient';
import { RecordAvatar, recordKind } from '../attributes/ui/primitives';
import { useOpenFavorite } from '../favorites';
import { useFavorites } from '../favorites/data';
import { fireConfetti } from '../kanban/confetti';
import { ListIcon } from '../lists';
import { type List, useLists } from '../lists/data';
import { useMeetingsList } from '../meetings/data';
import { calendarTile, dayBounds, dayLabel, rowTimeLabel, startDateOf } from '../meetings/model';
import { createTemplate, useNoteTemplates } from '../notes/data';
import { openNewNote } from '../notes/NewNote';
import { openNoteTemplate, openWindow } from '../overlays/store';
import { recordUrl } from '../record/paths';
import { useRecordSearch } from '../search/useRecordSearch';
import { EmptyArt } from '../shell/EmptyArt';
import { objectAppearance } from '../shell/objectAppearance';
import { useWorkspace } from '../shell/workspaceContext';
import { openHelpDrawer } from '../shortcuts/helpStore';
import { useCalendar } from '../tasks/calendar';
import { openCreateTask } from '../tasks/TaskDialog';
import { usePaletteContexts } from './contexts';
import { openPaletteFlow } from './flows';
import { buildRootRows, type PaletteRow, type RowPayload, recordRows, searchTermOf } from './model';
import { ListPreview, ObjectPreview, PlaceholderPreview, RecordHitAvatar, RecordHitPreview } from './Preview';
import * as s from './palette.css';
import { buildQuickActions, type ThemeChoice } from './quickActions';
import { useRecordMenu } from './recordActions';
import { type MenuItem, PaletteShell, type ShellRow } from './Shell';
import { closePalette, type PalettePage, pushPage } from './store';

const QUICK_ACTIONS_CRUMB = { label: 'Quick actions', icon: <Icon icon="command" size={12} /> };

type ChipHue = keyof typeof s.chipVariant;

function chipHueOf(object: ObjectSummary | undefined): ChipHue {
  const color = object ? objectAppearance(object).color : 'grey';
  return (color in s.chipVariant ? color : 'grey') as ChipHue;
}

function ObjectChip({ object }: { object: ObjectSummary | undefined }) {
  if (!object) return null;
  const look = objectAppearance(object);
  return (
    <span className={`${s.chip} ${s.chipVariant[chipHueOf(object)]}`}>
      <Icon icon={look.icon} size={12} />
      {object.singularNoun}
    </span>
  );
}

function FavoriteChip() {
  return (
    <span className={`${s.chip} ${s.chipVariant.yellow}`}>
      <Icon icon="favorite" size={12} />
      Favorite
    </span>
  );
}

const useGo = () => {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return useCallback((path: string) => void navigate({ href: href(path) }), [href, navigate]);
};

// ---- shared row builders ----------------------------------------------------------------------------------------------

/** Record hit rows (Search section, Search page, Choose record). */
function useRecordRowBuilder(
  onRun: (hit: RecordHitData, mode: 'primary' | 'new-tab', object: ObjectSummary | undefined) => void,
  gesture: string,
) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  return useCallback(
    (row: PaletteRow): ShellRow | null => {
      if (row.payload.type !== 'record') return null;
      const hit = row.payload.hit;
      const object = objects.find((o) => o.id === hit.entityDefinitionId);
      return {
        key: row.key,
        section: row.section,
        icon: <RecordHitAvatar hit={hit} object={object} />,
        plainIcon: true,
        title: hit.title ?? 'Untitled record',
        titleText: hit.title ?? '',
        secondary: hit.subtitle,
        trailing: <ObjectChip object={object} />,
        gesture,
        data: row.payload,
        run: (mode) => onRun(hit, mode, object),
      };
    },
    [objects, onRun, gesture],
  );
}

type RecordHitData = Extract<RowPayload, { type: 'record' }>['hit'];

function useRecordPreview() {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const go = useGo();
  return useCallback(
    (hit: RecordHitData) => (
      <RecordHitPreview
        hit={hit}
        object={objects.find((o) => o.id === hit.entityDefinitionId)}
        onOpenList={(listId) => {
          closePalette();
          go(`collection/${listId}`);
        }}
      />
    ),
    [objects, go],
  );
}

function useRecordMenuFor() {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const buildMenu = useRecordMenu();
  return useCallback(
    (row: ShellRow): MenuItem[] | null => {
      const payload = row.data as RowPayload | undefined;
      if (payload?.type !== 'record') return null;
      const hit = payload.hit;
      return buildMenu(
        {
          entityDefinitionId: hit.entityDefinitionId,
          entityInstanceId: hit.entityInstanceId,
          title: hit.title ?? '',
          domains: hit.domains,
          emailAddresses: hit.emailAddresses,
        },
        objects.find((o) => o.id === hit.entityDefinitionId),
        closePalette,
      );
    },
    [buildMenu, objects],
  );
}

/** Opens a record from a search hit (↩ / ⌘↩). */
function useOpenHit() {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  return useCallback(
    (hit: RecordHitData, mode: 'primary' | 'new-tab', object: ObjectSummary | undefined) => {
      closePalette();
      if (!object) return;
      const to = recordUrl(href, object, hit.entityInstanceId);
      if (mode === 'new-tab') window.open(to, '_blank', 'noopener');
      else void navigate({ href: to });
    },
    [href, navigate],
  );
}

// ---- root: Quick actions -------------------------------------------------------------------------------------------

export function RootPage({ page }: { page: PalettePage }) {
  const { workspace, isAdmin } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const go = useGo();
  const objects = useObjects(workspace).data ?? [];
  const lists = useLists(ws).data ?? [];
  const favorites = useFavorites().data?.favorites ?? [];
  const contexts = usePaletteContexts();
  const themeSettings = useThemeSettings();
  const theme = useTheme();
  const openFavorite = useOpenFavorite();
  const openHit = useOpenHit();
  const q = page.query.trim();
  const search = useRecordSearch(searchTermOf(page.query), { enabled: q !== '', limit: 10 });
  const [busy, setBusy] = useState<string | null>(null);

  const { quick, help } = useMemo(
    () =>
      buildQuickActions({
        isAdmin,
        objects,
        theme: {
          setting: (themeSettings?.theme ?? 'system') as ThemeChoice,
          resolved: theme.identity === 'light' ? 'light' : 'dark',
          set: (t) => themeSettings?.setTheme(t),
        },
        navigate: go,
        openCreateTask: () => openCreateTask(),
        openHelpDrawer: () => openHelpDrawer(),
        openNewRecord: (object) => openPaletteFlow({ kind: 'new-record', objectId: object.id }),
        fireConfetti,
      }),
    [isAdmin, objects, themeSettings, theme.identity, go],
  );

  const rows = useMemo(
    () =>
      buildRootRows({
        query: page.query,
        favorites,
        objects,
        lists,
        contexts,
        quick,
        help,
        hits: q ? search.hits : null,
      }),
    [page.query, favorites, objects, lists, contexts, quick, help, search.hits, q],
  );

  const recordRow = useRecordRowBuilder(openHit, 'Open record');
  const menuFor = useRecordMenuFor();
  const recordPreview = useRecordPreview();

  const shellRows = useMemo<ShellRow[]>(() => {
    const out: ShellRow[] = [];
    for (const row of rows) {
      const p = row.payload;
      switch (p.type) {
        case 'action': {
          const a = p.action;
          out.push({
            key: row.key,
            section: row.section,
            icon: <Icon icon={a.icon} size={16} />,
            title: a.title,
            titleText: a.title,
            secondary: a.description ?? null,
            hint: a.hint,
            external: a.external,
            gesture: a.gesture,
            busy: busy === row.key,
            data: p,
            run: () => {
              const result = a.run({ close: closePalette, push: (view, query) => pushPage(view, query) });
              if (result instanceof Promise) {
                setBusy(row.key);
                void result.finally(() => {
                  setBusy(null);
                  if (!a.keepOpen) closePalette();
                });
              } else if (!a.keepOpen) closePalette();
            },
          });
          break;
        }
        case 'jump-object': {
          const look = objectAppearance(p.object);
          out.push({
            key: row.key,
            section: row.section,
            icon: <IconTile icon={look.icon} color={look.color} size={20} />,
            plainIcon: true,
            title: p.object.pluralNoun,
            titleText: p.object.pluralNoun,
            gesture: 'Open',
            data: p,
            run: () => {
              closePalette();
              go(objectPath(p.object));
            },
          });
          break;
        }
        case 'jump-list':
          out.push({
            key: row.key,
            section: row.section,
            icon: <ListIcon icon={p.list.icon} size={16} />,
            title: p.list.name,
            titleText: p.list.name,
            gesture: 'Open',
            data: p,
            run: () => {
              closePalette();
              go(`collection/${p.list.id}`);
            },
          });
          break;
        case 'jump-favorite': {
          const fav = p.favorite;
          const object = objects.find((o) => o.id === fav.entityDefinitionId);
          out.push({
            key: row.key,
            section: row.section,
            icon:
              fav.favoriteType === 'record' ? (
                <RecordAvatar kind={recordKind(object)} size={20} />
              ) : (
                <Icon icon={favoriteIcon(fav.favoriteType)} size={16} />
              ),
            plainIcon: fav.favoriteType === 'record',
            title: fav.target.label ?? '',
            titleText: fav.target.label ?? '',
            secondary: fav.target.secondaryLabel,
            trailing: <FavoriteChip />,
            gesture: 'Open',
            data: p,
            run: () => {
              closePalette();
              openFavorite(fav);
            },
          });
          break;
        }
        case 'record': {
          const built = recordRow(row);
          if (built) out.push(built);
          break;
        }
        case 'more':
          out.push({
            key: row.key,
            section: row.section,
            icon: <Icon icon="search" size={16} />,
            title: `See more results for "${p.query}"`,
            titleText: p.query,
            gesture: 'Search',
            data: p,
            run: () => pushPage({ id: 'search' }, p.query),
          });
          break;
        case 'search-in':
          out.push({
            key: row.key,
            section: row.section,
            icon: <Icon icon="search" size={16} />,
            title: `Search for "${p.query}" in records`,
            titleText: p.query,
            gesture: 'Search',
            data: p,
            run: () => pushPage({ id: 'search' }, p.query),
          });
          break;
        case 'create-record':
          out.push({
            key: row.key,
            section: row.section,
            icon: <Icon icon="compose" size={16} />,
            title: `Create "${p.query}" as record`,
            titleText: p.query,
            gesture: 'Create new record',
            data: p,
            run: () => createRecordFlow(p.query, objects),
          });
          break;
      }
    }
    return out;
  }, [rows, busy, go, objects, openFavorite, recordRow]);

  const preview = useCallback(
    (row: ShellRow | null): ReactNode => {
      const p = row?.data as RowPayload | undefined;
      if (!p) return null;
      switch (p.type) {
        case 'jump-object':
          return <ObjectPreview object={p.object} />;
        case 'jump-list':
          return <ListPreview list={p.list} />;
        case 'record':
          return recordPreview(p.hit);
        case 'jump-favorite':
          return (
            <PlaceholderPreview
              icon={favoriteIcon(p.favorite.favoriteType)}
              title={p.favorite.target.label ?? 'Favorite'}
              body={p.favorite.target.secondaryLabel ?? undefined}
            />
          );
        case 'action':
          return <PlaceholderPreview icon={p.action.icon} title={p.action.title} />;
        case 'more':
        case 'search-in':
          return <PlaceholderPreview icon="search" title={`Search records for "${p.query}"`} />;
        case 'create-record':
          return <PlaceholderPreview icon="compose" title={`Create "${p.query}" as a new record`} />;
      }
    },
    [recordPreview],
  );

  return (
    <PaletteShell
      placeholder="Search quick actions and records..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={shellRows}
      preview={preview}
      menu={menuFor}
      loading={search.isFetching && q !== ''}
    />
  );
}

function favoriteIcon(type: string): IconName {
  switch (type) {
    case 'note':
      return 'notes';
    case 'note-template':
      return 'noteTemplate';
    case 'entity-view':
      return 'table';
    case 'collection-view':
      return 'list';
    case 'email-template':
      return 'emails';
    case 'workflow':
      return 'workflows';
    case 'sequence':
      return 'sequences';
    case 'call-recording':
      return 'meeting';
    case 'merlin-thread':
      return 'chat';
    default:
      return 'favorite';
  }
}

/** 'Create "q" as record': the only record object is created at once, else the object is chosen first. */
function createRecordFlow(query: string, objects: readonly ObjectSummary[]): void {
  const candidates = objects.filter((o) => !o.isArchived);
  if (candidates.length === 1) {
    closePalette();
    openPaletteFlow({ kind: 'new-record', objectId: (candidates[0] as ObjectSummary).id, title: query });
    return;
  }
  pushPage({ id: 'choose-object', title: query });
}

// ---- Search records ---------------------------------------------------------------------------------------------

export function SearchPage({ page, nested }: { page: PalettePage; nested: boolean }) {
  const q = page.query.trim();
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const search = useRecordSearch(searchTermOf(page.query), { limit: 20 });
  const openHit = useOpenHit();
  const recordRow = useRecordRowBuilder(openHit, 'Open record');
  const menuFor = useRecordMenuFor();
  const recordPreview = useRecordPreview();
  const noHits = search.answeredQuery !== null && search.hits.length === 0;

  const rows = useMemo<ShellRow[]>(() => {
    const out: ShellRow[] = [];
    for (const row of recordRows(search.hits, q ? 'Results' : 'Records')) {
      const built = recordRow(row);
      if (built) out.push(built);
    }
    if (q && search.hits.length > 0) {
      out.push({
        key: 'create-record',
        section: q ? 'Results' : 'Records',
        icon: <Icon icon="compose" size={16} />,
        title: `Create "${q}" as record`,
        titleText: q,
        gesture: 'Create new record',
        data: { type: 'create-record', query: q } satisfies RowPayload,
        run: () => createRecordFlow(q, objects),
      });
    }
    return out;
  }, [search.hits, q, recordRow, objects]);

  const empty =
    noHits && search.answeredQuery === page.query ? (
      <div className={s.emptyList} data-testid="search-empty">
        <EmptyArt icon="search" />
        <div className={s.emptyTitle}>We couldn't find anything matching your search</div>
        <div className={s.emptyBody}>Try again or</div>
        <Button variant="secondary" size={28} onPress={() => createRecordFlow(q, objects)}>
          {q ? `Create "${q}" as a new record` : 'Create a new record'}
        </Button>
      </div>
    ) : undefined;

  const preview = useCallback(
    (row: ShellRow | null): ReactNode => {
      const p = row?.data as RowPayload | undefined;
      if (p?.type === 'record') return recordPreview(p.hit);
      if (p?.type === 'create-record')
        return <PlaceholderPreview icon="compose" title={`Create "${p.query}" as a new record`} />;
      return null;
    },
    [recordPreview],
  );

  return (
    <PaletteShell
      crumbs={nested ? [QUICK_ACTIONS_CRUMB, { label: 'Search', icon: <Icon icon="search" size={12} /> }] : undefined}
      title={nested ? undefined : { label: 'Search', icon: <Icon icon="search" size={12} /> }}
      placeholder="Search records..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
      empty={empty}
      preview={preview}
      menu={menuFor}
      loading={search.isFetching}
    />
  );
}

// ---- Note templates ---------------------------------------------------------------------------------------------

export function NoteTemplatesPage({ page }: { page: PalettePage }) {
  const q = page.query.trim();
  const templates = useNoteTemplates({ search: q || undefined });
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const list = templates.data?.templates ?? [];

  const rows = useMemo<ShellRow[]>(() => {
    const out: ShellRow[] = list.map((t) => ({
      key: `template:${t.id}`,
      section: q ? 'Results' : 'Templates',
      icon: <Icon icon="noteTemplate" size={16} />,
      title: t.title || 'Untitled Template',
      titleText: t.title,
      gesture: 'Edit template',
      run: () => {
        closePalette();
        openNoteTemplate(t.id);
      },
    }));
    out.push({
      key: 'create-template',
      section: 'Actions',
      icon: <Icon icon="noteTemplate" size={16} />,
      title: 'Create new template',
      titleText: 'Create new template',
      gesture: 'Create',
      run: () => {
        closePalette();
        void createTemplate(queryClient, ws, { title: '' }).then((template) => openNoteTemplate(template.id));
      },
    });
    return out;
  }, [list, q, ws]);

  const notice =
    list.length === 0 && templates.data ? (
      <div className={s.emptyBody} style={{ padding: '12px 6px' }} data-testid="templates-empty">
        {q ? `No results found for "${q}"` : 'No note templates'}
      </div>
    ) : undefined;

  return (
    <PaletteShell
      crumbs={[QUICK_ACTIONS_CRUMB, { label: 'Note templates', icon: <Icon icon="noteTemplate" size={12} /> }]}
      placeholder="Search note templates..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
      notice={notice}
      loading={templates.isFetching}
    />
  );
}

// ---- Choose record (for a new note) -----------------------------------------------------------------------------------

export function ChooseRecordPage({ page }: { page: PalettePage }) {
  const q = page.query.trim();
  const search = useRecordSearch(searchTermOf(page.query), { limit: 20 });
  const choose = useCallback((hit: RecordHitData) => {
    closePalette();
    openNewNote({ record: { entityDefinitionId: hit.entityDefinitionId, entityInstanceId: hit.entityInstanceId } });
  }, []);
  const recordRow = useRecordRowBuilder(choose, 'Select record');
  const recordPreview = useRecordPreview();
  const rows = useMemo(
    () =>
      recordRows(search.hits, q ? 'Results' : 'Records')
        .map(recordRow)
        .filter((r): r is ShellRow => r !== null),
    [search.hits, q, recordRow],
  );
  const preview = useCallback(
    (row: ShellRow | null) => {
      const p = row?.data as RowPayload | undefined;
      return p?.type === 'record' ? recordPreview(p.hit) : null;
    },
    [recordPreview],
  );
  return (
    <PaletteShell
      crumbs={[QUICK_ACTIONS_CRUMB, { label: 'Create note', icon: <Icon icon="notes" size={12} /> }]}
      placeholder="Search records..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
      preview={preview}
      loading={search.isFetching}
      empty={
        search.answeredQuery !== null && search.hits.length === 0 ? (
          <div className={s.emptyList}>
            <div className={s.emptyTitle}>No records found</div>
            <div className={s.emptyBody}>Try a different name, email or domain</div>
          </div>
        ) : undefined
      }
    />
  );
}

// ---- Choose list -------------------------------------------------------------------------------------------------------

export function ChooseListPage({ page, nested }: { page: PalettePage; nested: boolean }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const lists = useLists(ws).data ?? [];
  const q = page.query.trim().toLowerCase();
  const shown = q ? lists.filter((l: List) => l.name.toLowerCase().includes(q)) : lists;
  const rows = useMemo<ShellRow[]>(
    () =>
      shown.map((list) => ({
        key: `list:${list.id}`,
        section: 'Lists',
        icon: <ListIcon icon={list.icon} size={16} />,
        title: list.name,
        titleText: list.name,
        gesture: 'Select list',
        data: list,
        run: () => {
          closePalette();
          openPaletteFlow({ kind: 'add-to-list', list });
        },
      })),
    [shown],
  );
  const crumb = { label: 'Choose list', icon: <Icon icon="list" size={12} /> };
  return (
    <PaletteShell
      crumbs={nested ? [QUICK_ACTIONS_CRUMB, crumb] : undefined}
      title={nested ? undefined : crumb}
      placeholder="Search lists..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
      empty={
        <div className={s.emptyList}>
          <div className={s.emptyTitle}>{q ? 'No lists found' : 'No lists yet'}</div>
          <div className={s.emptyBody}>
            {q ? 'Try a different name' : 'Create a list from the sidebar to add records to it'}
          </div>
        </div>
      }
    />
  );
}

// ---- Upcoming meetings (today and tomorrow, the viewer's own; F README §2.4) -------------------------------------------

export function UpcomingMeetingsPage({ page }: { page: PalettePage }) {
  const { timeZone } = useCalendar();
  const today = localDateOf(Date.now(), timeZone);
  const range = useMemo(
    () => ({ from: dayBounds(today, timeZone).from, to: dayBounds(addDays(today, 1), timeZone).to }),
    [today, timeZone],
  );
  const meetings = useMeetingsList({ mine: true, from: range.from, to: range.to, sort: 'start_asc' });
  const q = page.query.trim().toLowerCase();
  const rows = useMemo<ShellRow[]>(
    () =>
      (meetings.data?.meetings ?? [])
        .filter((m) => Date.parse(m.end.at) > Date.now() && (!q || (m.title ?? '').toLowerCase().includes(q)))
        .map((m) => {
          const tile = calendarTile(m, timeZone);
          const title = m.title ?? 'Private meeting';
          return {
            key: `meeting:${m.id}`,
            section: dayLabel(startDateOf(m, timeZone), today),
            icon: <Icon icon="calendar" size={16} />,
            title,
            titleText: title,
            gesture: 'Open meeting',
            data: { tile, time: rowTimeLabel(m, timeZone) },
            run: () => {
              closePalette();
              openWindow('meeting', m.id, {});
            },
          };
        }),
    [meetings.data, q, timeZone, today],
  );
  return (
    <PaletteShell
      crumbs={[QUICK_ACTIONS_CRUMB, { label: 'Upcoming meetings', icon: <Icon icon="calendar" size={12} /> }]}
      placeholder="Search meetings..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
      loading={meetings.isFetching}
      empty={
        <div className={s.emptyList} data-testid="meetings-empty">
          <div className={s.emptyTitle}>No upcoming meetings</div>
          <div className={s.emptyBody}>It looks like you don't have any meetings planned for today and tomorrow</div>
        </div>
      }
    />
  );
}

// ---- Choose object (for 'Create "x" as record') ----------------------------------------------------------------------

export function ChooseObjectPage({ page, title }: { page: PalettePage; title: string }) {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const q = page.query.trim().toLowerCase();
  const rows = useMemo<ShellRow[]>(
    () =>
      objects
        .filter((o) => !q || o.singularNoun.toLowerCase().includes(q) || o.pluralNoun.toLowerCase().includes(q))
        .map((object) => {
          const look = objectAppearance(object);
          return {
            key: `object:${object.id}`,
            section: 'Objects',
            icon: <IconTile icon={look.icon} color={look.color} size={20} />,
            plainIcon: true,
            title: object.singularNoun,
            titleText: object.singularNoun,
            gesture: 'Create',
            run: () => {
              closePalette();
              openPaletteFlow({ kind: 'new-record', objectId: object.id, title });
            },
          };
        }),
    [objects, q, title],
  );
  return (
    <PaletteShell
      crumbs={[QUICK_ACTIONS_CRUMB, { label: 'Choose object', icon: <Icon icon="object" size={12} /> }]}
      placeholder="Search objects..."
      query={page.query}
      highlightKey={page.highlightKey}
      rows={rows}
    />
  );
}
