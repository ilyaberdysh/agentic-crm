// `/$workspaceSlug` layout: resolves the workspace (unknown/inaccessible → no-access page), scopes API calls to it,
// remembers it as the last workspace (sessions §8), subscribes to its realtime invalidations, and frames every
// workspace page with the announcement banner slot and the shared sidebar state.
import { Outlet } from '@tanstack/react-router';
import { type ReactNode, useEffect, useMemo } from 'react';
import { useRealtimeWorkspace } from '../../data/realtime/connection';
import type { Me } from '../../data/session';
import { rememberWorkspace, useWorkspaces, type WorkspaceSummary } from '../../data/workspaces';
import { AskHost } from '../ask/AskHost';
import { PaletteHost } from '../command-palette';
import { ApplyProfilePreferences } from '../settings/profile/ApplyProfilePreferences';
import { RuleViolationHost } from '../settings/rules/RuleViolationHost';
import { HelpDrawerHost } from '../shortcuts/HelpDrawer';
import { NoAccessPage } from '../workspaces/NoAccessPage';
import { SidebarFrame } from './SidebarFrame';
import * as s from './shell.css';
import { SidebarProvider } from './sidebarState';
import { WorkspaceContext, type WorkspaceContextValue, workspaceHref } from './workspaceContext';

export function WorkspaceLayout({ me, workspace: initial }: { me: Me; workspace: WorkspaceSummary | null }) {
  // Keep the summary live (renames through realtime invalidation of the list).
  const list = useWorkspaces();
  const workspace = (initial && list.find((w) => w.id === initial.id)) || initial;

  useEffect(() => {
    if (workspace) rememberWorkspace(workspace.id);
  }, [workspace]);
  useRealtimeWorkspace(workspace?.id);

  const value = useMemo<WorkspaceContextValue | null>(
    () =>
      workspace
        ? {
            workspace,
            me,
            isAdmin: workspace.membership.accessLevel === 'admin',
            href: (path?: string) => workspaceHref(workspace.slug, path),
          }
        : null,
    [workspace, me],
  );

  if (!value) return <NoAccessPage />;
  return (
    <WorkspaceContext.Provider value={value}>
      <ApplyProfilePreferences />
      <RuleViolationHost />
      <SidebarProvider>
        <div className={s.root}>
          <div className={s.row}>
            <Outlet />
            <AskHost />
          </div>
        </div>
        <PaletteHost />
        <HelpDrawerHost />
      </SidebarProvider>
    </WorkspaceContext.Provider>
  );
}

/** Sidebar + page column; the sidebar content differs between the main app and settings. */
export function ShellFrame({ sidebar, label, children }: { sidebar: ReactNode; label: string; children: ReactNode }) {
  return (
    <>
      <SidebarFrame label={label}>{sidebar}</SidebarFrame>
      <main className={s.main}>{children}</main>
    </>
  );
}
