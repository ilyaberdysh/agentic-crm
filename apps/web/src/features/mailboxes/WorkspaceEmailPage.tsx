// Settings → Email and calendar (workspace; F settings §4): "Email and calendar — Workspace-wide email and calendar
// settings" with the tabs Email visibility | Record creation. Admins change the settings; other members (the nav
// hides the page from them) see it read-only.
import { useNavigate } from '@tanstack/react-router';
import { findSettingsEntry } from '../settings/settingsNav';
import { useWorkspace } from '../shell/workspaceContext';
import { EmailVisibilityTab } from './EmailVisibilityTab';
import { MailGlobeGlyph, UserCogGlyph } from './glyphs';
import * as s from './page.css';
import { type RouteTab, RouteTabs, SettingsFrame } from './parts';
import { RecordCreationTab } from './RecordCreationTab';

export const WORKSPACE_EMAIL_TAB_IDS = ['email-visibility', 'record-creation'] as const;
export type WorkspaceEmailTabId = (typeof WORKSPACE_EMAIL_TAB_IDS)[number];

const TABS: RouteTab<WorkspaceEmailTabId>[] = [
  { id: 'email-visibility', label: 'Email visibility', icon: MailGlobeGlyph },
  { id: 'record-creation', label: 'Record creation', icon: UserCogGlyph },
];

export function WorkspaceEmailPage({ tab }: { tab: WorkspaceEmailTabId }) {
  const entry = findSettingsEntry('workspace-email-and-calendar');
  const { href, isAdmin } = useWorkspace();
  const navigate = useNavigate();
  if (!entry) return null;

  return (
    <SettingsFrame crumbs={[{ label: entry.label, icon: entry.icon }]} title={entry.label}>
      <h1 className={s.pageTitle}>{entry.label}</h1>
      <p className={s.pageDescription}>Workspace-wide email and calendar settings</p>
      <RouteTabs
        label="Email and calendar"
        tabs={TABS}
        selected={tab}
        onSelect={(id) => void navigate({ href: href(`settings/workspace-email-and-calendar/${id}`) })}
      >
        {tab === 'email-visibility' ? (
          <EmailVisibilityTab isAdmin={isAdmin} />
        ) : (
          <RecordCreationTab isAdmin={isAdmin} />
        )}
      </RouteTabs>
    </SettingsFrame>
  );
}
