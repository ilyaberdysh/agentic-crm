// "All comments" panels (BACKLOG 3.16; E README §2.8; B README §2.7):
//   RecordCommentsPanel({recordRef})  E3 — a record's (or list entry's) threads, 320 px, with the top-level composer
//   ObjectCommentsPanel(...)          the view-level panel ("‹ All comments ×"): every thread of the object
// Header filter: "Show resolved comments" / "Only my threads" (blue dot while active). Cards open the thread view
// ("‹ Comments": root with actions, "N replies" divider, replies, "Reply..." composer). A focused thread (comment deep
// link) opens directly and is highlighted.
import type { CommentTarget, CommentTargetInput, ListThreadsInput } from '@agentic-crm/contracts';
import { AvatarGroup, IconButton, Menu, MenuItem, MenuTrigger, Spinner } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useMembers } from '../attributes/data/queries';
import { RecordChip } from '../attributes/ui/primitives';
import { actorName } from '../notes/actors';
import { useWorkspaceRef } from '../notes/data';
import type { RecordRef } from '../overlays/model';
import { SidePanel } from '../overlays/SidePanel';
import { CommentItem, ResolvedLabel } from './CommentParts';
import { Composer } from './Composer';
import * as s from './comments.css';
import { postComment, type ThreadSummary, useThread, useThreads } from './data';

export const COMMENTS_PANEL_WIDTH = 320;

interface PanelFilters {
  includeResolved: boolean;
  onlyMine: boolean;
}

function FilterButton({ filters, onChange }: { filters: PanelFilters; onChange: (f: PanelFilters) => void }) {
  const active = filters.includeResolved || filters.onlyMine;
  return (
    <span className={s.filterWrap}>
      <MenuTrigger>
        <IconButton icon="filter" aria-label="Filter comments" tooltip="Filter comments" size={28} />
        <Menu
          aria-label="Filter comments"
          placement="bottom end"
          width={240}
          selectionMode="multiple"
          selectedKeys={[...(filters.includeResolved ? ['resolved'] : []), ...(filters.onlyMine ? ['mine'] : [])]}
          onSelectionChange={(keys) => {
            const set = keys as Set<string>;
            onChange({ includeResolved: set.has('resolved'), onlyMine: set.has('mine') });
          }}
        >
          <MenuItem id="resolved">Show resolved comments</MenuItem>
          <MenuItem id="mine">Only my threads</MenuItem>
        </Menu>
      </MenuTrigger>
      {active && <span className={s.filterDot} aria-hidden="true" data-testid="comments-filter-dot" />}
    </span>
  );
}

function ThreadCard({
  thread,
  focused,
  onOpen,
  showSubject,
  subjectOf,
}: {
  thread: ThreadSummary;
  focused: boolean;
  onOpen: () => void;
  showSubject: boolean;
  subjectOf?: (target: CommentTarget) => ReactNode;
}) {
  const members = useMembers();
  const resolved = thread.root.resolvedAt !== null;
  return (
    <div
      className={s.card}
      data-focused={focused || undefined}
      data-testid="thread-card"
      data-thread-id={thread.threadId}
      data-resolved={resolved || undefined}
    >
      {showSubject && subjectOf && (
        <div className={s.subject} style={{ padding: '0 0 6px' }}>
          {subjectOf(thread.root.target)}
        </div>
      )}
      {showSubject && !subjectOf && thread.root.target.kind === 'record' && (
        <div className={s.subject} style={{ padding: '0 0 6px' }}>
          Comment on
          <RecordChip
            entityDefinitionId={thread.root.target.entityDefinitionId}
            entityInstanceId={thread.root.target.entityInstanceId}
          />
        </div>
      )}
      <ResolvedLabel comment={thread.root} />
      <div className={resolved ? s.resolved : undefined}>
        <CommentItem comment={thread.root} isRoot onReply={onOpen} threadLine={thread.replyCount > 0}>
          {thread.replyCount > 0 && (
            <AriaButton className={s.replies} onPress={onOpen} aria-label="View thread" data-testid="thread-replies">
              <span className={s.facepile}>
                <AvatarGroup
                  size={16}
                  max={3}
                  items={thread.replierMemberIds.map((id) => ({
                    id,
                    name: actorName({ type: 'workspace-member', id }, members),
                    seed: id,
                    kind: 'member' as const,
                  }))}
                />
              </span>
              {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
            </AriaButton>
          )}
        </CommentItem>
      </div>
    </div>
  );
}

function ThreadView({ threadId, focusedCommentId }: { threadId: string; focusedCommentId?: string | null }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const thread = useThread(threadId);
  if (thread.isPending) {
    return (
      <div className={s.empty}>
        <Spinner size={16} />
      </div>
    );
  }
  if (thread.isError || !thread.data) {
    return (
      <div className={s.empty} data-testid="comment-not-found">
        <span className={s.emptyTitle}>We can't find that comment</span>
        <span className={s.emptyText}>The comment or its parent record may have been deleted.</span>
      </div>
    );
  }
  const { root, replies } = thread.data;
  return (
    <div className={s.scroll} data-testid="thread-view" data-thread-id={threadId}>
      <div className={s.threadRoot}>
        <ResolvedLabel comment={root} />
        <CommentItem
          comment={root}
          isRoot
          onReply={() =>
            document
              .querySelector<HTMLTextAreaElement>('[data-testid="thread-view"] [data-testid="comment-input"]')
              ?.focus()
          }
        />
      </div>
      {replies.length > 0 && (
        <div className={s.divider} data-testid="thread-divider">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
      )}
      {replies.map((r) => (
        <div
          key={r.id}
          className={s.reply}
          data-focused={r.id === focusedCommentId || undefined}
          style={
            r.id === focusedCommentId
              ? { borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--ar-color-stroke-accent)' }
              : undefined
          }
        >
          <CommentItem comment={r} isRoot={false} />
        </div>
      ))}
      <Composer
        placeholder="Reply..."
        submitLabel="Reply"
        flat
        autoFocus
        onSubmit={async (value) =>
          Boolean(await postComment(client, ws, { threadId, content: { ...value, styles: [] } }))
        }
      />
    </div>
  );
}

interface PanelProps {
  /** Threads of one record / list entry, or of a whole object (view-level panel). */
  scope: { target: CommentTargetInput } | { entityDefinitionId: string; snapshotId?: string | null };
  focusThreadId?: string | null;
  focusCommentId?: string | null;
  onClose?: () => void;
  title?: string;
  /** Record panels open with the composer focused (record-comments-panel.png shows its accent border). */
  autoFocusComposer?: boolean;
  /** List pages: "‹ All comments" back to the list-level panel (entry-scoped mode, C2 README §2.4). */
  onBack?: () => void;
  /** Line under the header ("Add comment on <record>"). */
  subject?: ReactNode;
  /** Object panels: show the leading ‹ (default true). */
  showBack?: boolean;
  /** List pages: the card's subject line (an entry's parent record) instead of "Comment on <record>". */
  subjectOf?: (target: CommentTarget) => ReactNode;
}

function CommentsPanelBody({
  scope,
  focusThreadId,
  focusCommentId,
  onClose,
  title = 'All comments',
  autoFocusComposer = false,
  onBack,
  subject,
  showBack = true,
  subjectOf,
}: PanelProps) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [filters, setFilters] = useState<PanelFilters>({ includeResolved: false, onlyMine: false });
  const [openThread, setOpenThread] = useState<string | null>(focusThreadId ?? null);
  useEffect(() => setOpenThread(focusThreadId ?? null), [focusThreadId]);
  const isObject = 'entityDefinitionId' in scope;
  const params: ListThreadsInput = {
    ...(isObject
      ? { entityDefinitionId: scope.entityDefinitionId, ...(scope.snapshotId ? { snapshotId: scope.snapshotId } : {}) }
      : { target: scope.target }),
    includeResolved: filters.includeResolved,
    onlyMine: filters.onlyMine,
  };
  const threads = useThreads(params);
  // Open threads first, resolved ones after (comments-resolved-filter.png), each newest first.
  const list = [...(threads.data?.threads ?? [])].sort(
    (a, b) => Number(a.root.resolvedAt !== null) - Number(b.root.resolvedAt !== null),
  );
  const focusedSummary = openThread ? list.find((t) => t.threadId === openThread) : undefined;

  if (openThread) {
    return (
      <div className={s.panel} data-testid="comments-panel" data-view="thread">
        <div className={s.header}>
          <IconButton icon="chevronLeft" aria-label="Back" size={20} onPress={() => setOpenThread(null)} />
          <span className={s.headerTitle}>{isObject ? title : 'Comments'}</span>
          {onClose && <IconButton icon="close" aria-label="Close" size={28} onPress={onClose} />}
        </div>
        {isObject && focusedSummary?.root.target.kind === 'record' && (
          <div className={s.subject} data-testid="comment-subject">
            Comment on
            <RecordChip
              entityDefinitionId={focusedSummary.root.target.entityDefinitionId}
              entityInstanceId={focusedSummary.root.target.entityInstanceId}
            />
          </div>
        )}
        <ThreadView threadId={openThread} focusedCommentId={focusCommentId} />
      </div>
    );
  }

  return (
    <div className={s.panel} data-testid="comments-panel" data-view="list">
      <div className={s.header}>
        {isObject && onClose && showBack && (
          <IconButton icon="chevronLeft" aria-label="Back" size={20} onPress={onClose} />
        )}
        {onBack && <IconButton icon="chevronLeft" aria-label="Back" size={20} onPress={onBack} />}
        <span className={s.headerTitle}>{title}</span>
        <FilterButton filters={filters} onChange={setFilters} />
        {(isObject || onBack) && onClose && <IconButton icon="close" aria-label="Close" size={28} onPress={onClose} />}
      </div>
      {subject && (
        <div className={s.subject} data-testid="comment-subject">
          {subject}
        </div>
      )}
      <div className={s.scroll}>
        {threads.isPending ? (
          <div className={s.empty}>
            <Spinner size={16} />
          </div>
        ) : list.length === 0 && isObject ? (
          <div className={s.empty}>
            <span className={s.emptyTitle}>You don't have any comments</span>
            <span className={s.emptyText}>When someone comments on a record it will appear here</span>
          </div>
        ) : (
          list.map((t) => (
            <ThreadCard
              key={t.threadId}
              thread={t}
              focused={t.threadId === focusThreadId}
              showSubject={isObject}
              subjectOf={subjectOf}
              onOpen={() => setOpenThread(t.threadId)}
            />
          ))
        )}
        {!isObject && (
          <Composer
            autoFocus={autoFocusComposer}
            placeholder="Add comment..."
            submitLabel="Comment"
            onSubmit={async (value) =>
              Boolean(await postComment(client, ws, { target: scope.target, content: { ...value, styles: [] } }))
            }
          />
        )}
      </div>
    </div>
  );
}

/** E3: a record's comments, 320 px wide, full height (D-comments-sidebar / record-comments-panel.png). */
export function RecordCommentsPanel({
  recordRef,
  focusThreadId,
  focusCommentId,
  kind = 'record',
  onBack,
  onClose,
  subject,
}: {
  recordRef: RecordRef;
  focusThreadId?: string | null;
  focusCommentId?: string | null;
  /** List-entry comments use the list definition + entry id. */
  kind?: 'record' | 'list-entry';
  /** List pages (entry-scoped mode): "‹ All comments", ×, "Add comment on <record>". */
  onBack?: () => void;
  onClose?: () => void;
  subject?: ReactNode;
}) {
  return (
    <SidePanel width={COMMENTS_PANEL_WIDTH} label="All comments" testId="record-comments-panel">
      <CommentsPanelBody
        scope={{
          target: {
            kind,
            entityDefinitionId: recordRef.entityDefinitionId,
            entityInstanceId: recordRef.entityInstanceId,
          },
        }}
        focusThreadId={focusThreadId}
        focusCommentId={focusCommentId}
        autoFocusComposer={!focusThreadId}
        onBack={onBack}
        onClose={onClose}
        subject={subject}
      />
    </SidePanel>
  );
}

/** The view-level "All comments" panel of an object page (E README §2.8 "Other comment surfaces"). */
export function ObjectCommentsPanel({
  entityDefinitionId,
  snapshotId,
  focusThreadId,
  focusCommentId,
  onClose,
  title,
  showBack,
  subjectOf,
}: {
  entityDefinitionId: string;
  /** List pages: only threads on the rows of the view's snapshot (C2 README §2.4). */
  snapshotId?: string | null;
  focusThreadId?: string | null;
  focusCommentId?: string | null;
  onClose: () => void;
  /** List pages say "Comments" with no ‹ (C2 README §2.4). */
  title?: string;
  showBack?: boolean;
  subjectOf?: (target: CommentTarget) => ReactNode;
}) {
  return (
    <SidePanel width={COMMENTS_PANEL_WIDTH} label={title ?? 'All comments'} testId="object-comments-panel">
      <CommentsPanelBody
        scope={{ entityDefinitionId, snapshotId }}
        focusThreadId={focusThreadId}
        focusCommentId={focusCommentId}
        onClose={onClose}
        title={title}
        showBack={showBack}
        subjectOf={subjectOf}
      />
    </SidePanel>
  );
}
