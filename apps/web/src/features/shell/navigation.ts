// Main navigation (B sidebar.md §4) and the in-workspace pages that slice 1 renders as placeholders inside the shell
// (route paths mirror Attio's route tree, 00-inventory/routes.md).
import type { IconName } from '@agentic-crm/ui';

export interface NavEntry {
  id: string;
  label: string;
  icon: IconName;
  /** Path below `/<workspaceSlug>/`. */
  path: string;
  /** Tooltip description and its shortcut (shortcuts.md §2). */
  tooltip?: string;
  shortcut?: string;
}

export const mainNav: NavEntry[] = [
  { id: 'home', label: 'Home', icon: 'home', path: 'home', tooltip: 'Go to home page', shortcut: 'g h' },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', path: 'tasks', tooltip: 'Go to tasks page', shortcut: 'g t' },
  { id: 'notes', label: 'Notes', icon: 'notes', path: 'notes', tooltip: 'Go to all notes page', shortcut: 'g n' },
  {
    id: 'emails',
    label: 'Emails',
    icon: 'emails',
    path: 'emails',
    tooltip: 'Go to email drafts page',
    shortcut: 'g e',
  },
  { id: 'calls', label: 'Calls', icon: 'meeting', path: 'calls' },
  { id: 'reports', label: 'Reports', icon: 'reports', path: 'reports', tooltip: 'Go to reports page', shortcut: 'g d' },
  { id: 'sequences', label: 'Sequences', icon: 'sequences', path: 'automations/sequences' },
  { id: 'workflows', label: 'Workflows', icon: 'workflows', path: 'automations/workflows' },
];

export interface PlaceholderPage {
  /** Route path below `/<workspaceSlug>/`; a trailing `/$` adds a splat child. */
  path: string;
  title: string;
  icon: IconName;
  /** Which later slice brings the page (shown in the placeholder). */
  slice: string;
  splat?: boolean;
}

export const placeholderPages: PlaceholderPage[] = [
  {
    path: 'automations/sequences',
    title: 'Sequences',
    icon: 'sequences',
    slice: 'Sequences arrive in a later slice.',
    splat: true,
  },
  {
    path: 'automations/workflows',
    title: 'Workflows',
    icon: 'workflows',
    slice: 'Workflows arrive in a later slice.',
    splat: true,
  },
];

/** Standard objects live at `/<api_slug>` (sidebar.md §7). */
export const standardObjectSlugs = ['companies', 'people', 'deals', 'users', 'workspaces'] as const;
