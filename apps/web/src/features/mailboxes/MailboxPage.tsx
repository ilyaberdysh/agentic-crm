// Settings → Email and calendar accounts → one mailbox (F settings §2): header ("‹ Back", 56 px provider tile, address
// + Default badge, subtitle, ⋮ Actions → Reconnect (Google) / Remove mailbox) and the tabs General · Mailbox-only blocklist · Signatures.
// `advanced` is flag-gated (F settings §2.4) and renders General.
import { Button, EmptyState, Icon, IconButton, Menu, MenuItem, MenuTrigger, Tag, toast } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Link } from 'react-aria-components';
import { findSettingsEntry } from '../settings/settingsNav';
import { ContentSpinner } from '../shell/AppShell';
import { useWorkspace } from '../shell/workspaceContext';
import { useConnectGoogle, useMailbox } from './data';
import { UserBlockGlyph } from './glyphs';
import { MAILBOX_TABS, type VisibleMailboxTab, visibleTab } from './labels';
import { MailboxBlocklistTab } from './MailboxBlocklistTab';
import { MailboxGeneralTab } from './MailboxGeneralTab';
import * as s from './page.css';
import { LearnMore, ProviderTile, type RouteTab, RouteTabs, SettingsFrame } from './parts';
import { RemoveMailboxDialog } from './RemoveMailboxDialog';
import { SignaturesTab } from './SignaturesTab';

export const MAILBOX_TAB_IDS = ['general', 'blocklist', 'signatures', 'advanced'] as const;
export type MailboxTabId = (typeof MAILBOX_TAB_IDS)[number];

const TAB_ICONS: Record<VisibleMailboxTab, RouteTab<VisibleMailboxTab>['icon']> = {
  general: 'settings',
  blocklist: UserBlockGlyph,
  signatures: 'edit',
};

const TABS: RouteTab<VisibleMailboxTab>[] = MAILBOX_TABS.map((t) => ({ ...t, icon: TAB_ICONS[t.id] }));

export function MailboxPage({ mailboxId, tab }: { mailboxId: string; tab: MailboxTabId }) {
  const entry = findSettingsEntry('email-and-calendar-accounts');
  const { href, workspace } = useWorkspace();
  const navigate = useNavigate();
  const mailbox = useMailbox(mailboxId);
  const reconnect = useConnectGoogle();
  const [removing, setRemoving] = useState(false);
  const accountsHref = href('settings/email-and-calendar-accounts');
  const selected = visibleTab(tab);
  if (!entry) return null;

  const crumbs = [
    { label: entry.label, icon: entry.icon, href: accountsHref },
    ...(mailbox.data ? [{ label: mailbox.data.emailAddress }] : []),
  ];

  if (mailbox.isPending) {
    return (
      <SettingsFrame crumbs={crumbs} title={entry.label}>
        <ContentSpinner />
      </SettingsFrame>
    );
  }

  if (mailbox.isError || !mailbox.data) {
    return (
      <SettingsFrame crumbs={crumbs} title={entry.label}>
        <EmptyState
          icon="emails"
          title="Mailbox not found"
          description="This mailbox does not exist or is not yours to manage."
          style={{ padding: '72px 24px' }}
          actions={
            <Button variant="secondary" size={28} onPress={() => void navigate({ href: accountsHref })}>
              Back to accounts
            </Button>
          }
        />
      </SettingsFrame>
    );
  }

  const data = mailbox.data;
  const isOwner = data.memberId === workspace.membership.id;

  return (
    <SettingsFrame crumbs={crumbs} title={data.emailAddress}>
      <Link href={accountsHref} className={s.backLink} aria-label="Back to accounts">
        <Icon icon="chevronLeft" size={14} />
        Back
      </Link>
      <div className={s.mailboxHeader} data-testid="mailbox-header">
        <ProviderTile provider={data.providerType} size={56} />
        <div className={s.mailboxHeaderText}>
          <div className={s.mailboxTitleRow}>
            <h1 className={s.mailboxTitle}>{data.emailAddress}</h1>
            {data.isDefault && <Tag color="blue">Default</Tag>}
          </div>
          <p className={s.pageDescription}>
            Update your account permissions and settings. <LearnMore />
          </p>
        </div>
        {isOwner && (
          <MenuTrigger>
            <IconButton icon="moreVertical" aria-label="Actions" variant="secondary" size={32} />
            <Menu
              aria-label="Mailbox actions"
              placement="bottom end"
              width={200}
              onAction={(key) => {
                if (key === 'reconnect') {
                  reconnect.mutate(data.id, {
                    onError: (error) => toast.error({ title: 'Could not reconnect', description: error.message }),
                  });
                } else if (key === 'remove') setRemoving(true);
              }}
            >
              {data.providerType === 'gmail' && !data.archivedAt ? (
                <MenuItem id="reconnect" icon="refresh">
                  Reconnect
                </MenuItem>
              ) : null}
              <MenuItem id="remove" icon="delete" variant="danger">
                Remove mailbox
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </div>
      <RouteTabs
        label="Mailbox settings"
        tabs={TABS}
        selected={selected}
        onSelect={(id) => void navigate({ href: `${accountsHref}/${data.id}/${id}` })}
        plainPanel={selected !== 'general'}
      >
        {selected === 'general' && <MailboxGeneralTab mailbox={data} isOwner={isOwner} />}
        {selected === 'blocklist' && <MailboxBlocklistTab mailbox={data} />}
        {selected === 'signatures' && <SignaturesTab mailbox={data} isOwner={isOwner} />}
      </RouteTabs>
      <RemoveMailboxDialog
        mailbox={data}
        isOpen={removing}
        onOpenChange={setRemoving}
        onRemoved={() => void navigate({ href: accountsHref })}
      />
    </SettingsFrame>
  );
}
