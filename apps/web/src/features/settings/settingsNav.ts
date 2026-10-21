// Settings navigation groups, order and paths:
// tree) and searchable subsections ("theme" → Appearance › Theme).
import type { IconName } from '@agentic-crm/ui';

export interface SettingsSubsection {
  id: string;
  title: string;
  /** Tab pages: the sub-route below the entry's path this subsection lives on (instead of a `#id` anchor). */
  to?: string;
}

export interface SettingsEntry {
  /** Path below `/<workspaceSlug>/settings/`. */
  path: string;
  label: string;
  icon: IconName;
  /** Page heading description (settings page template). */
  description: string;
  subsections?: SettingsSubsection[];
  adminOnly?: boolean;
  /** Shown to non-admins only (the read-only Members page replaces Members and teams for them). */
  nonAdminOnly?: boolean;
}

export interface SettingsGroup {
  id: string;
  /** Untitled groups are separated by a rule. */
  title: string | null;
  entries: SettingsEntry[];
}

export const settingsGroups: SettingsGroup[] = [
  {
    id: 'personal',
    title: 'Personal',
    entries: [
      {
        path: 'account',
        label: 'Profile',
        icon: 'user',
        description: 'Manage your personal details.',
        subsections: [
          { id: 'personal-details', title: 'Personal details' },
          { id: 'email', title: 'Primary email address' },
          { id: 'time-preferences', title: 'Time preferences' },
        ],
      },
      {
        path: 'appearance',
        label: 'Appearance',
        icon: 'theme',
        description: 'Customize the look and feel of your platform.',
        subsections: [
          { id: 'theme', title: 'Theme' },
          { id: 'accent-color', title: 'Accent color' },
        ],
      },
      {
        path: 'email-and-calendar-accounts',
        label: 'Email and calendar accounts',
        icon: 'calendarAdd',
        description: 'Connect your email and calendar accounts.',
      },
      {
        path: 'call-intelligence',
        label: 'Call intelligence',
        icon: 'meeting',
        description: 'Manage your call intelligence settings.',
        subsections: [{ id: 'default-template', title: 'Default insights template' }],
      },
      {
        path: 'storage-accounts',
        label: 'Storage accounts',
        icon: 'cloud',
        description: 'Connect your file storage accounts.',
      },
      { path: 'referrals', label: 'Refer and earn', icon: 'plans', description: 'Invite other teams.' },
      {
        path: 'notifications',
        label: 'Notifications',
        icon: 'notifications',
        description: 'Customize your notification settings to stay informed without being overwhelmed.',
        subsections: [
          { id: 'daily-digest', title: 'Daily digest' },
          { id: 'collaboration', title: 'Collaboration notifications' },
        ],
      },
      {
        path: 'ask-agentic',
        label: 'Ask AI',
        icon: 'chat',
        description: 'Manage your Ask AI settings and prompts.',
        subsections: [
          { id: 'general', title: 'General', to: 'general' },
          { id: 'prompts', title: 'Prompts', to: 'prompts' },
        ],
      },
      {
        path: 'app-connections',
        label: 'App connections',
        icon: 'integrations',
        description: 'Manage the apps connected to your account.',
      },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    entries: [
      {
        path: 'workspace',
        label: 'General',
        icon: 'settings',
        description: 'Manage your workspace settings.',
        adminOnly: true,
        subsections: [
          { id: 'workspace-details', title: 'Workspace details' },
          { id: 'danger-zone', title: 'Danger zone' },
        ],
      },
      {
        path: 'members-and-teams',
        label: 'Members and teams',
        icon: 'people',
        description: 'Manage workspace members and teams, set access levels, and invite new users.',
        adminOnly: true,
        subsections: [
          { id: 'members', title: 'Members', to: 'members' },
          { id: 'teams', title: 'Teams', to: 'teams' },
        ],
      },
      {
        path: 'members-read-only',
        label: 'Members',
        icon: 'people',
        description: 'View workspace members and access levels.',
        nonAdminOnly: true,
      },
      {
        path: 'workspace-ask-agentic',
        label: 'Ask AI',
        icon: 'chat',
        description: 'Manage Ask AI settings for your workspace.',
        adminOnly: true,
        subsections: [
          { id: 'usage', title: 'Usage', to: 'usage' },
          { id: 'custom-context', title: 'Custom context', to: 'custom-context' },
        ],
      },
      {
        path: 'call-recorder',
        label: 'Call recorder',
        icon: 'recording',
        description: 'Configure the call recorder.',
        adminOnly: true,
      },
      { path: 'plan', label: 'Plans', icon: 'billing', description: 'Your plan and features.', adminOnly: true },
      {
        path: 'billing',
        label: 'Billing',
        icon: 'attrCurrency',
        description: 'Invoices and payment details.',
        adminOnly: true,
      },
      {
        path: 'developers',
        label: 'Developers',
        icon: 'developers',
        description: 'Access tokens and webhooks for the API.',
        adminOnly: true,
        subsections: [
          { id: 'access-tokens', title: 'Access tokens', to: 'access-tokens' },
          { id: 'webhooks', title: 'Webhooks', to: 'webhooks' },
        ],
      },
      {
        path: 'support-request',
        label: 'Support requests',
        icon: 'support',
        description: 'Your conversations with support.',
        adminOnly: true,
      },
      {
        path: 'migration',
        label: 'Migrate CRM',
        icon: 'migrate',
        description: 'Bring your data from another CRM.',
        adminOnly: true,
      },
      { path: 'apps', label: 'Apps', icon: 'apps', description: 'See and manage all apps.' },
    ],
  },
  {
    id: 'admin',
    title: null,
    entries: [
      {
        path: 'security',
        label: 'Security',
        icon: 'security',
        description: 'Manage your security measures and make sure your account is secure',
        adminOnly: true,
        subsections: [{ id: 'export-security', title: 'Export security' }],
      },
      {
        path: 'workspace-email-and-calendar',
        label: 'Email and calendar',
        icon: 'emails',
        description: 'Email visibility and record creation.',
        adminOnly: true,
      },
      {
        path: 'workspace-admin-access-grants',
        label: 'Expert access grants',
        icon: 'key',
        description: 'Grant experts temporary access to your workspace.',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    entries: [
      {
        path: 'data/objects',
        label: 'Objects',
        icon: 'object',
        description: 'Modify and add objects in your workspace',
      },
      { path: 'data/lists', label: 'Lists', icon: 'list', description: 'Manage the lists in your workspace.' },
      {
        path: 'data/data-connectors',
        label: 'Data connectors',
        icon: 'database',
        description: 'Sync data from external sources.',
        adminOnly: true,
      },
      {
        path: 'data/import-history',
        label: 'Import history',
        icon: 'history',
        description: 'Imports into this workspace.',
      },
    ],
  },
  {
    id: 'automation',
    title: null,
    entries: [
      {
        path: 'reports/dashboards',
        label: 'Dashboards',
        icon: 'dashboards',
        description: 'Manage dashboards and their access.',
      },
      {
        path: 'automations/sequences',
        label: 'Sequences',
        icon: 'sequences',
        description: 'Manage sequences and their access.',
      },
      {
        path: 'automations/workflows',
        label: 'Workflows',
        icon: 'workflows',
        description: 'Manage workflows and their access.',
      },
    ],
  },
];

export const settingsEntries: SettingsEntry[] = settingsGroups.flatMap((g) => g.entries);

export function findSettingsEntry(path: string): SettingsEntry | undefined {
  return settingsEntries.find((e) => e.path === path);
}

export interface SettingsSearchResult {
  group: SettingsGroup;
  entries: Array<{ entry: SettingsEntry; subsections: SettingsSubsection[] }>;
}

/** Filters the nav: entries whose label matches, plus entries with matching subsections (listed as children). */
export function searchSettings(groups: SettingsGroup[], query: string): SettingsSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q)
    return groups.map((group) => ({ group, entries: group.entries.map((entry) => ({ entry, subsections: [] })) }));
  const out: SettingsSearchResult[] = [];
  for (const group of groups) {
    const entries: SettingsSearchResult['entries'] = [];
    for (const entry of group.entries) {
      const subsections = (entry.subsections ?? []).filter((s) => s.title.toLowerCase().includes(q));
      if (entry.label.toLowerCase().includes(q) || subsections.length > 0) entries.push({ entry, subsections });
    }
    if (entries.length > 0) out.push({ group, entries });
  }
  return out;
}
