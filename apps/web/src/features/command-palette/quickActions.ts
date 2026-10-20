// The workspace quick-action registry (command-palette.md §3.3): category "Quick Action" unless noted. Visibility 1
// actions form the default set of the empty state; `searchOnly` ones (navigation, themes, easter eggs) appear only
// while the query matches. Ask Agentic, Suggestions, email templates and the support links belong to later slices or
// services this build does not have, so they are not registered.
import type { ObjectSummary } from '../../data/objects';
import { openComposer } from '../composer/open';
import type { PaletteAction } from './contexts';

export type ThemeChoice = 'light' | 'dark' | 'system';

export interface QuickActionEnv {
  isAdmin: boolean;
  /** Objects the member can create records in (one "Add {singular}" action each). */
  objects: readonly ObjectSummary[];
  /** Appearance: the stored preference and what it currently resolves to. */
  theme: { setting: ThemeChoice; resolved: 'light' | 'dark'; set: (theme: ThemeChoice) => void };
  /** Workspace-relative navigation (`tasks`, `settings/account`). */
  navigate: (path: string) => void;
  openCreateTask: () => void;
  openHelpDrawer: () => void;
  openNewRecord: (object: ObjectSummary) => void;
  fireConfetti: () => void;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Icon of an "Add {object}" action. */
function addIcon(object: ObjectSummary): PaletteAction['icon'] {
  if (object.entityType === 'company-record') return 'company';
  if (object.entityType === 'person-record') return 'person';
  return 'object';
}

/** Workspace actions in category order: "Quick Action" first, then "Help". */
export function buildQuickActions(env: QuickActionEnv): { quick: PaletteAction[]; help: PaletteAction[] } {
  const quick: PaletteAction[] = [
    {
      id: 'search-records',
      title: 'Search records',
      icon: 'search',
      gesture: 'Search records',
      hint: '/',
      run: ({ push }) => push({ id: 'search' }),
      keepOpen: true,
    },
    {
      id: 'workspace:create-task',
      title: 'Create task',
      keywords: ['new task', 'todo', 'add task'],
      icon: 'tasks',
      gesture: 'Create',
      hint: 't',
      run: ({ close }) => {
        close();
        env.openCreateTask();
      },
    },
    {
      id: 'workspace:add-note',
      title: 'Create note',
      keywords: ['new note', 'add note', 'write'],
      icon: 'notes',
      gesture: 'Create',
      hint: 'n',
      run: ({ push }) => push({ id: 'choose-record-for-note' }),
      keepOpen: true,
    },
    {
      id: 'workspace:view-upcoming-meetings',
      title: 'View upcoming meetings',
      keywords: ['calendar', 'schedule'],
      icon: 'calendar',
      gesture: 'View',
      run: ({ push }) => push({ id: 'upcoming-meetings' }),
      keepOpen: true,
    },
    {
      id: 'workspace:personal-settings',
      title: 'Open account settings',
      keywords: ['profile', 'preferences', 'account'],
      icon: 'settings',
      gesture: 'Open',
      run: ({ close }) => {
        close();
        env.navigate('settings/account');
      },
    },
    ...env.objects.map<PaletteAction>((object) => ({
      id: `workspace:create-${object.id}`,
      title: `Add ${object.singularNoun}`,
      keywords: [`new ${object.singularNoun}`, `create ${object.singularNoun}`],
      icon: addIcon(object),
      gesture: 'Create',
      run: ({ close }) => {
        close();
        env.openNewRecord(object);
      },
    })),
    {
      id: 'workspace:add-document',
      title: 'Add to list',
      keywords: ['entry', 'new entry'],
      icon: 'listAdd',
      gesture: 'Add',
      hint: 'e',
      run: ({ push }) => push({ id: 'choose-list' }),
      keepOpen: true,
    },
    {
      id: 'workspace:view-note-templates',
      title: 'Note templates',
      keywords: ['template'],
      icon: 'noteTemplate',
      gesture: 'View all',
      run: ({ push }) => push({ id: 'note-templates' }),
      keepOpen: true,
    },
    {
      id: 'workspace:create-email-draft',
      title: 'Compose email',
      keywords: ['email', 'draft'],
      icon: 'emails',
      gesture: 'Compose',
      hint: 'c',
      run: ({ close }) => {
        close();
        openComposer();
      },
    },
    ...(env.isAdmin
      ? [
          {
            id: 'workspace:account-settings',
            title: 'Open workspace settings',
            keywords: ['admin', 'workspace'],
            icon: 'settings',
            gesture: 'Open',
            run: ({ close }) => {
              close();
              env.navigate('settings/workspace');
            },
          } satisfies PaletteAction,
        ]
      : []),
    // Appearance (system-ui §8): only when they would change something; found by search.
    ...(env.theme.setting !== 'system'
      ? [
          {
            id: 'enable-default-theme',
            title: `Use system default theme (${titleCase(env.theme.resolved)})`,
            keywords: ['appearance', 'system', 'theme'],
            icon: 'themeSystem',
            gesture: 'Use theme',
            searchOnly: true,
            run: ({ close }) => {
              close();
              env.theme.set('system');
            },
          } satisfies PaletteAction,
        ]
      : []),
    ...(env.theme.setting !== 'dark'
      ? [
          {
            id: 'enable-dark-theme',
            title: 'Use dark theme',
            keywords: ['appearance', 'night', 'theme'],
            icon: 'themeDark',
            gesture: 'Enable theme',
            searchOnly: true,
            run: ({ close }) => {
              close();
              env.theme.set('dark');
            },
          } satisfies PaletteAction,
        ]
      : []),
    ...(env.theme.setting !== 'light'
      ? [
          {
            id: 'enable-light-theme',
            title: 'Use light theme',
            keywords: ['appearance', 'day', 'theme'],
            icon: 'themeLight',
            gesture: 'Enable theme',
            searchOnly: true,
            run: ({ close }) => {
              close();
              env.theme.set('light');
            },
          } satisfies PaletteAction,
        ]
      : []),
    {
      id: 'confetti',
      title: 'Confetti',
      keywords: ['fireworks', 'cannons', 'celebrate'],
      icon: 'confetti',
      gesture: 'Fire',
      searchOnly: true,
      run: ({ close }) => {
        close();
        env.fireConfetti();
      },
    },
    // Navigation: pages reachable by name (the G sequences' targets), found by search.
    ...NAVIGATION.map<PaletteAction>((page) => ({
      id: `navigate:${page.path}`,
      title: page.title,
      keywords: [`go to ${page.title.toLowerCase()}`, ...(page.keywords ?? [])],
      icon: page.icon,
      gesture: 'Open',
      hint: page.hint,
      searchOnly: true,
      run: ({ close }) => {
        close();
        env.navigate(page.path);
      },
    })),
  ];
  const help: PaletteAction[] = [
    {
      id: 'help:open-drawer',
      title: 'Open help drawer',
      keywords: ['help', 'support', 'shortcuts', 'keyboard'],
      icon: 'help',
      gesture: 'Open',
      hint: '?',
      run: ({ close }) => {
        close();
        env.openHelpDrawer();
      },
    },
  ];
  return { quick, help };
}

const NAVIGATION: { path: string; title: string; icon: PaletteAction['icon']; hint?: string; keywords?: string[] }[] = [
  { path: 'home', title: 'Home', icon: 'home', hint: 'g h' },
  { path: 'tasks', title: 'Tasks', icon: 'tasks', hint: 'g t' },
  { path: 'notes', title: 'Notes', icon: 'notes', hint: 'g n' },
  { path: 'emails', title: 'Emails', icon: 'emails', hint: 'g e' },
  { path: 'reports', title: 'Reports', icon: 'reports', hint: 'g d' },
  { path: 'settings/notifications', title: 'Notification settings', icon: 'notifications', keywords: ['inbox'] },
  { path: 'settings/appearance', title: 'Appearance settings', icon: 'theme', keywords: ['theme', 'accent'] },
];
