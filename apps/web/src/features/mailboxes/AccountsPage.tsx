// Settings → Email and calendar accounts (F settings; BACKLOG 7.08): "Connected accounts" with one row per mailbox
// (provider tile, address, Default badge, what syncs, status chip, ⋮ Options → Manage / Make default / Reconnect
// (Google) / Remove mailbox) and the connect buttons below. "Connect Google Account"  leaves for Google's
// consent through the server's start URL and comes back here with `?google=…` (shown as a toast); without a Google
// OAuth client on the server the button is disabled with "Google is not configured on this server". "Connect test
// account" (dev builds and e2e) connects a test-connector mailbox. The forwarding address and the "Sent with"
// watermark sections are deferred (BACKLOG 7 defer list).
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Menu,
  MenuItem,
  MenuTrigger,
  Tag,
  toast,
} from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Link } from 'react-aria-components';
import { brand } from '../../lib/brand';
import { findSettingsEntry } from '../settings/settingsNav';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './accounts.css';
import { ConnectTestDialog } from './ConnectTestDialog';
import { type Mailbox, useConnectGoogle, useMailboxes, useMailboxProviders, useUpdateMailbox } from './data';
import { googleReturnMessage, needsReconnection, statusLabel, statusTone, syncedLabel } from './labels';
import * as page from './page.css';
import { LearnMore, ProviderTile, Section, SettingsFrame } from './parts';
import { RemoveMailboxDialog } from './RemoveMailboxDialog';

const SUBTITLE = 'Manage and sync your email and calendar accounts to stay organized.';

export function AccountsPage() {
  const entry = findSettingsEntry('email-and-calendar-accounts');
  const mailboxes = useMailboxes();
  const providers = useMailboxProviders();
  const connectGoogle = useConnectGoogle();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);
  const googleUnavailable = providers.data?.google.configured === false;

  // Back from Google's consent: report the outcome once and drop it from the URL.
  useEffect(() => {
    const message = googleReturnMessage(window.location.search);
    if (!message) return;
    const { title, description } = message;
    if (message.tone === 'success') toast.success({ title, ...(description ? { description } : {}) });
    else toast.error({ title, ...(description ? { description } : {}), durationMs: 8000 });
    void navigate({ href: window.location.pathname, replace: true });
  }, [navigate]);

  if (!entry) return null;
  const rows = mailboxes.data ?? [];

  return (
    <SettingsFrame crumbs={[{ label: entry.label, icon: entry.icon }]} title={entry.label}>
      <h1 className={page.pageTitle}>{entry.label}</h1>
      <p className={page.pageDescription}>
        {SUBTITLE} <LearnMore />
      </p>
      <div className={s.rule} />
      <div className={s.sections}>
        <Section
          id="connected-accounts"
          title="Connected accounts"
          description={
            brand.privacyUrl && (
              <>
                We take your privacy very seriously. Read our{' '}
                <a className={s.privacy} href={brand.privacyUrl} target="_blank" rel="noreferrer">
                  Privacy Policy
                </a>
              </>
            )
          }
        >
          {mailboxes.isPending ? (
            <LoadingState />
          ) : mailboxes.isError ? (
            <ErrorState
              message="Failed to load your accounts"
              actions={
                <Button variant="secondary" size={28} onPress={() => void mailboxes.refetch()}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <EmptyState
              className={s.empty}
              icon="emails"
              title="No connected accounts"
              description="Connect your email and calendar to see conversations and meetings on your records."
            />
          ) : (
            <ul className={s.list} data-testid="accounts-list" aria-label="Connected accounts">
              {rows.map((mailbox) => (
                <AccountRow key={mailbox.id} mailbox={mailbox} />
              ))}
            </ul>
          )}
          <div className={s.connectRow}>
            <Button
              variant="secondary"
              size={28}
              icon="add"
              isDisabled={googleUnavailable}
              isPending={connectGoogle.isPending}
              onPress={() =>
                connectGoogle.mutate(undefined, {
                  onError: (error) =>
                    toast.error({ title: 'Could not connect a Google account', description: error.message }),
                })
              }
            >
              Connect Google Account
            </Button>
            {googleUnavailable && (
              <span className={s.connectHint} data-testid="google-not-configured">
                Google is not configured on this server
              </span>
            )}
            {import.meta.env.DEV && (
              <Button variant="secondary" size={28} icon="add" onPress={() => setConnectOpen(true)}>
                Connect test account
              </Button>
            )}
          </div>
        </Section>
      </div>
      {import.meta.env.DEV && <ConnectTestDialog isOpen={connectOpen} onOpenChange={setConnectOpen} />}
    </SettingsFrame>
  );
}

function AccountRow({ mailbox }: { mailbox: Mailbox }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const update = useUpdateMailbox();
  const reconnect = useConnectGoogle();
  const [removing, setRemoving] = useState(false);
  const manageHref = href(`settings/email-and-calendar-accounts/${mailbox.id}/general`);
  const needsReconnect = needsReconnection(mailbox);
  const startReconnect = () =>
    reconnect.mutate(mailbox.id, {
      onError: (error) => toast.error({ title: 'Could not reconnect', description: error.message }),
    });

  return (
    <li className={s.row} data-testid="account-row" data-mailbox-id={mailbox.id}>
      <ProviderTile provider={mailbox.providerType} />
      <div className={s.rowText}>
        <div className={s.rowTitle}>
          <Link href={manageHref} className={s.rowLink}>
            {mailbox.emailAddress}
          </Link>
          {mailbox.isDefault && <Tag color="blue">Default</Tag>}
        </div>
        {needsReconnect ? (
          <div className={s.rowSubError} data-testid="account-reconnect-reason">
            {mailbox.syncError ?? 'Reconnect this account to resume syncing.'}
          </div>
        ) : (
          <div className={s.rowSub}>{syncedLabel(mailbox)}</div>
        )}
      </div>
      <div className={s.rowActions}>
        {needsReconnect && (
          <Button variant="secondary" size={20} isPending={reconnect.isPending} onPress={startReconnect}>
            Reconnect
          </Button>
        )}
        <Tag color={statusTone(mailbox.status)}>{statusLabel(mailbox.status)}</Tag>
        <MenuTrigger>
          <IconButton icon="moreVertical" aria-label="Options" size={28} />
          <Menu
            aria-label={`Options for ${mailbox.emailAddress}`}
            placement="bottom end"
            width={200}
            onAction={(key) => {
              if (key === 'manage') void navigate({ href: manageHref });
              else if (key === 'default') {
                update.mutate(
                  { mailboxId: mailbox.id, isDefault: true },
                  {
                    onSuccess: () => toast.success(`${mailbox.emailAddress} is now your default mailbox`),
                    onError: (error) =>
                      toast.error({ title: 'Could not change the default', description: error.message }),
                  },
                );
              } else if (key === 'reconnect') startReconnect();
              else if (key === 'remove') setRemoving(true);
            }}
          >
            <MenuItem id="manage" icon="settings">
              Manage
            </MenuItem>
            {!mailbox.isDefault && mailbox.status !== 'archived' ? (
              <MenuItem id="default" icon="emails">
                Make default
              </MenuItem>
            ) : null}
            {mailbox.providerType === 'gmail' && mailbox.status !== 'archived' ? (
              <MenuItem id="reconnect" icon="refresh">
                Reconnect
              </MenuItem>
            ) : null}
            <MenuItem id="remove" icon="delete" variant="danger">
              Remove mailbox
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <RemoveMailboxDialog mailbox={mailbox} isOpen={removing} onOpenChange={setRemoving} />
    </li>
  );
}
