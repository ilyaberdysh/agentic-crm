// List page:
// list-icon-picker.png, list-no-views.png, list-comments-panel.png). `/$ws/collection/$listId` opens the first view;
// a list without views shows "Start with a view" (+ "or" Delete list); unknown / forbidden lists say so.
// header emoji button (emoji picker → icon) + name button (inline rename) | facepile (list room), Share,
// Comments, Help, ⋮ (List settings, Manage attributes, Duplicate list, Copy list ID, Notifications ›,
// Delete list), Ask AI
// view bar view switcher, View settings | Import / Export ▾, "+ Add <Parent>"
// body sort/filter bar + the entries table (features/table with the list props) or the board, and the
// comments panel (list level "Comments", entry level "‹ All comments" / "Add comment on <record>")

import type { AttributeDefinition, EntityDefinition, RecordRef } from '@agentic-crm/contracts';
import {
  AlertDialog,
  AvatarGroup,
  Button,
  EmptyState,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Submenu,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { Navigate, useRouter, useRouterState } from '@tanstack/react-router';
import { type KeyboardEvent, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useObjects } from '../../data/objects';
import { httpStatusOf } from '../../data/trpc';
import { useShortcut } from '../../lib/shortcuts';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { NoAccessState } from '../access/NoAccessState';
import { ReadOnlyBadge } from '../access/ReadOnlyBadge';
import { SharePopover } from '../access/SharePopover';
import { useEntityAccess } from '../access/useEntityAccess';
import { AskButton } from '../ask/AskButton';
import { RecordChip } from '../attributes';
import { ObjectCommentsPanel, RecordCommentsPanel } from '../comments';
import { EmojiPickerPopover } from '../comments/emoji/EmojiPicker';
import { composeToRecords } from '../composer/compose';
import { ImportExportMenu } from '../exports';
import { KanbanBoard, KanbanFilterBar, KanbanProvider, KanbanViewSettings, useKanbanContext } from '../kanban';
import * as op from '../objects/objectPage.css';
import { RecordPreviewHost } from '../record/overlay/RecordPreview';
import { AttributeDialog, type AttributeDialogMode } from '../settings/objects/attributes/AttributeDialog';
import { putPermission } from '../settings/permissions/data';
import { ContentSpinner } from '../shell/AppShell';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import {
  StartWithAView,
  useViewDraft,
  type ViewDraft,
  ViewFilterSortBar,
  ViewSettingsPopover,
  ViewSwitcher,
} from '../table/contracts';
import { useViewPresence } from '../table/presence';
import { RecordTable, type RecordTableHandle, type RecordTableObject } from '../table/RecordTable';
import { useRecordValues } from '../table/values';
import { useViews } from '../views';
import { AddRecordFlow, type AddRecordFlowProps } from './AddRecordFlow';
import {
  deleteList,
  duplicateList,
  type List,
  parentNouns,
  parentRecordAttribute,
  updateList,
  useList,
  useListAttributes,
  useListDefinition,
  useLists,
} from './data';
import { EditEntryDialog } from './EditEntryDialog';
import {
  EntryParentCell,
  EntryRowsContext,
  entryParentCopyText,
  entryParents,
  parentOf,
  useEntryRowActions,
} from './entryRows';
import { BulkAddToList, listPath, RemoveEntriesDialog } from './flows';
import { iconOfEmoji, ListIcon } from './icon';
import * as s from './lists.css';
import { ObjectIconTile, RecordName, useParentObjects } from './parts';
import { useListPresence } from './presence';
import { recordListVisit } from './visits';

export interface ListPageProps {
  listId: string;
  viewId?: string;
  /** `/entry/$entryId/comments`: open the comments panel on that entry. */
  commentsEntryId?: string;
}

/** Route component: resolves the list and its views, redirects to the first view. */
export function ListPage({ listId, viewId, commentsEntryId }: ListPageProps) {
  const { workspace, href, isAdmin } = useWorkspace();
  const list = useList(workspace, listId);
  const definition = useListDefinition(workspace, list.data?.id);
  const views = useViews(list.data?.id);
  const searchStr = useRouterState({ select: (st) => st.location.searchStr });
  useDocumentTitle(list.data?.name ?? 'List');

  const access = useEntityAccess(list.data?.id);
  if (list.isError && !list.data) {
    const status = httpStatusOf(list.error);
    return status === 403 ? <NoAccessState kind="list" canGrant={false} /> : <ListNotAvailable status={status} />;
  }
  // An admin can open any list but follows its grants for the data (OQ-067): "Add yourself" grants Full access.
  if (list.data && access.known && !access.canRead) {
    const id = list.data.id;
    return (
      <NoAccessState
        kind="list"
        canGrant={isAdmin}
        onAddYourself={() =>
          putPermission(workspace, 'list', id, { type: 'member', id: workspace.membership.id }, 'full-access')
        }
      />
    );
  }
  if (!list.data || !views.data) return <ContentSpinner />;
  const live = views.data.filter((v) => !v.isArchived);
  if (live.length === 0) return <NoViews list={list.data} definition={definition.data} />;
  const current = live.find((v) => v.id === viewId);
  if (!current) {
    const first = live[0] as (typeof live)[number];
    const to = href(`${listPath(list.data)}/view/${first.id}`);
    // Deep links keep their search params; `/entry/<id>/comments` opens the entry's comments.
    if (commentsEntryId) return <Navigate to={to} search={{ comments: commentsEntryId } as never} replace />;
    return <Navigate to={to} search={searchStr ? true : undefined} replace />;
  }
  return <ListView key={current.id} list={list.data} definition={definition.data} viewId={current.id} />;
}

function ListNotAvailable({ status }: { status: number }) {
  return (
    <>
      <PageHeader crumbs={[{ label: 'List not available', icon: 'list' }]} />
      <div className={s.notAvailable} data-testid="list-not-available">
        <EmptyState
          icon="list"
          title={status === 403 ? 'No access to this list' : 'List not available'}
          description="This list either doesn't exist or you don't have permission to access it."
        />
      </div>
    </>
  );
}

// ---- header ----------------------------------------------------------------------------------------------------

function ListTitle({ list }: { list: List }) {
  const { workspace } = useWorkspace();
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(list.name);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const done = useRef(false);

  const save = () => {
    if (done.current) return;
    done.current = true;
    setRenaming(false);
    const name = draft.trim();
    if (!name || name === list.name) return;
    void updateList(workspace, list, { name }).catch(() => toast.error('Failed to rename list'));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done.current = true;
      setRenaming(false);
    }
  };
  return (
    <div className={s.titleGroup} data-testid="list-title">
      <Tooltip content="Change list icon">
        <AriaButton
          ref={emojiRef}
          className={s.headerEmoji}
          aria-label="Change list icon"
          onPress={() => setPicking(true)}
        >
          <ListIcon icon={list.icon} size={18} />
        </AriaButton>
      </Tooltip>
      {renaming ? (
        <input
          className={s.nameInput}
          aria-label="List name"
          placeholder="Enter list name..."
          value={draft}
          ref={(el) => {
            if (el && document.activeElement !== el) {
              el.focus();
              el.select();
            }
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
        />
      ) : (
        <AriaButton
          className={s.nameButton}
          aria-label="Rename list"
          data-testid="list-name"
          onPress={() => {
            setDraft(list.name);
            done.current = false;
            setRenaming(true);
          }}
        >
          {list.name}
        </AriaButton>
      )}
      {picking && (
        <EmojiPickerPopover
          placement="bottom start"
          triggerRef={emojiRef}
          onPick={(emoji) =>
            void updateList(workspace, list, { icon: iconOfEmoji(emoji) }).catch(() =>
              toast.error('Failed to change list icon'),
            )
          }
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

export type ListDialog = 'duplicate' | 'delete' | null;

function HeaderActions({
  list,
  commentsOpen,
  onToggleComments,
}: {
  list: List;
  commentsOpen: boolean;
  onToggleComments: () => void;
}) {
  const { workspace, me, href } = useWorkspace();
  const router = useRouter();
  const self = useMemo(() => ({ userId: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const users = useListPresence(workspace.id, list.id, self);
  const [dialog, setDialog] = useState<ListDialog>(null);
  const access = useEntityAccess(list.id);
  const go = (path: string) => void router.navigate({ href: href(path) });
  return (
    <div className={op.headerActions}>
      {users.length > 0 && (
        <span data-testid="list-presence">
          <AvatarGroup
            size={20}
            max={4}
            items={users.map((u) => ({ id: u.userId, name: u.name, seed: u.userId, kind: 'member' as const }))}
          />
        </span>
      )}
      {access.isReadOnly && <ReadOnlyBadge what="entries" />}
      <SharePopover kind="list" resourceId={list.id} />
      <span className={op.divider} />
      <span className={op.headerGroup}>
        <IconButton
          icon="comment"
          aria-label="Comments"
          tooltip="View comments"
          isActive={commentsOpen}
          onPress={onToggleComments}
          data-testid="list-comments-button"
        />
        <IconButton icon="help" aria-label="Help" tooltip="Open help drawer" />
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Show menu" data-testid="list-menu-button" />
          <Menu
            aria-label="List menu"
            placement="bottom end"
            width={208}
            onAction={(key) => {
              if (key === 'settings') go(`settings/data/lists/${list.id}/general`);
              else if (key === 'attributes') go(`settings/data/lists/${list.id}/attributes`);
              else if (key === 'duplicate') setDialog('duplicate');
              else if (key === 'copy-id')
                void navigator.clipboard
                  .writeText(list.id)
                  .then(() => toast({ title: 'Copied to clipboard', icon: 'copy' }))
                  .catch(() => toast.error('Could not copy to the clipboard'));
              else if (key === 'delete') setDialog('delete');
            }}
          >
            <MenuItem id="settings" icon="settings">
              List settings
            </MenuItem>
            <MenuItem id="attributes" icon="apps">
              Manage attributes
            </MenuItem>
            <MenuItem id="duplicate" icon="duplicate">
              Duplicate list
            </MenuItem>
            <MenuItem id="copy-id" icon="copy">
              Copy list ID
            </MenuItem>
            <MenuSeparator />
            <Submenu label="Notifications" icon="notifications" menuWidth={240}>
              <MenuItem id="slack" icon="apps" onAction={() => toast({ title: 'Slack arrives with integrations' })}>
                Connect Slack workspace
              </MenuItem>
            </Submenu>
            <MenuSeparator />
            <MenuItem id="delete" icon="delete" variant="danger">
              Delete list
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
      <AskButton />
      <ListDialogs list={list} dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

/** Duplicate and delete confirmations. */
export function ListDialogs({
  list,
  dialog,
  onClose,
  afterDelete = 'home',
}: {
  list: List;
  dialog: ListDialog;
  onClose: () => void;
  /** Where to go once the list is gone (settings pages stay in settings). */
  afterDelete?: 'home' | 'settings' | 'stay';
}) {
  const { workspace, href } = useWorkspace();
  const router = useRouter();
  const lists = useLists(workspace);
  const duplicate = async () => {
    onClose();
    const pending = toast({
      title: 'Duplicate list',
      description: `Duplicating ${list.name}...`,
      icon: 'spinner',
      durationMs: Number.POSITIVE_INFINITY,
      dismissable: false,
    });
    try {
      const copy = await duplicateList(
        workspace,
        list,
        (lists.data ?? []).map((l) => l.name),
      );
      toast.dismiss(pending);
      toast.success({ title: 'List successfully duplicated', durationMs: 5000 });
      void router.navigate({ href: href(listPath(copy)) });
    } catch {
      toast.dismiss(pending);
      toast.error('Something went wrong while trying to duplicate this list');
    }
  };
  const remove = async () => {
    onClose();
    try {
      await deleteList(workspace, list);
      toast.success('List deleted');
      if (afterDelete !== 'stay')
        void router.navigate({
          href: href(afterDelete === 'settings' ? 'settings/data/lists' : 'home'),
          replace: true,
        });
    } catch {
      toast.error('Failed to delete list');
    }
  };
  return (
    <>
      <AlertDialog
        isOpen={dialog === 'duplicate'}
        onOpenChange={(open) => !open && onClose()}
        title={`Are you sure you want to duplicate ${list.name}?`}
        confirmLabel="Duplicate"
        variant="primary"
        onCancel={onClose}
        onConfirm={() => void duplicate()}
      />
      <AlertDialog
        isOpen={dialog === 'delete'}
        onOpenChange={(open) => !open && onClose()}
        title="Delete list"
        description="Deleting a list deletes its data and views permanently and cannot be undone."
        confirmLabel="Delete list"
        variant="danger"
        onCancel={onClose}
        onConfirm={() => void remove()}
      />
    </>
  );
}

// ---- no views ---------------------------------------------------------------------------------------------------

function NoViews({ list, definition }: { list: List; definition: EntityDefinition | undefined }) {
  const { href } = useWorkspace();
  const router = useRouter();
  const [dialog, setDialog] = useState<ListDialog>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const parents = useParentObjects(list);
  const nouns = parentNouns(list, parents);
  return (
    <>
      <PageHeader
        start={<ListTitle list={list} />}
        actions={
          <HeaderActions list={list} commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((o) => !o)} />
        }
      />
      <div className={op.page}>
        <StartWithAView
          object={{ id: list.id, pluralNoun: nouns.plural }}
          onCreated={(view) => void router.navigate({ href: href(`${listPath(list)}/view/${view.id}`) })}
          learnMoreInline
          extra={
            <>
              <div className={s.orRow}>or</div>
              <AriaButton className={s.deleteRow} onPress={() => setDialog('delete')} data-testid="no-views-delete">
                <span className={s.deleteTile}>
                  <Icon icon="delete" size={16} />
                </span>
                Delete list
              </AriaButton>
            </>
          }
        />
      </div>
      <ListDialogs list={list} dialog={dialog} onClose={() => setDialog(null)} />
    </>
  );
}

// ---- a view of the list ------------------------------------------------------------------------------------------

function ListView({
  list,
  definition,
  viewId,
}: {
  list: List;
  definition: EntityDefinition | undefined;
  viewId: string;
}) {
  const { workspace, href, me } = useWorkspace();
  const router = useRouter();
  const search = useRouterState({ select: (st) => st.location.search as Record<string, unknown> });
  const commentsParam = typeof search.comments === 'string' ? search.comments : null;
  const [comments, setComments] = useState<{ open: boolean; entryId: string | null }>({
    open: Boolean(commentsParam),
    entryId: commentsParam && commentsParam !== 'all' ? commentsParam : null,
  });
  const self = useMemo(() => ({ userId: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const presence = useViewPresence(workspace.id, viewId, self);
  useEffect(() => recordListVisit(list.id), [list.id]);
  const navigate = useCallback(
    (id: string | null) => void router.navigate({ href: href(id ? `${listPath(list)}/view/${id}` : listPath(list)) }),
    [router, href, list],
  );
  return (
    <>
      <PageHeader
        start={<ListTitle list={list} />}
        actions={
          <HeaderActions
            list={list}
            commentsOpen={comments.open}
            onToggleComments={() => setComments((c) => ({ open: !c.open, entryId: null }))}
          />
        }
      />
      <div className={op.page} data-testid="list-page">
        <Suspense fallback={<ToolbarSkeleton />}>
          <ListViewContent
            list={list}
            definition={definition}
            viewId={viewId}
            presence={presence}
            navigate={navigate}
            comments={comments}
            setComments={setComments}
          />
        </Suspense>
      </div>
      <RecordPreviewHost />
    </>
  );
}

interface CommentsState {
  open: boolean;
  entryId: string | null;
}

interface ListViewContentProps {
  list: List;
  definition: EntityDefinition | undefined;
  viewId: string;
  presence: ReturnType<typeof useViewPresence>;
  navigate: (viewId: string | null) => void;
  comments: CommentsState;
  setComments: (next: CommentsState) => void;
}

/** The list as a table-able definition: entries titled by their parent record ("Add <Parent>" nouns). */
function useListObject(list: List, definition: EntityDefinition | undefined): RecordTableObject {
  const nouns = parentNouns(list, useParentObjects(list));
  return useMemo<RecordTableObject>(
    () => ({
      id: list.id,
      apiSlug: definition?.apiSlug ?? list.apiSlug,
      entityType: 'collection-entry',
      standardObjectType: null,
      singularNoun: nouns.singular,
      pluralNoun: nouns.plural,
      epithetPath: null,
    }),
    [list.id, list.apiSlug, definition?.apiSlug, nouns.singular, nouns.plural],
  );
}

function ListViewContent(props: ListViewContentProps) {
  const draft = useViewDraft(props.viewId);
  const listObject = useListObject(props.list, props.definition);
  if (draft.view.type === 'kanban') {
    // One board state for the view bar's settings, the filter bar's toggles and the board (features/kanban).
    return (
      <KanbanProvider definition={listObject} draft={draft}>
        <ListViewBody {...props} draft={draft} tableObject={listObject} />
      </KanbanProvider>
    );
  }
  return <ListViewBody {...props} draft={draft} tableObject={listObject} />;
}

function ListViewBody({
  list,
  definition,
  viewId,
  presence,
  navigate,
  comments,
  setComments,
  draft,
  tableObject,
}: ListViewContentProps & { draft: ViewDraft; tableObject: RecordTableObject }) {
  const { workspace } = useWorkspace();
  const isKanban = draft.view.type === 'kanban';
  const kanban = useKanbanContext();
  const objects = useObjects(workspace).data ?? [];
  const attributes = useListAttributes(workspace, list.id);
  const parentAttribute = useMemo(
    () => parentRecordAttribute(attributes.data ?? [], list.parentRecordAttributeId),
    [attributes.data, list.parentRecordAttributeId],
  );
  const parents = useParentObjects(list);
  const nouns = parentNouns(list, parents);
  const parentObject = parents.length === 1 ? parents[0] : undefined;
  const table = useRef<RecordTableHandle>(null);
  const access = useEntityAccess(list.id);
  const [adding, setAdding] = useState<{ initialValues?: AddRecordFlowProps['initialValues'] } | null>(null);
  const [removing, setRemoving] = useState<{ entryIds: string[]; clear: () => void } | null>(null);
  const [bulkAdd, setBulkAdd] = useState<{ records: RecordRef[]; objectId: string; clear: () => void } | null>(null);
  const [attributeDialog, setAttributeDialog] = useState<AttributeDialogMode | null>(null);
  const editAttribute = useCallback(
    (attribute: AttributeDefinition) => setAttributeDialog({ kind: 'edit', attribute }),
    [],
  );
  const createAttribute = useCallback(() => setAttributeDialog({ kind: 'create' }), []);
  const [editing, setEditing] = useState<{ entryId: string; parent: RecordRef } | null>(null);
  // The list Comments panel shows comments on the entries of the current view (the table's snapshot).
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  useShortcut('e', () => access.canCreateRecords && setAdding({}));
  const importCsv = useImportCsv(list);
  const refresh = () => (kanban ? kanban.board.refresh() : table.current?.refresh());
  // A board column's "+" adds into that stage: a list stage is prefilled in the Add to list form.
  const addToStage = useCallback(
    ({ stageId, groupBy }: { stageId: string | null; groupBy: ViewDraft['view']['kanbanPivotPath'] }) => {
      const hop = groupBy?.length === 1 ? groupBy[0] : undefined;
      const kind = kanban?.board.groupKind;
      setAdding(
        stageId && hop && kind
          ? {
              initialValues: {
                [hop.attributeDefinitionId]: [
                  { value: kind === 'pipeline' ? { pipelineStageId: stageId } : { selectOptionId: stageId } },
                ],
              },
            }
          : {},
      );
    },
    [kanban?.board.groupKind],
  );
  const editCard = useCallback(
    (entryId: string) => {
      const [parent] = entryParents(workspace, list.id, parentAttribute?.id, [entryId]);
      if (parent) setEditing({ entryId, parent });
    },
    [workspace, list.id, parentAttribute?.id],
  );
  const rowActions = useEntryRowActions(list, parentAttribute, draft.view.title);
  const recordColumn = useMemo(
    () =>
      parentAttribute
        ? {
            label: nouns.singular,
            icon: parentObject ? <ObjectIconTile object={parentObject} /> : undefined,
            Cell: EntryParentCell,
            copyText: (rowId: string) => entryParentCopyText(workspace, list.id, parentAttribute.id, rowId),
          }
        : undefined,
    [parentAttribute, nouns.singular, parentObject, workspace, list.id],
  );

  const emptyState = (
    <div className={s.emptyList} data-testid="list-empty">
      <EmptyListIllustration />
      <h3 className={s.emptyTitle}>No records</h3>
      <p className={s.emptyText}>No records yet! Add your first record to get started.</p>
      <div className={s.emptyActions}>
        <Button variant="secondary" size={28} icon="upload" isDisabled={!access.canCreateRecords} onPress={importCsv}>
          Import CSV
        </Button>
        <Button
          variant="primary"
          size={28}
          icon="add"
          isDisabled={!access.canCreateRecords}
          onPress={() => setAdding({})}
        >
          Add {nouns.singular}
        </Button>
      </div>
      <div className={s.learnMore}>
        <div className={s.learnLabel}>Learn more</div>
        <div className={s.learnCard}>
          <span className={s.learnTile}>
            <Icon icon="learn" size={20} />
          </span>
          Lists
        </div>
      </div>
    </div>
  );

  const entryRows = useMemo(
    () => ({ listId: list.id, parentAttributeId: parentAttribute?.id }),
    [list.id, parentAttribute?.id],
  );
  return (
    <EntryRowsContext.Provider value={entryRows}>
      <div className={op.viewBar} data-testid="view-bar">
        <div className={op.group}>
          <ViewSwitcher entityDefinitionId={list.id} currentViewId={viewId} onNavigate={navigate} />
          {isKanban ? (
            <KanbanViewSettings onEditAttribute={editAttribute} onCreateAttribute={createAttribute} />
          ) : (
            <ViewSettingsPopover draft={draft} onEditAttribute={editAttribute} onCreateAttribute={createAttribute} />
          )}
        </div>
        <div className={op.group}>
          <ImportExportMenu
            base={listPath(list)}
            title={list.name}
            viewId={viewId}
            viewTitle={draft.view.title}
            canImport={access.canCreateRecords}
          />
          <Button
            variant="primary"
            size={28}
            icon="add"
            isDisabled={!access.canCreateRecords}
            onPress={() => setAdding({})}
            data-testid="add-entry"
          >
            Add {nouns.singular}
          </Button>
        </div>
      </div>
      <div className={op.contentRow}>
        <div className={op.contentColumn}>
          {isKanban ? (
            <KanbanFilterBar draft={draft} onNavigate={navigate} />
          ) : (
            <ViewFilterSortBar draft={draft} onNavigate={navigate} />
          )}
          {isKanban ? (
            <KanbanBoard
              definition={tableObject}
              draft={draft}
              onAddCard={addToStage}
              onEditCard={editCard}
              addLabel={`Add ${nouns.singular}`}
              onImport={importCsv}
            />
          ) : (
            <RecordTable
              ref={table}
              object={tableObject}
              draft={draft}
              presence={presence}
              onNewRecord={() => setAdding({})}
              onClearFilter={() => draft.setFilter(null)}
              onEditAttribute={editAttribute}
              onCreateAttribute={createAttribute}
              recordColumn={recordColumn}
              editablePathHead={parentAttribute?.id}
              onOpenRow={rowActions.open}
              onPreviewRow={rowActions.preview}
              onCommentRow={(entryId) => setComments({ open: true, entryId })}
              emptyState={emptyState}
              onBulkAddToList={(entryIds, clear) => {
                const records = entryParents(workspace, list.id, parentAttribute?.id, entryIds);
                const objectId = records[0]?.entityDefinitionId ?? list.parentEntityDefinitionIds[0];
                if (objectId && records.length > 0) setBulkAdd({ records, objectId, clear });
              }}
              onBulkSendEmail={(entryIds, clear) => {
                void composeToRecords(workspace, entryParents(workspace, list.id, parentAttribute?.id, entryIds));
                clear();
              }}
              onSnapshot={setSnapshotId}
              bulkRemove={{
                label: () => 'Remove from list',
                onRemove: (entryIds, clear) => setRemoving({ entryIds, clear }),
              }}
            />
          )}
        </div>
        {comments.open &&
          (comments.entryId ? (
            <EntryComments
              list={list}
              entryId={comments.entryId}
              parentAttributeId={parentAttribute?.id}
              onBack={() => setComments({ open: true, entryId: null })}
              onClose={() => setComments({ open: false, entryId: null })}
            />
          ) : (
            <ObjectCommentsPanel
              entityDefinitionId={list.id}
              snapshotId={isKanban ? null : snapshotId}
              title="Comments"
              showBack={false}
              subjectOf={(target) => <EntrySubject listId={list.id} entryId={target.entityInstanceId} />}
              onClose={() => setComments({ open: false, entryId: null })}
            />
          ))}
      </div>
      {adding && (
        <AddRecordFlow
          list={list}
          initialValues={adding.initialValues}
          onClose={() => setAdding(null)}
          onAdded={refresh}
        />
      )}
      {editing && (
        <EditEntryDialog
          list={list}
          entryId={editing.entryId}
          parent={editing.parent}
          onClose={() => setEditing(null)}
        />
      )}
      {removing && (
        <RemoveEntriesDialog
          list={list}
          entryIds={removing.entryIds}
          parents={entryParents(workspace, list.id, parentAttribute?.id, removing.entryIds)}
          onClose={() => setRemoving(null)}
          onRemoved={removing.clear}
        />
      )}
      {bulkAdd && (
        <BulkAddToList
          objectId={bulkAdd.objectId}
          records={bulkAdd.records}
          onClose={() => setBulkAdd(null)}
          onDone={bulkAdd.clear}
        />
      )}
      {attributeDialog && definition && (
        <AttributeDialog
          workspace={workspace}
          object={definition}
          objects={objects as unknown as EntityDefinition[]}
          mode={attributeDialog}
          isOpen
          onOpenChange={(open) => !open && setAttributeDialog(null)}
        />
      )}
    </EntryRowsContext.Provider>
  );
}

function EntryComments({
  list,
  entryId,
  parentAttributeId,
  onBack,
  onClose,
}: {
  list: List;
  entryId: string;
  parentAttributeId: string | undefined;
  onBack: () => void;
  onClose: () => void;
}) {
  const { workspace } = useWorkspace();
  const values = useRecordValues(workspace, list.id, parentAttributeId, entryId, true);
  const parent = parentOf(values.values);
  return (
    <RecordCommentsPanel
      recordRef={{ entityDefinitionId: list.id, entityInstanceId: entryId }}
      kind="list-entry"
      onBack={onBack}
      onClose={onClose}
      subject={<>Add comment on {parent && <RecordChip {...parent} />}</>}
    />
  );
}

/** A list comment card's first line: the entry's parent record (list-comments-panel.png). */
function EntrySubject({ listId, entryId }: { listId: string; entryId: string }) {
  const { workspace } = useWorkspace();
  const { parentAttributeId } = useContext(EntryRowsContext);
  const values = useRecordValues(workspace, listId, parentAttributeId, entryId, true);
  const parent = parentOf(values.values);
  return parent ? <RecordName record={parent} /> : null;
}

/** Import CSV lives at `/collection/<id>/import` (features/imports). */
function useImportCsv(list: List): () => void {
  const { href } = useWorkspace();
  const router = useRouter();
  return useCallback(() => void router.navigate({ href: href(`${listPath(list)}/import`) }), [router, href, list]);
}

const CORNERS = [
  { left: -3, top: -3 },
  { right: -3, top: -3 },
  { left: -3, bottom: -3 },
  { right: -3, bottom: -3 },
];

/** Empty list illustration (drawn for this project): a framed card glyph on a dotted tile. */
function EmptyListIllustration() {
  return (
    <div className={s.illustration} aria-hidden="true">
      <span className={s.illustrationDots} />
      {CORNERS.map((pos) => (
        <span key={JSON.stringify(pos)} className={s.illustrationCorner} style={pos} />
      ))}
      <span className={s.illustrationCard}>
        <span className={s.illustrationChip} />
        <span className={s.illustrationLine} style={{ top: 52, width: 52 }} />
        <span className={s.illustrationLine} style={{ top: 67, width: 31 }} />
      </span>
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <div className={op.viewBar}>
      <div className={op.toolbarSkeleton}>
        <Skeleton width={150} height={28} />
        <Skeleton width={130} height={28} />
      </div>
    </div>
  );
}
