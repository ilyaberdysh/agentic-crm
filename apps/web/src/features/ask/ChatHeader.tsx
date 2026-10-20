// Header pieces shared by the full page and the side panel (ask-agentic §3, §9): the editable title, "View history"
// (search, rename, delete) and the "More actions" menu (Open in full page, Copy chat ID, Ask AI settings, Delete, and
// the thread's credit usage).
import {
  AlertDialog,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  Popover,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { errorEnvelopeOf } from '../../data/trpc';
import { formatRelativeTime } from '../attributes/format/formatValue';
import { useWorkspaceRef } from '../notes/data';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './chat.css';
import {
  type AiThreadSummary,
  deleteThread,
  formatCredits,
  renameThread,
  threadTitle,
  useThread,
  useThreads,
} from './data';

// ---- title ----------------------------------------------------------------------------------------------------------------------

export function ChatTitle({ threadId }: { threadId: string | null }) {
  const ws = useWorkspaceRef();
  const thread = useThread(threadId);
  const title = threadTitle(thread.data?.thread);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  if (!threadId || !thread.data) {
    return (
      <span className={s.title} style={{ cursor: 'default' }} data-testid="ask-title">
        {thread.isPending && threadId ? <Skeleton width={120} height={12} /> : 'Untitled chat'}
      </span>
    );
  }
  const save = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === title || next === '') return;
    void renameThread(ws, threadId, next).catch((e) =>
      toast.error({ title: 'Failed to rename chat', description: errorEnvelopeOf(e).message }),
    );
  };
  if (editing) {
    return (
      <input
        ref={input}
        className={s.titleInput}
        value={draft}
        aria-label="Chat title"
        data-testid="ask-title-input"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={s.title}
      title={title}
      data-testid="ask-title"
      onClick={() => {
        setDraft(title);
        setEditing(true);
      }}
    >
      {title}
    </button>
  );
}

// ---- history ----------------------------------------------------------------------------------------------------------------------

function HistoryRow({
  thread,
  active,
  onOpen,
  onDeleted,
}: {
  thread: AiThreadSummary;
  active: boolean;
  onOpen: () => void;
  onDeleted: (id: string) => void;
}) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(threadTitle(thread));
  const [confirm, setConfirm] = useState(false);
  const save = () => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== threadTitle(thread)) void renameThread(ws, thread.id, next);
  };
  if (renaming) {
    return (
      <input
        className={s.titleInput}
        style={{ margin: '2px 8px', width: 'calc(100% - 16px)' }}
        value={draft}
        aria-label="Rename chat"
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setRenaming(false);
          }
        }}
      />
    );
  }
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center' }} data-testid="ask-history-row">
        <button type="button" className={s.historyRow} data-active={active || undefined} onClick={onOpen}>
          <Icon icon="chat" size={16} />
          <span className={s.historyTitle}>{threadTitle(thread)}</span>
          <span className={s.historyTime}>{formatRelativeTime(thread.updatedAt)}</span>
        </button>
        <MenuTrigger>
          <IconButton icon="more" size={20} aria-label="Chat actions" />
          <Menu aria-label="Chat actions" width={160} placement="bottom end">
            <MenuItem id="rename" icon="edit" onAction={() => setRenaming(true)}>
              Rename
            </MenuItem>
            <MenuItem id="delete" icon="delete" variant="danger" onAction={() => setConfirm(true)}>
              Delete
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Are you sure you want to delete the chat?"
        description="This will permanently remove the selected chat. This action can't be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          void deleteThread(client, ws, thread.id)
            .then(() => onDeleted(thread.id))
            .catch((e) => toast.error({ title: 'Failed to delete chat', description: errorEnvelopeOf(e).message }));
        }}
      />
    </>
  );
}

export function HistoryButton({
  currentThreadId,
  onOpen,
  onDeleted,
}: {
  currentThreadId: string | null;
  onOpen: (threadId: string) => void;
  onDeleted: (threadId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const threads = useThreads({ query: query || undefined, sort: 'updated' });
  const list = threads.data?.threads ?? [];
  return (
    <Popover
      placement="bottom end"
      padding={0}
      aria-label="Chat history"
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      trigger={
        <IconButton
          icon="history"
          size={28}
          aria-label="View history"
          tooltip="View history"
          data-testid="ask-history"
        />
      }
    >
      {({ close }) => (
        <div className={s.history} data-testid="ask-history-popover">
          <label className={s.historySearch}>
            <Icon icon="search" size={16} />
            <input
              className={s.historyInput}
              placeholder="Search history..."
              aria-label="Search history"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </label>
          {list.length === 0 ? (
            <div className={s.historyEmpty}>No threads found</div>
          ) : (
            <div className={s.historyList}>
              {list.map((t) => (
                <HistoryRow
                  key={t.id}
                  thread={t}
                  active={t.id === currentThreadId}
                  onOpen={() => {
                    close();
                    onOpen(t.id);
                  }}
                  onDeleted={onDeleted}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

// ---- more actions -----------------------------------------------------------------------------------------------------------------

export function ChatMenu({
  threadId,
  onOpenFullPage,
  onDeleted,
}: {
  threadId: string | null;
  /** Panel only. */
  onOpenFullPage?: () => void;
  onDeleted: (threadId: string) => void;
}) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const thread = useThread(threadId);
  const [confirm, setConfirm] = useState(false);
  const credits = thread.data?.thread.creditCost;
  return (
    <>
      <MenuTrigger>
        <IconButton icon="moreVertical" size={28} aria-label="More actions" data-testid="ask-more" />
        <Menu aria-label="More actions" width={220} placement="bottom end">
          <MenuSection>
            {onOpenFullPage && (
              <MenuItem id="full" icon="expand" onAction={onOpenFullPage}>
                Open in full page
              </MenuItem>
            )}
            {threadId && (
              <MenuItem
                id="copy-id"
                icon="copy"
                onAction={() => {
                  void navigator.clipboard
                    .writeText(threadId)
                    .then(() => toast({ title: 'Copied to clipboard!', icon: 'copy' }));
                }}
              >
                Copy chat ID
              </MenuItem>
            )}
            <MenuItem
              id="settings"
              icon="settings"
              onAction={() => void navigate({ href: href('settings/ask-agentic/general') })}
            >
              Ask AI settings
            </MenuItem>
          </MenuSection>
          {threadId && (
            <>
              <MenuSeparator />
              <MenuItem id="delete" icon="delete" variant="danger" onAction={() => setConfirm(true)}>
                Delete
              </MenuItem>
            </>
          )}
          {threadId && typeof credits === 'number' && (
            <>
              <MenuSeparator />
              <MenuItem id="usage" isDisabled trailing={`${formatCredits(credits)} credits`}>
                Chat usage
              </MenuItem>
            </>
          )}
        </Menu>
      </MenuTrigger>
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title="Are you sure you want to delete the chat?"
        description="This will permanently remove the selected chat from this workspace. This action can't be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (!threadId) return;
          void deleteThread(client, ws, threadId)
            .then(() => onDeleted(threadId))
            .catch((e) => toast.error({ title: 'Failed to delete chat', description: errorEnvelopeOf(e).message }));
        }}
      />
    </>
  );
}
