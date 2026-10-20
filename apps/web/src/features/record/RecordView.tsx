// An open record (BACKLOG 3.01; D README §2.1–2.4, §3.1, §3.11): top bar (breadcrumb, or — inside the record overlay
// of features/overlays — its ×, ↑ / ↓ and "1 of N in {view}" controls), the resizable details panel, the tab area and
// the comments panel. Owns the record dialogs (edit, merge, delete, choose list) and the record-page shortcuts (⌥←/→
// in the tab bar, e, c, n, t here; J / K belong to the overlay).
import type { CustomLayout, EntityDefinition } from '@agentic-crm/contracts';
import {
  AvatarGroup,
  Button,
  Icon,
  IconButton,
  IconTile,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { objectPath } from '../../data/objects';
import { usePersistentState } from '../../lib/storage';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useEntityAccess } from '../access/useEntityAccess';
import { AskButton } from '../ask/AskButton';
import { useAskContext } from '../ask/useAskContext';
import { useAttributes } from '../attributes/data/queries';
import { type PaletteAction, usePaletteContext } from '../command-palette/contexts';
import { objectAppearance } from '../shell/objectAppearance';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import { useAction } from '../shortcuts/catalog';
import { openHelpDrawer } from '../shortcuts/helpStore';
import {
  RecordCommentsPanel,
  useComposeEmail,
  useNewNote,
  useNewTask,
  useRecordCommentCount,
  useRecordCommentLink,
  useRecordFavorite,
} from './adapters';
import type { RecordAgentTabProps } from './agent/agentState';
import {
  type RecordDialog,
  RecordPageContext,
  type RecordPageContextValue,
  type RecordRef,
  useRecordPage,
} from './context';
import { titleAttributeOf } from './details/attributes';
import { DetailsPanel } from './details/DetailsPanel';
import { ChooseListDialog, DeleteRecordDialog, EditRecordModal } from './dialogs';
import { findTab, resolveLayout } from './layout/model';
import { MergeModal } from './merge/MergeModal';
import { DEFAULT_PANEL_PERCENT, panelWidthKey, panelWidthPx, percentFromPx, readPercent } from './panel/width';
import { takeRecordDialog } from './pendingDialog';
import { useRecordPresence } from './presence';
import * as s from './record.css';
import { TabBar } from './tabs/TabBar';
import { TabContent } from './tabs/TabContent';
import { TabAreaContext } from './tabs/tabArea';
import { useRecordTitleText } from './title';

export interface RecordViewProps {
  object: EntityDefinition;
  recordRef: RecordRef;
  layout: CustomLayout;
  activeTab: string | undefined;
  basePath: string;
  /** Rendered inside the record overlay (E4): its controls replace the breadcrumb. */
  overlay?: RecordOverlayChrome;
  /** Comments panel open on load (`?show-comments=true`, `?side-panel-tab=comments`). */
  initialComments?: boolean;
  /** Tab navigation (the URL's `$activeTab` on the page, component state in the overlay). */
  onTab: (slug: string) => void;
  /** Narrow adapter seam for the record Agent tab; backed by the agent capability when it lands. */
  agentTab?: RecordAgentTabProps;
}

/** The record overlay's left controls (close, previous / next, position) and its close action. */
export interface RecordOverlayChrome {
  navigation: ReactNode;
  close: () => void;
}

export function RecordView(props: RecordViewProps) {
  const { object, recordRef, layout: rawLayout, activeTab, basePath, overlay, onTab } = props;
  const { attributes: all } = useAttributes(object.id);
  const attributes = useMemo(() => all.filter((a) => !a.isArchived), [all]);
  const layout = useMemo(() => resolveLayout(rawLayout), [rawLayout]);
  const [dialog, setDialog] = useState<RecordDialog>(null);
  // "Merge record with…" from the command palette navigates here and asks for the dialog once the page mounted.
  const recordId = recordRef.entityInstanceId;
  useEffect(() => {
    const requested = takeRecordDialog(recordId);
    if (requested) setDialog(requested);
  }, [recordId]);
  const tab = findTab(layout, activeTab) ?? layout.overview ?? layout.allTabs[0];
  const ctx = useMemo<RecordPageContextValue>(
    () => ({
      object,
      recordRef,
      layout,
      rawLayout,
      attributes,
      titleAttribute: titleAttributeOf(object, attributes),
      basePath,
      activeTab: tab?.slug ?? 'overview',
      goToTab: onTab,
      inOverlay: Boolean(overlay),
      openDialog: setDialog,
    }),
    [object, recordRef, layout, rawLayout, attributes, basePath, tab?.slug, onTab, overlay],
  );
  return (
    <RecordPageContext.Provider value={ctx}>
      <RecordFrame initialComments={props.initialComments} overlay={overlay} agentTab={props.agentTab} />
      {dialog === 'edit' && <EditRecordModal onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeModal onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteRecordDialog onClose={() => setDialog(null)} />}
      {dialog === 'choose-list' && <ChooseListDialog onClose={() => setDialog(null)} />}
    </RecordPageContext.Provider>
  );
}

function RecordFrame({
  initialComments,
  overlay,
  agentTab,
}: {
  initialComments?: boolean;
  overlay?: RecordOverlayChrome;
  agentTab?: RecordAgentTabProps;
}) {
  const { object, recordRef, layout, activeTab, openDialog } = useRecordPage();
  const commentLink = useRecordCommentLink(recordRef);
  const [comments, setComments] = useState(Boolean(initialComments || commentLink));
  // A comment deep link for this record (`?threadCommentId=…`) opens the panel on its thread.
  const linkedThread = commentLink?.threadId;
  useEffect(() => {
    if (linkedThread) setComments(true);
  }, [linkedThread]);
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayShortcuts(rootRef, Boolean(overlay));
  const title = useRecordTitleText();
  const newNote = useNewNote();
  const composeEmail = useComposeEmail();
  const newTask = useNewTask();
  useDocumentTitle(title.text || object.singularNoun);
  const favorite = useRecordFavorite(recordRef);
  const canMerge = object.entityType === 'company-record' || object.entityType === 'person-record';
  const favoriteToggle = favorite.toggle;
  const isFavorite = favorite.isFavorite;
  // Palette: the open record's own actions (command-palette.md §3.3 "record page: Add to list, Add/Remove from
  // favorites…") in a section named after it.
  const paletteContext = useMemo(() => {
    const actions: PaletteAction[] = [
      {
        id: 'add-to-list',
        title: 'Add to list',
        icon: 'listAdd',
        gesture: 'Add',
        hint: 'e',
        run: ({ close }) => {
          close();
          openDialog('choose-list');
        },
      },
      {
        id: 'create-task',
        title: 'Create task',
        keywords: ['new task'],
        icon: 'tasks',
        gesture: 'Create',
        hint: 't',
        run: ({ close }) => {
          close();
          newTask(recordRef);
        },
      },
      {
        id: 'create-note',
        title: 'Create note',
        keywords: ['new note'],
        icon: 'notes',
        gesture: 'Create',
        hint: 'n',
        run: ({ close }) => {
          close();
          newNote(recordRef);
        },
      },
      {
        id: 'toggle-favorite',
        title: isFavorite ? 'Remove from favorites' : 'Add to favorites',
        keywords: ['star', 'favourite', 'favorite'],
        icon: isFavorite ? 'favoriteRemove' : 'favorite',
        gesture: isFavorite ? 'Remove' : 'Add',
        run: ({ close }) => {
          close();
          favoriteToggle();
        },
      },
    ];
    if (canMerge) {
      actions.push({
        id: 'merge',
        title: 'Merge records',
        keywords: ['duplicate', 'combine'],
        icon: 'merge',
        gesture: 'Merge',
        run: ({ close }) => {
          close();
          openDialog('merge');
        },
      });
    }
    return { id: 'record-page', title: title.text || object.singularNoun, actions };
  }, [title.text, object.singularNoun, canMerge, isFavorite, favoriteToggle, openDialog, newNote, newTask, recordRef]);
  usePaletteContext(paletteContext);
  useAction('new-entry', () => openDialog('choose-list'));
  useAction('new-email', composeEmail);
  useAction('new-note', () => newNote(recordRef));
  useAction('new-task', () => newTask(recordRef));
  const tab = layout.allTabs.find((t) => t.slug === activeTab) ?? layout.allTabs[0];
  const actions = <TopBarActions comments={comments} onToggleComments={() => setComments((c) => !c)} />;
  return (
    <div className={s.page} data-testid="record-page" data-record-id={recordRef.entityInstanceId} ref={rootRef}>
      {overlay ? (
        <header className={s.overlayBar} data-testid="overlay-bar">
          <div className={s.overlayLeft}>{overlay.navigation}</div>
          {actions}
        </header>
      ) : (
        <Breadcrumbs actions={actions} title={title.text} />
      )}
      <div className={s.row}>
        <Body>
          {tab && <TabContent key={`${recordRef.entityInstanceId}:${tab.slug}`} tab={tab} agentTab={agentTab} />}
        </Body>
        {comments && <RecordCommentsPanel recordRef={recordRef} />}
      </div>
    </div>
  );
}

/**
 * The record overlay is a dialog, and global shortcuts stay quiet inside dialogs (lib/shortcuts): mark the overlay's
 * dialog so the record shortcuts (⌥←/→, e, c, n, t) work there as on the page. Menus, pickers and other dialogs above
 * it keep blocking them.
 */
function useOverlayShortcuts(rootRef: RefObject<HTMLElement | null>, inOverlay: boolean) {
  useEffect(() => {
    if (!inOverlay) return;
    const dialog = rootRef.current?.closest('[data-record-overlay]');
    if (!dialog || dialog.hasAttribute('data-allow-global-shortcuts')) return;
    dialog.setAttribute('data-allow-global-shortcuts', '');
    return () => dialog.removeAttribute('data-allow-global-shortcuts');
  }, [rootRef, inOverlay]);
}

function Breadcrumbs({ actions, title }: { actions: ReactNode; title: string }) {
  const { object } = useRecordPage();
  const { href } = useWorkspace();
  const look = objectAppearance(object);
  return (
    <PageHeader
      crumbs={[
        {
          label: object.pluralNoun,
          icon: <IconTile icon={look.icon} color={look.color} size={16} />,
          href: href(objectPath(object)),
        },
        { label: title || ' ' },
      ]}
      actions={actions}
    />
  );
}

/** Details panel | resize handle | tab area. The panel width is a % of this body, persisted per object. */
function Body({ children }: { children: ReactNode }) {
  const { object } = useRecordPage();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [bodyWidth, setBodyWidth] = useState(0);
  const [stored, setStored] = usePersistentState<number>(panelWidthKey(object.id), DEFAULT_PANEL_PERCENT);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const [tabArea, setTabArea] = useState<HTMLElement | null>(null);

  // The stored % is of the record page width; an open comments panel narrows only the tab area (evidence
  // D-comments-sidebar: the details panel keeps 454 px of 1512).
  const [pageWidth, setPageWidth] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    const page = el?.parentElement;
    if (!el || !page) return;
    const update = () => {
      setBodyWidth(el.clientWidth);
      setPageWidth(page.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  const clampToBody = (px: number, body: number) => Math.max(320, Math.min(px, body - 350));
  const percent = readPercent(stored);
  const width = dragPx ?? (pageWidth > 0 ? clampToBody(panelWidthPx(percent, pageWidth), bodyWidth) : undefined);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width ?? 0;
    const body = bodyRef.current?.clientWidth ?? bodyWidth;
    const page = bodyRef.current?.parentElement?.clientWidth ?? pageWidth;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    target.dataset.dragging = '';
    let latest = startWidth;
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampToBody(panelWidthPx(((startWidth + ev.clientX - startX) / page) * 100, page), body);
      setDragPx(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      delete target.dataset.dragging;
      setStored(percentFromPx(latest, page));
      setDragPx(null);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  return (
    <div className={s.body} ref={bodyRef}>
      <aside
        className={s.details}
        style={{
          width,
          maxWidth: pageWidth > 0 ? Math.max(320, Math.min(0.6 * pageWidth, bodyWidth - 350)) : undefined,
        }}
        aria-label="Record details"
        data-testid="details-panel"
      >
        <DetailsPanel />
      </aside>
      <div
        className={s.resizeHandle}
        style={{ left: width ?? 0 }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize details panel"
        data-testid="panel-resize"
        onPointerDown={onPointerDown}
        onDoubleClick={() => setStored(DEFAULT_PANEL_PERCENT)}
      />
      <main className={s.tabArea} ref={setTabArea}>
        <TabBar />
        <TabAreaContext.Provider value={tabArea}>
          <div className={s.tabContent}>{children}</div>
        </TabAreaContext.Provider>
      </main>
    </div>
  );
}

function TopBarActions({ comments, onToggleComments }: { comments: boolean; onToggleComments: () => void }) {
  const { workspace, me } = useWorkspace();
  const { recordRef } = useRecordPage();
  // Ask AI: what the user is looking at (⌘J, the Ask AI button and the composer chip).
  useAskContext({ records: [recordRef] });
  const self = useMemo(() => ({ userId: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const present = useRecordPresence(workspace.id, recordRef.entityDefinitionId, recordRef.entityInstanceId, self);
  const commentCount = useRecordCommentCount(recordRef);
  return (
    <div className={s.topActions}>
      {present.length > 0 && (
        <>
          <span data-testid="record-presence">
            <AvatarGroup
              size={20}
              max={4}
              items={present.map((u) => ({ id: u.userId, name: u.name, seed: u.userId, kind: 'member' as const }))}
            />
          </span>
          <span className={s.topDivider} />
        </>
      )}
      <span className={s.topGroup}>
        <AriaButton
          className={s.commentsButton}
          aria-label="View comments"
          aria-pressed={comments}
          data-pressed={comments || undefined}
          onPress={onToggleComments}
          data-testid="comments-toggle"
        >
          <Icon icon="chat" size={16} />
          {commentCount > 0 && <span>{commentCount}</span>}
        </AriaButton>
        <IconButton
          icon="help"
          variant="ghost"
          size={28}
          aria-label="Help"
          tooltip="Open help drawer"
          onPress={() => openHelpDrawer()}
        />
        <RecordActionsMenu />
      </span>
      <AskButton />
    </div>
  );
}

/** "Record actions" ⋮ (D §3.1). */
function RecordActionsMenu() {
  const { object, recordRef, rawLayout, basePath, openDialog } = useRecordPage();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const favorite = useRecordFavorite(recordRef);
  const access = useEntityAccess(recordRef.entityDefinitionId);
  const canMerge =
    (object.entityType === 'company-record' || object.entityType === 'person-record') && access.canEditValues;
  const copy = async (textValue: string) => {
    try {
      await navigator.clipboard.writeText(textValue);
      toast({ title: 'Copied to clipboard!', icon: 'copy' });
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };
  return (
    <MenuTrigger>
      <IconButton icon="moreVertical" variant="ghost" size={28} aria-label="Record actions" />
      <Menu
        aria-label="Record actions"
        placement="bottom end"
        width={160}
        onAction={(key) => {
          if (key === 'merge') openDialog('merge');
          if (key === 'configure') void navigate({ href: href(`${objectPath(object)}/page-layout/${rawLayout.id}`) });
          if (key === 'copy-url') void copy(`${window.location.origin}${basePath}`);
          if (key === 'copy-id') void copy(recordRef.entityInstanceId);
          if (key === 'favorite') favorite.toggle();
          if (key === 'delete') openDialog('delete');
        }}
      >
        {canMerge && (
          <MenuItem id="merge" icon="merge">
            Merge records
          </MenuItem>
        )}
        <MenuItem id="configure" icon="settings">
          Configure page
        </MenuItem>
        <MenuItem id="copy-url" icon="copy">
          Copy page URL
        </MenuItem>
        <MenuItem id="copy-id" icon="copy">
          Copy record ID
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="favorite" icon="favorite">
          {favorite.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        </MenuItem>
        {access.canDeleteRecords && <MenuSeparator />}
        {access.canDeleteRecords && (
          <MenuItem id="delete" icon="delete" variant="danger">
            Delete record
          </MenuItem>
        )}
      </Menu>
    </MenuTrigger>
  );
}
