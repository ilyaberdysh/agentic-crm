// Main app shell (`/$workspaceSlug/_main`): sidebar + routed page. Route content suspends to a centred spinner.
import { Spinner } from '@agentic-crm/ui';
import { Outlet } from '@tanstack/react-router';
import { Suspense } from 'react';
import { ListsHost } from '../lists/flows';
import { OverlayHost } from '../overlays/OverlayHost';
import { WorkflowBroadcasts } from '../workflows/Broadcasts';
import { MainSidebar } from './MainSidebar';
import * as s from './shell.css';
import { ShellFrame } from './WorkspaceLayout';

export function AppShell() {
  return (
    <ShellFrame sidebar={<MainSidebar />} label="Sidebar">
      <Suspense fallback={<ContentSpinner />}>
        <Outlet />
      </Suspense>
      <OverlayHost />
      <ListsHost />
      <WorkflowBroadcasts />
    </ShellFrame>
  );
}

export function ContentSpinner() {
  return (
    <div className={s.contentCenter}>
      <Spinner size={16} />
    </div>
  );
}
