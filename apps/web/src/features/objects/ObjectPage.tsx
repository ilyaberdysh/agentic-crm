// Object page frame (BACKLOG 2.01; C1 README §2.1, §3.8): page header (object icon + plural name; presence avatars,
// Share, Comments, Help, ⋮ menu, Ask AI), view bar (view switcher, View settings | Import / Export, + New {singular}),
// sort/filter bar, then the record table — or, for kanban views, the board (features/kanban) — for the view draft. Views and their drafts come from features/views (C2),
// the table from features/table (C3).

import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import {
  AvatarGroup,
  Button,
  IconButton,
  IconTile,
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useRouter } from '@tanstack/react-router';
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { objectPath, useObjects } from '../../data/objects';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { ReadOnlyBadge } from '../access/ReadOnlyBadge';
import { SharePopover } from '../access/SharePopover';
import { useEntityAccess } from '../access/useEntityAccess';
import { AskButton } from '../ask/AskButton';
import { ObjectCommentsPanel } from '../comments/CommentsPanel';
import { useObjectCommentsPanel } from '../comments/deepLink';
import { composeToRecords } from '../composer/compose';
import { ImportExportMenu } from '../exports';
import { KanbanBoard, KanbanFilterBar, KanbanProvider, KanbanViewSettings, useKanbanContext } from '../kanban';
import { openListsDialog } from '../lists/flows';
import { RecordPreviewHost } from '../record/overlay/RecordPreview';
import { AttributeDialog, type AttributeDialogMode } from '../settings/objects/attributes/AttributeDialog';
import { objectAppearance } from '../shell/objectAppearance';
import { PageHeader } from '../shell/PageHeader';
import { useWorkspace } from '../shell/workspaceContext';
import {
  NewRecordDialog,
  useViewDraft,
  type ViewDraft,
  ViewFilterSortBar,
  ViewSettingsPopover,
  ViewSwitcher,
} from '../table/contracts';
import { usePresenceUsers, useViewPresence, type ViewPresence } from '../table/presence';
import { RecordTable, type RecordTableHandle, type RecordTableObject } from '../table/RecordTable';
import * as s from './objectPage.css';

export type PageObject = RecordTableObject & Pick<EntityDefinition, 'icon'>;

export function ObjectPage({ object, viewId }: { object: PageObject; viewId: string }) {
  const { workspace, me } = useWorkspace();
  const look = objectAppearance(object as Parameters<typeof objectAppearance>[0]);
  const self = useMemo(() => ({ userId: me.user.id, name: me.user.name }), [me.user.id, me.user.name]);
  const presence = useViewPresence(workspace.id, viewId, self);
  useDocumentTitle(object.pluralNoun);
  return (
    <>
      <PageHeader
        crumbs={[{ label: object.pluralNoun, icon: <IconTile icon={look.icon} color={look.color} size={16} /> }]}
        actions={<HeaderActions object={object} presence={presence} />}
      />
      <div className={s.page} data-testid="object-page">
        <Suspense fallback={<ToolbarSkeleton />}>
          <ViewContent object={object} viewId={viewId} presence={presence} />
        </Suspense>
      </div>
      <RecordPreviewHost />
    </>
  );
}

/** Navigates to a view of the object (null: the bare object URL, which opens the first view or "Start with a view"). */
export function useViewNavigation(object: Pick<PageObject, 'apiSlug' | 'entityType'>) {
  const { href } = useWorkspace();
  const router = useRouter();
  return useCallback(
    (viewId: string | null) =>
      void router.navigate({ href: href(viewId ? `${objectPath(object)}/view/${viewId}` : objectPath(object)) }),
    [router, href, object],
  );
}

function ViewContent({ object, viewId, presence }: { object: PageObject; viewId: string; presence: ViewPresence }) {
  const draft = useViewDraft(viewId);
  if (draft.view.type === 'kanban') {
    // One board state for the view bar's settings, the filter bar's toggles and the board (features/kanban).
    return (
      <KanbanProvider definition={object} draft={draft}>
        <ViewBody object={object} viewId={viewId} presence={presence} draft={draft} />
      </KanbanProvider>
    );
  }
  return <ViewBody object={object} viewId={viewId} presence={presence} draft={draft} />;
}

function ViewBody({
  object,
  viewId,
  presence,
  draft,
}: {
  object: PageObject;
  viewId: string;
  presence: ViewPresence;
  draft: ViewDraft;
}) {
  const isKanban = draft.view.type === 'kanban';
  const kanban = useKanbanContext();
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data ?? [];
  const navigate = useViewNavigation(object);
  const table = useRef<RecordTableHandle>(null);
  const [creating, setCreating] = useState(false);
  const [attributeDialog, setAttributeDialog] = useState<AttributeDialogMode | null>(null);
  const editAttribute = useCallback(
    (attribute: AttributeDefinition) => setAttributeDialog({ kind: 'edit', attribute }),
    [],
  );
  const createAttribute = useCallback(() => setAttributeDialog({ kind: 'create' }), []);
  const comments = useObjectCommentsPanel();
  const access = useEntityAccess(object.id);
  return (
    <>
      <div className={s.viewBar} data-testid="view-bar">
        <div className={s.group}>
          <ViewSwitcher entityDefinitionId={object.id} currentViewId={viewId} onNavigate={navigate} />
          {isKanban ? (
            <KanbanViewSettings onEditAttribute={editAttribute} onCreateAttribute={createAttribute} />
          ) : (
            <ViewSettingsPopover draft={draft} onEditAttribute={editAttribute} onCreateAttribute={createAttribute} />
          )}
        </div>
        <div className={s.group}>
          <ImportExportMenu
            base={objectPath(object)}
            title={object.pluralNoun}
            viewId={viewId}
            viewTitle={draft.view.title}
            canImport={access.canCreateRecords}
          />
          <Tooltip
            content={`You don't have permission to create ${object.pluralNoun.toLowerCase()}`}
            isDisabled={access.canCreateRecords}
          >
            <Button
              variant="primary"
              size={28}
              icon="add"
              isDisabled={!access.canCreateRecords}
              onPress={() => setCreating(true)}
            >
              New {object.singularNoun}
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className={s.contentRow}>
        <div className={s.contentColumn}>
          {isKanban ? (
            <KanbanFilterBar draft={draft} onNavigate={navigate} />
          ) : (
            <ViewFilterSortBar draft={draft} onNavigate={navigate} />
          )}
          {isKanban ? (
            <KanbanBoard definition={object} draft={draft} />
          ) : (
            <RecordTable
              ref={table}
              object={object}
              draft={draft}
              presence={presence}
              onNewRecord={() => setCreating(true)}
              onClearFilter={() => draft.setFilter(null)}
              onEditAttribute={editAttribute}
              onCreateAttribute={createAttribute}
              onBulkAddToList={(ids, clear) =>
                openListsDialog({
                  kind: 'bulk-add',
                  objectId: object.id,
                  records: ids.map((id) => ({ entityDefinitionId: object.id, entityInstanceId: id })),
                  onDone: clear,
                })
              }
              onBulkSendEmail={(ids, clear) => {
                void composeToRecords(
                  workspace,
                  ids.map((id) => ({ entityDefinitionId: object.id, entityInstanceId: id })),
                );
                clear();
              }}
            />
          )}
        </div>
        {comments.open && (
          <ObjectCommentsPanel
            entityDefinitionId={object.id}
            focusThreadId={comments.link?.threadId ?? null}
            focusCommentId={comments.link?.commentId ?? null}
            onClose={comments.close}
          />
        )}
      </div>
      {creating && (
        <NewRecordDialog
          entityDefinitionId={object.id}
          onClose={() => setCreating(false)}
          onCreated={() => (kanban ? kanban.board.refresh() : table.current?.refresh())}
        />
      )}
      {attributeDialog && (
        <AttributeDialog
          workspace={workspace}
          object={object as unknown as EntityDefinition}
          objects={objects as unknown as EntityDefinition[]}
          mode={attributeDialog}
          isOpen
          onOpenChange={(open) => !open && setAttributeDialog(null)}
        />
      )}
    </>
  );
}

function HeaderActions({ object, presence }: { object: PageObject; presence: ViewPresence }) {
  const { href } = useWorkspace();
  const router = useRouter();
  const users = usePresenceUsers(presence);
  const comments = useObjectCommentsPanel();
  const access = useEntityAccess(object.id);
  return (
    <div className={s.headerActions}>
      {access.isReadOnly && <ReadOnlyBadge what={object.pluralNoun.toLowerCase()} />}
      {users.length > 0 && (
        <span data-testid="view-presence">
          <AvatarGroup
            size={20}
            max={4}
            items={users.map((u) => ({ id: u.userId, name: u.name, seed: u.userId, kind: 'member' as const }))}
          />
        </span>
      )}
      <SharePopover kind="object" resourceId={object.id} />
      <span className={s.divider} />
      <span className={s.headerGroup}>
        <IconButton
          icon="comment"
          aria-label="Comments"
          tooltip="Comments"
          isActive={comments.open}
          onPress={comments.toggle}
          data-testid="object-comments-button"
        />
        <IconButton icon="help" aria-label="Help" tooltip="Open help drawer" />
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Show menu" />
          <Menu
            aria-label="Object menu"
            placement="bottom end"
            width={220}
            onAction={(key) => {
              if (key === 'settings')
                void router.navigate({ href: href(`settings/data/objects/${object.apiSlug}/general`) });
              if (key === 'attributes')
                void router.navigate({ href: href(`settings/data/objects/${object.apiSlug}/attributes`) });
            }}
          >
            <MenuItem id="settings" icon="settings">
              Object settings
            </MenuItem>
            <MenuItem id="attributes" icon="columns">
              Manage attributes
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="notifications" icon="notifications" isDisabled>
              Notifications
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </span>
      <AskButton />
    </div>
  );
}

function ToolbarSkeleton() {
  return (
    <>
      <div className={s.viewBar}>
        <div className={s.toolbarSkeleton}>
          <Skeleton width={150} height={28} />
          <Skeleton width={130} height={28} />
        </div>
      </div>
      <div className={s.filterBar}>
        <div className={s.toolbarSkeleton}>
          <Skeleton width={64} height={28} />
          <Skeleton width={64} height={28} />
        </div>
      </div>
    </>
  );
}
