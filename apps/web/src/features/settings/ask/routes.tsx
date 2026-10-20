// Settings routes of Ask AI (BACKLOG 10.04; ask-agentic §11):
//   ask-agentic[/general|/prompts]                       Personal › Ask AI (`/` → general)
//   workspace-ask-agentic[/usage|/custom-context]        Workspace › Ask AI (admins; `/` → usage; also `ask-agentic-usage`)
import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';
import { AskSettingsPage } from './AskSettingsPage';
import { WorkspaceAskPage } from './WorkspaceAskPage';

/** Paths (below `settings/`) these routes serve; the placeholder generator skips them. */
export const askSettingsPaths = ['ask-agentic', 'workspace-ask-agentic'] as const;

interface GuardContext {
  workspace: { slug: string; membership: { accessLevel: string } } | null;
}

const slugOf = (c: GuardContext): string | null => c.workspace?.slug ?? null;

function requireAdmin(context: GuardContext): void {
  const slug = slugOf(context);
  if (slug && context.workspace?.membership.accessLevel !== 'admin') {
    throw redirect({ href: `/${slug}/settings/account`, replace: true });
  }
}

const go = (context: GuardContext, to: string): never => {
  throw redirect({ href: `/${slugOf(context)}/settings/${to}`, replace: true });
};

/** Pass the settings route (`getParentRoute`). */
export function askSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  return [
    createRoute({
      getParentRoute,
      path: 'ask-agentic',
      beforeLoad: ({ context }) => go(context as GuardContext, 'ask-agentic/general'),
    }),
    createRoute({ getParentRoute, path: 'ask-agentic/general', component: () => <AskSettingsPage tab="general" /> }),
    createRoute({ getParentRoute, path: 'ask-agentic/prompts', component: () => <AskSettingsPage tab="prompts" /> }),
    createRoute({
      getParentRoute,
      path: 'ask-agentic/$',
      beforeLoad: ({ context }) => go(context as GuardContext, 'ask-agentic/general'),
    }),
    createRoute({
      getParentRoute,
      path: 'workspace-ask-agentic',
      beforeLoad: ({ context }) => {
        requireAdmin(context as GuardContext);
        go(context as GuardContext, 'workspace-ask-agentic/usage');
      },
    }),
    createRoute({
      getParentRoute,
      path: 'ask-agentic-usage',
      beforeLoad: ({ context }) => go(context as GuardContext, 'workspace-ask-agentic/usage'),
    }),
    createRoute({
      getParentRoute,
      path: 'workspace-ask-agentic/usage',
      beforeLoad: ({ context }) => requireAdmin(context as GuardContext),
      component: () => <WorkspaceAskPage tab="usage" />,
    }),
    createRoute({
      getParentRoute,
      path: 'workspace-ask-agentic/custom-context',
      beforeLoad: ({ context }) => requireAdmin(context as GuardContext),
      component: () => <WorkspaceAskPage tab="custom-context" />,
    }),
    createRoute({
      getParentRoute,
      path: 'workspace-ask-agentic/$',
      beforeLoad: ({ context }) => go(context as GuardContext, 'workspace-ask-agentic/usage'),
    }),
  ];
}
