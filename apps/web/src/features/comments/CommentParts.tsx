// One comment as cards and the thread view show it: author avatar (16) + bold name, relative
// time ("(via API)"), body with mentions, B / I / links and auto-linked URLs, reaction chips (own reaction pressed;
// tooltip "‹Name› reacted with 👍"; clicking your own removes it) and the hover action pill: Reply in thread · Pick
// emoji · Resolve / Re-open (thread roots) · ⋮ Copy link to comment / Delete comment | Delete thread (author only).
import { AlertDialog, Avatar, IconButton, Menu, MenuItem, MenuTrigger, Tooltip, toast } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useMembers } from '../attributes/data/queries';
import { actorName, copyToClipboard } from '../notes/actors';
import { useWorkspaceRef } from '../notes/data';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './comments.css';
import { type Comment, deleteComment, resolveThread, toggleReaction } from './data';
import { emojiName } from './emoji/data';
import { EmojiPickerPopover } from './emoji/EmojiPicker';
import { timeAgo } from './timeAgo';

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

function autolink(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={`${keyBase}:${m.index}`} className={s.link} href={m[0]} target="_blank" rel="noreferrer noopener">
        {m[0]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Body text with mention tokens, bold / italic / link ranges and auto-linked URLs. */
export function CommentText({ content }: { content: Comment['content'] }) {
  const { text, mentions, styles } = content;
  // Boundaries where any range starts or ends.
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...mentions, ...styles]) {
    cuts.add(r.start);
    cuts.add(r.start + r.length);
  }
  const points = [...cuts].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const parts: ReactNode[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    const piece = text.slice(from, to);
    const inside = <T extends { start: number; length: number }>(r: T) => r.start <= from && r.start + r.length >= to;
    const mention = mentions.find(inside);
    const active = styles.filter(inside);
    let node: ReactNode = mention ? (
      <span className={s.mention} data-mention={mention.kind}>
        {piece}
      </span>
    ) : active.some((x) => x.style === 'link') ? (
      piece
    ) : (
      autolink(piece, String(from))
    );
    for (const st of active) {
      if (st.style === 'bold') node = <strong className={s.bold}>{node}</strong>;
      if (st.style === 'italic') node = <em className={s.italic}>{node}</em>;
      if (st.style === 'link' && st.href)
        node = (
          <a className={s.link} href={st.href} target="_blank" rel="noreferrer noopener">
            {node}
          </a>
        );
    }
    parts.push(<span key={from}>{node}</span>);
  }
  return <>{parts}</>;
}

function ReactionChips({ comment, onAdd }: { comment: Comment; onAdd: (anchor: HTMLElement) => void }) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const members = useMembers();
  const addRef = useRef<HTMLButtonElement>(null);
  if (comment.reactions.length === 0) return null;
  return (
    <div className={s.reactions} data-testid="reactions">
      {comment.reactions.map((r) => {
        const names = r.memberIds.map((id) => actorName({ type: 'workspace-member', id }, members));
        const who = r.myReactionId
          ? ['You', ...names.filter((_, i) => r.memberIds[i] !== workspace.membership.id)]
          : names;
        return (
          <Tooltip key={r.emoji} content={`${who.join(', ')} reacted with ${r.emoji}`}>
            <AriaButton
              className={s.reaction}
              aria-pressed={r.myReactionId !== null}
              aria-label={`${emojiName(r.emoji) ?? r.emoji} ${r.count}`}
              onPress={() => void toggleReaction(client, ws, comment, r.emoji, workspace.membership.id)}
              data-testid="reaction-chip"
            >
              <span>{r.emoji}</span>
              {r.count}
            </AriaButton>
          </Tooltip>
        );
      })}
      <IconButton
        ref={addRef}
        icon="addReaction"
        aria-label="Add reaction"
        size={20}
        onPress={() => addRef.current && onAdd(addRef.current)}
      />
    </div>
  );
}

export interface CommentItemProps {
  comment: Comment;
  /** Thread roots get Resolve / Re-open and "Delete thread". */
  isRoot: boolean;
  onReply?: () => void;
  /** Actions always visible (the root in the thread view). */
  staticActions?: boolean;
  /** Draws the thread line from the avatar down to `children` (cards with replies). */
  threadLine?: boolean;
  children?: ReactNode;
}

export function CommentItem({
  comment,
  isRoot,
  onReply,
  staticActions = false,
  threadLine = false,
  children,
}: CommentItemProps) {
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const { workspace } = useWorkspace();
  const members = useMembers();
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const emojiRef = useRef<HTMLButtonElement>(null);
  const isMine = comment.author.type === 'workspace-member' && comment.author.id === workspace.membership.id;
  const resolved = comment.resolvedAt !== null;
  const name = actorName(comment.author, members);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = emojiAnchor;

  return (
    <div
      className={`${s.comment} ${threadLine ? s.threadLine : ''}`}
      data-testid="comment"
      data-comment-id={comment.id}
    >
      <div className={s.commentHeader}>
        <Avatar name={name} seed={comment.author.id ?? name} size={16} kind="member" />
        <span className={s.author}>{name}</span>
        <span className={s.time} title={new Date(comment.createdAt).toLocaleString()}>
          {timeAgo(comment.createdAt)}
          {comment.viaApi ? ' (via API)' : ''}
        </span>
        <div
          className={`${s.actions} ${staticActions ? s.actionsStatic : ''}`}
          data-open={menuOpen || emojiAnchor !== null || undefined}
          data-testid="comment-actions"
        >
          {onReply && !staticActions && (
            <IconButton
              icon="reply"
              aria-label="Reply in thread"
              tooltip="Reply in thread"
              size={28}
              onPress={onReply}
            />
          )}
          <IconButton
            ref={emojiRef}
            icon="addReaction"
            aria-label="Pick emoji"
            tooltip="Pick emoji"
            size={28}
            onPress={() => setEmojiAnchor(emojiRef.current)}
          />
          {isRoot && (
            <IconButton
              icon={resolved ? 'refresh' : 'checkCircle'}
              aria-label={resolved ? 'Re-open comment' : 'Resolve comment'}
              tooltip={resolved ? 'Re-open comment' : 'Resolve comment'}
              size={28}
              onPress={() => void resolveThread(client, ws, comment, !resolved)}
            />
          )}
          <MenuTrigger onOpenChange={setMenuOpen}>
            <IconButton icon="moreVertical" aria-label="More actions" tooltip="More actions" size={28} />
            <Menu
              aria-label="Comment actions"
              placement="bottom end"
              width={220}
              onAction={(key) => {
                if (key === 'copy')
                  void copyToClipboard(
                    `${window.location.origin}/${ws.slug}/comment/${comment.id}`,
                    'Comment URL copied to clipboard',
                  );
                if (key === 'delete') setConfirm(true);
              }}
            >
              <MenuItem id="copy" icon="link">
                Copy link to comment
              </MenuItem>
              {isMine ? (
                <MenuItem id="delete" icon="delete" variant="danger">
                  {isRoot ? 'Delete thread' : 'Delete comment'}
                </MenuItem>
              ) : null}
            </Menu>
          </MenuTrigger>
        </div>
      </div>
      <div className={s.body}>
        <CommentText content={comment.content} />
      </div>
      <ReactionChips comment={comment} onAdd={(el) => setEmojiAnchor(el)} />
      {children}
      {emojiAnchor && (
        <EmojiPickerPopover
          triggerRef={anchorRef}
          onClose={() => setEmojiAnchor(null)}
          onPick={(emoji) => void toggleReaction(client, ws, comment, emoji, workspace.membership.id)}
        />
      )}
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={isRoot ? 'Delete thread' : 'Delete comment'}
        description={
          isRoot
            ? "You're about to delete this comment and its replies. Once deleted they cannot be restored."
            : "You're about to delete this comment. Once deleted it cannot be restored."
        }
        confirmLabel="Delete"
        onConfirm={() => void deleteComment(client, ws, comment)}
      />
    </div>
  );
}

export function ResolvedLabel({ comment }: { comment: Comment }) {
  const { workspace } = useWorkspace();
  const members = useMembers();
  if (!comment.resolvedAt) return null;
  const byMe = comment.resolvedBy?.type === 'workspace-member' && comment.resolvedBy.id === workspace.membership.id;
  return (
    <div className={s.resolvedLabel} data-testid="resolved-label">
      Resolved by {byMe ? 'you' : actorName(comment.resolvedBy, members)}
    </div>
  );
}
