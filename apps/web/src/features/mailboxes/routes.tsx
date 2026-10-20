// Routes under `/$workspaceSlug/settings` for email and calendar (F README §1, settings.md):
//   email-and-calendar-accounts                         personal accounts list
//   email-and-calendar-accounts/$mailboxId[/$tab]       one mailbox (general · blocklist · signatures; advanced → general)
//   workspace-email-and-calendar[/$tab]                 workspace email and calendar (email-visibility · record-creation)
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { AccountsPage } from './AccountsPage';
import { MAILBOX_TAB_IDS, MailboxPage, type MailboxTabId } from './MailboxPage';
import { WORKSPACE_EMAIL_TAB_IDS, WorkspaceEmailPage, type WorkspaceEmailTabId } from './WorkspaceEmailPage';

/** Settings paths these routes replace the placeholder pages of. */
export const MAILBOX_SETTINGS_PATHS: readonly string[] = [
  'email-and-calendar-accounts',
  'workspace-email-and-calendar',
];

/** Pass the settings route (`getParentRoute`). */
export function mailboxSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const accounts = createRoute({ getParentRoute, path: 'email-and-calendar-accounts', component: AccountsPage });

  const mailboxIndex = createRoute({
    getParentRoute,
    path: 'email-and-calendar-accounts/$mailboxId',
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/general`, replace: true });
    },
  });

  const mailboxTab = createRoute({
    getParentRoute,
    path: 'email-and-calendar-accounts/$mailboxId/$tab',
    beforeLoad: ({ params, location }) => {
      const { tab } = params as { tab: string };
      if (!(MAILBOX_TAB_IDS as readonly string[]).includes(tab)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/general`, replace: true });
      }
    },
    component: function MailboxTabRoute() {
      const { mailboxId, tab } = mailboxTab.useParams() as { mailboxId: string; tab: MailboxTabId };
      return <MailboxPage mailboxId={mailboxId} tab={tab} />;
    },
  });

  const workspaceIndex = createRoute({
    getParentRoute,
    path: 'workspace-email-and-calendar',
    beforeLoad: ({ location }) => {
      throw redirect({ href: `${location.pathname.replace(/\/$/, '')}/email-visibility`, replace: true });
    },
  });

  const workspaceTab = createRoute({
    getParentRoute,
    path: 'workspace-email-and-calendar/$tab',
    beforeLoad: ({ params, location }) => {
      const { tab } = params as { tab: string };
      if (!(WORKSPACE_EMAIL_TAB_IDS as readonly string[]).includes(tab)) {
        const base = location.pathname.slice(0, location.pathname.lastIndexOf('/'));
        throw redirect({ href: `${base}/email-visibility`, replace: true });
      }
    },
    component: function WorkspaceEmailTabRoute() {
      const { tab } = workspaceTab.useParams() as { tab: WorkspaceEmailTabId };
      return <WorkspaceEmailPage tab={tab} />;
    },
  });

  return [accounts, mailboxIndex, mailboxTab, workspaceIndex, workspaceTab];
}
