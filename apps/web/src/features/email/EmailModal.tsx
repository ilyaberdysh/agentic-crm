// The "View email" modal (BACKLOG 7.03; F README §2.3; acceptance 3), opened at `?modal=email&id=<messageId>` (a row of
// the Emails tab or a shared link): the subject with "Share", then every message of the thread (the opened one
// expanded) with the sender, "to …" details, Reply / Reply all / Forward, the timestamp and the body — the original
// HTML in a sandboxed iframe without scripts. Below full access the body is replaced by a restricted card and the
// subject by "Private subject line"; protected or unknown emails show "Email content unavailable".
import type { EmailParticipant } from '@agentic-crm/contracts';
import { Avatar, Button, DialogHeader, Icon, IconButton, Popover, Skeleton, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { httpStatusOf } from '../../data/trpc';
import { closeWindow, type WindowContentProps } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { AccessPanel } from './AccessPanel';
import { respondTo } from './compose';
import { type EmailMessage, useEmailMessage, useEmailThread } from './data';
import { ForwardGlyph, ReplyAllGlyph } from './glyphs';
import * as m from './modal.css';
import {
  buildEmailSrcdoc,
  canReplyAll,
  distinctParticipants,
  formatFileSize,
  formatMessageTimestamp,
  PRIVATE_SUBJECT,
  participantName,
  ROLE_LABEL,
  recipientsLabel,
  senderOf,
  textToHtml,
} from './model';
import { useTimeZone } from './time';

export const DOWNLOADS_LATER = 'Downloads arrive with the Gmail connector (slice 7b)';
export const ACCESS_REQUESTS_LATER = 'Access requests arrive in a later slice';

export function EmailModal({ id }: WindowContentProps) {
  const first = useEmailMessage(id);
  const threadId = first.data?.threadId;
  const thread = useEmailThread(threadId);
  const close = () => closeWindow('email', id);

  let content: React.ReactNode;
  if (first.isPending || (first.data && thread.isPending)) {
    content = <LoadingBody />;
  } else if (first.isError || thread.isError) {
    const status = httpStatusOf(first.error ?? thread.error);
    content = <UnavailableBody missing={status === 404} />;
  } else if (first.data && thread.data) {
    content = (
      <ThreadBody
        openedId={id}
        threadId={thread.data.threadId}
        subject={thread.data.subject}
        messages={thread.data.messages}
      />
    );
  }
  return (
    <div className={m.root} data-testid="email-modal" data-message-id={id} data-access={first.data?.access}>
      <DialogHeader title="View email" icon={<Icon icon="emails" size={16} />} onClose={close} />
      <div className={m.scroll}>{content}</div>
    </div>
  );
}

function LoadingBody() {
  return (
    <div className={m.skeletons} data-testid="email-loading">
      <Skeleton width={320} height={20} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Skeleton shape="circle" width={28} height={28} />
        <Skeleton width={180} height={12} />
      </div>
      <Skeleton width="90%" height={12} />
      <Skeleton width="70%" height={12} />
    </div>
  );
}

function UnavailableBody({ missing }: { missing: boolean }) {
  return (
    <div className={m.state} data-testid="email-unavailable">
      <Icon icon="lock" size={24} className={m.restrictedIcon} />
      <div className={m.restrictedTitle}>Email content unavailable</div>
      <div className={m.restrictedText} style={{ marginBottom: 0 }}>
        {missing
          ? "This email doesn't exist, or you don't have access to it."
          : 'The email could not be loaded. Try again in a moment.'}
      </div>
    </div>
  );
}

function ThreadBody({
  openedId,
  threadId,
  subject,
  messages,
}: {
  openedId: string;
  threadId: string;
  subject: string | null;
  messages: EmailMessage[];
}) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set([openedId]));
  const canShare = messages.some((msg) => msg.isOwn);
  const link = `${window.location.origin}/${workspace.slug}/home?modal=email&id=${encodeURIComponent(openedId)}`;
  const openedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    openedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  const toggle = (messageId: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  return (
    <>
      <div className={m.subjectBlock}>
        <h2 className={m.subject} data-private={subject === null || undefined} data-testid="email-subject">
          {subject ?? PRIVATE_SUBJECT}
        </h2>
        {canShare && (
          <Popover
            aria-label="Email Access"
            placement="bottom end"
            padding={0}
            trigger={
              <Button variant="ghost" size={28} data-testid="email-share">
                Share
              </Button>
            }
          >
            <AccessPanel title="Email Access" resource={{ type: 'thread', threadId }} showYou link={link} />
          </Popover>
        )}
      </div>
      {messages.map((msg) => (
        <div
          key={msg.id}
          ref={msg.id === openedId ? openedRef : undefined}
          data-testid="email-message"
          data-message-id={msg.id}
        >
          {open.has(msg.id) ? (
            <MessageBlock message={msg} />
          ) : (
            <CollapsedMessage message={msg} onOpen={() => toggle(msg.id)} />
          )}
        </div>
      ))}
    </>
  );
}

function SenderAvatar({ sender }: { sender: EmailParticipant | null }) {
  return (
    <Avatar
      name={sender ? participantName(sender) : '?'}
      kind={sender?.memberId ? 'member' : 'person'}
      size={28}
      seed={sender?.emailAddress}
    />
  );
}

function CollapsedMessage({ message, onOpen }: { message: EmailMessage; onOpen: () => void }) {
  const timeZone = useTimeZone();
  const sender = senderOf(message.participants);
  return (
    <button type="button" className={m.collapsed} onClick={onOpen} data-testid="email-message-collapsed">
      <SenderAvatar sender={sender} />
      <span className={m.collapsedName}>{sender ? participantName(sender) : 'Unknown sender'}</span>
      <span className={m.collapsedSnippet}>{message.snippet ?? ''}</span>
      <span className={m.timestamp}>{formatMessageTimestamp(message.sentAt, timeZone)}</span>
    </button>
  );
}

function MessageBlock({ message }: { message: EmailMessage }) {
  const { workspace } = useWorkspace();
  const timeZone = useTimeZone();
  const [showDetails, setShowDetails] = useState(false);
  const sender = senderOf(message.participants);
  const meId = workspace.membership.id;
  const restricted = message.access !== 'full-access';
  const replyAll = canReplyAll(message.participants, meId);
  const respond = (kind: 'reply' | 'reply-all' | 'forward') => respondTo(message, kind, meId);
  return (
    <div className={m.message} data-testid="email-message-open" data-access={message.access}>
      <div className={m.messageHead}>
        <SenderAvatar sender={sender} />
        <div className={m.headText}>
          <span className={m.senderName} data-testid="email-sender">
            {sender ? participantName(sender) : 'Unknown sender'}
          </span>
          <button
            type="button"
            className={m.toLine}
            aria-expanded={showDetails}
            onClick={() => setShowDetails((v) => !v)}
            data-testid="email-to-toggle"
          >
            <span className={m.toLabel}>{recipientsLabel(message.participants, meId)}</span>
            <Icon icon="chevronDown" size={12} />
          </button>
        </div>
        <div className={m.headRight}>
          {!restricted && (
            <>
              <IconButton icon="reply" aria-label="Reply" tooltip="Reply" onPress={() => respond('reply')} />
              {replyAll && (
                <IconButton
                  icon={ReplyAllGlyph}
                  aria-label="Reply all"
                  tooltip="Reply all"
                  onPress={() => respond('reply-all')}
                />
              )}
              <IconButton
                icon={ForwardGlyph}
                aria-label="Forward"
                tooltip="Forward"
                onPress={() => respond('forward')}
              />
            </>
          )}
          <span className={m.timestamp} data-testid="email-timestamp">
            {formatMessageTimestamp(message.sentAt, timeZone)}
          </span>
        </div>
      </div>
      {showDetails && <ParticipantDetails participants={message.participants} />}
      {restricted ? (
        <RestrictedCard access={message.access} />
      ) : (
        <>
          <div className={m.bodyWrap}>
            <EmailBody html={message.bodyHtml} text={message.bodyText} />
          </div>
          {message.attachments && message.attachments.length > 0 && (
            <div className={m.attachments} data-testid="email-attachments">
              {message.attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={m.attachment}
                  title={a.name}
                  onClick={() => toast({ title: DOWNLOADS_LATER })}
                >
                  <Icon icon="attach" size={14} />
                  <span className={m.attachmentName}>{a.name}</span>
                  <span className={m.attachmentSize}>{formatFileSize(a.size)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ParticipantDetails({ participants }: { participants: readonly EmailParticipant[] }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const list = distinctParticipants(participants);
  const rows = (['from', 'to', 'cc', 'bcc'] as const).flatMap((role) => {
    const group = list.filter((p) => p.role === role);
    return group.length > 0 ? [{ role, group }] : [];
  });
  return (
    <div className={m.details} data-testid="email-participants">
      {rows.map(({ role, group }) => (
        <div key={role} style={{ display: 'contents' }}>
          <span className={m.detailLabel}>{ROLE_LABEL[role]}</span>
          <span className={m.detailValue}>
            {group.map((p, i) => (
              <span key={p.emailAddress}>
                {i > 0 && ', '}
                {p.personId ? (
                  <a
                    className={m.detailLink}
                    href={href(`person/${p.personId}`)}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                      e.preventDefault();
                      void navigate({ href: href(`person/${p.personId}`) });
                    }}
                  >
                    {participantName(p)}
                  </a>
                ) : (
                  participantName(p)
                )}
                {p.name ? ` <${p.emailAddress}>` : ''}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function RestrictedCard({ access }: { access: EmailMessage['access'] }) {
  return (
    <div className={m.restricted} data-testid="email-restricted" data-access={access}>
      <Icon icon="lock" size={24} className={m.restrictedIcon} />
      <div className={m.restrictedTitle}>No access to this email content</div>
      <div className={m.restrictedText}>
        {access === 'metadata-only'
          ? 'You can see who took part and when, but not the subject or what was said.'
          : 'You can see the subject and who took part, but not what was said.'}
      </div>
      <Button variant="secondary" size={28} icon="lock" onPress={() => toast({ title: ACCESS_REQUESTS_LATER })}>
        Request access
      </Button>
    </div>
  );
}

/**
 * The body as the original HTML in a sandboxed iframe (`allow-same-origin` only, so the parent can measure it; no
 * scripts, forms or top navigation — links open in a new tab through `allow-popups`). Without HTML the plain text
 * is shown the same way. The frame grows to its content.
 */
export function EmailBody({ html, text }: { html: string | null; text: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(48);
  const srcDoc = useMemo(() => buildEmailSrcdoc(html ?? textToHtml(text ?? '')), [html, text]);
  const cleanup = useRef<() => void>(() => undefined);
  useEffect(() => () => cleanup.current(), []);

  const attach = () => {
    cleanup.current();
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const measure = () => {
      if (!doc.body) return;
      setHeight(Math.max(24, Math.ceil(doc.body.getBoundingClientRect().height)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(doc.body);
    const images = [...doc.images];
    for (const img of images) img.addEventListener('load', measure);
    cleanup.current = () => {
      observer.disconnect();
      for (const img of images) img.removeEventListener('load', measure);
    };
  };

  return (
    <iframe
      ref={ref}
      title="Email body"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className={m.frame}
      style={{ height }}
      onLoad={attach}
      data-testid="email-body-frame"
    />
  );
}
