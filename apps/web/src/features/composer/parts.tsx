// Pieces of the composer window: header, sender field, attachment cards, the mass-send info strip and the
// signature / template footer buttons (F composer §2.1, §2.3, §2.6a, §2.7).
import { Avatar, Icon, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { brand } from '../../lib/brand';
import { type Mailbox, type MailboxSignature, useMailboxes, useSignatures } from '../mailboxes/data';
import { WindowControls } from '../overlays';
import { formatBytes } from '../record/files/upload';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './composer.css';
import { fileTypeTile } from './model';
import type { DraftAttachment, UploadRow } from './session';

// ---- header --------------------------------------------------------------------------------------------------------

export function ComposerHeader({
  id,
  mode,
  canPin,
  onClose,
  children,
  back,
}: {
  id: string;
  mode: 'modal' | 'floating';
  canPin: boolean;
  onClose: () => void;
  /** The breadcrumb after the icon (default "Compose email"). */
  children?: ReactNode;
  /** Review and template views: ‹ back. */
  back?: { label: string; onPress: () => void };
}) {
  return (
    <div className={s.header} data-testid="composer-header">
      {back && (
        <IconButton icon="chevronLeft" aria-label={back.label} tooltip={back.label} size={28} onPress={back.onPress} />
      )}
      <div className={s.headerStart}>
        {children ?? (
          <span className={s.crumb}>
            <Icon icon="compose" size={16} />
            Compose email
          </span>
        )}
      </div>
      <WindowControls kind="composer" id={id} mode={mode} canPin={canPin} onClose={onClose} />
    </div>
  );
}

// ---- sender ---------------------------------------------------------------------------------------------------------

/** "From": the member's sending identity; a picker when they have several mailboxes (F composer §2.3). */
export function SenderField({
  senderMailboxId,
  onChange,
}: {
  senderMailboxId: string | null;
  onChange: (mailboxId: string) => void;
}) {
  const { me, href } = useWorkspace();
  const mailboxes = useMailboxes();
  const sendable = (mailboxes.data ?? []).filter((m) => m.mailDeliveryEnabled && m.status !== 'archived');
  const current = sendable.find((m) => m.id === senderMailboxId) ?? sendable[0] ?? null;
  const name = me.user.name || current?.emailAddress || '';
  const identity = (
    <>
      <Avatar name={name || '?'} seed={me.user.id} size={16} kind="member" />
      <span data-testid="composer-sender-name">{name}</span>
    </>
  );
  if (mailboxes.isSuccess && !current) {
    return (
      <span className={s.noSender} data-testid="composer-no-sender">
        No email account connected.{' '}
        <a className={s.noSenderLink} href={href('settings/email-and-calendar-accounts')}>
          Connect an account
        </a>
      </span>
    );
  }
  if (sendable.length < 2) {
    return (
      <span className={s.senderChip} data-interactive="false" title={current?.emailAddress}>
        {identity}
      </span>
    );
  }
  return (
    <MenuTrigger>
      <AriaButton className={s.senderPicker} aria-label="Send from" data-testid="composer-sender-picker">
        {identity}
        <Icon icon="chevronDown" size={14} />
      </AriaButton>
      <Menu
        aria-label="Send from"
        placement="bottom start"
        width={280}
        selectionMode="single"
        selectedKeys={current ? [current.id] : []}
        onAction={(key) => onChange(String(key))}
      >
        {sendable.map((m: Mailbox) => (
          <MenuItem key={m.id} id={m.id} description={m.isDefault ? 'Default mailbox' : undefined}>
            {m.emailAddress}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

// ---- attachments ---------------------------------------------------------------------------------------------------

export function AttachmentCards({
  attachments,
  uploads,
  onRemove,
}: {
  attachments: readonly DraftAttachment[];
  uploads: readonly UploadRow[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0 && uploads.length === 0) return null;
  return (
    <div className={s.attachments} data-testid="composer-attachments">
      {attachments.map((a) => (
        <div key={a.id} className={s.attachment} data-testid="composer-attachment">
          <span className={s.attachmentTile}>{fileTypeTile(a.name)}</span>
          <span className={s.attachmentText}>
            <span className={s.attachmentName} title={a.name}>
              {a.name}
            </span>
            <span className={s.attachmentMeta}>{formatBytes(a.size)}</span>
          </span>
          <IconButton icon="delete" aria-label="Remove" tooltip="Remove" size={28} onPress={() => onRemove(a.id)} />
        </div>
      ))}
      {uploads.map((u) => (
        <div key={u.id} className={s.attachment} data-testid="composer-upload">
          <span className={s.attachmentTile}>{fileTypeTile(u.name)}</span>
          <span className={s.attachmentText}>
            <span className={s.attachmentName}>{u.name}</span>
            <span className={s.attachmentMeta}>Uploading…</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ---- signature ----------------------------------------------------------------------------------------------------

/** Footer pen button: a menu of the sender mailbox's signatures, "No signature" and "Manage signatures". */
export function SignatureMenu({
  mailboxId,
  currentId,
  onPick,
}: {
  mailboxId: string | null;
  currentId: string | null;
  onPick: (signature: MailboxSignature | null) => void;
}) {
  const navigate = useNavigate();
  const { href } = useWorkspace();
  const signatures = useSignatures(mailboxId);
  const list = signatures.data ?? [];
  return (
    <MenuTrigger>
      <IconButton
        icon="edit"
        aria-label="Email signature"
        tooltip="Email signature"
        size={28}
        data-testid="composer-signature"
      />
      <Menu
        aria-label="Email signature"
        placement="top start"
        width={240}
        onAction={(key) => {
          if (key === 'manage') {
            void navigate({
              href: href(
                mailboxId
                  ? `settings/email-and-calendar-accounts/${mailboxId}/signatures`
                  : 'settings/email-and-calendar-accounts',
              ),
            });
          } else if (key === 'none') onPick(null);
          else onPick(list.find((sig) => sig.id === key) ?? null);
        }}
      >
        {list.length > 0 && (
          <MenuItem id="none" icon={currentId === null ? 'check' : undefined}>
            No signature
          </MenuItem>
        )}
        {list.map((sig) => (
          <MenuItem key={sig.id} id={sig.id} icon={currentId === sig.id ? 'check' : undefined} textValue={sig.title}>
            {sig.title}
          </MenuItem>
        ))}
        {list.length > 0 && <MenuSeparator />}
        <MenuItem id="manage" icon="settings">
          Manage signatures
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}

// ---- strips -------------------------------------------------------------------------------------------------------

/** Mass mode: "Delivery time will depend on items in your outbox. Learn more" · View outbox ›. */
export function DeliveryStrip({ onViewOutbox }: { onViewOutbox: () => void }) {
  return (
    <div className={s.infoStrip} data-testid="composer-delivery-strip">
      <Icon icon="info" size={16} />
      <span className={s.infoStripText}>
        Delivery time will depend on items in your outbox.{' '}
        <a className={s.infoLink} href={brand.supportUrl} target="_blank" rel="noreferrer">
          Learn more
        </a>
      </span>
      <button type="button" className={s.infoAction} onClick={onViewOutbox}>
        View outbox
        <Icon icon="chevronRight" size={12} />
      </button>
    </div>
  );
}
