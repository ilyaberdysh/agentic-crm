// Routes of the workflows feature (README §1 route table):
//   /$ws/automations/workflows                                   index
//   /$ws/automations/workflows/new                               → a new transient workflow's editor
//   /$ws/automations/workflows/$id                               → /editor
//   /$ws/automations/workflows/$id/editor                        canvas editor
//   /$ws/automations/workflows/$id/runs                          → the latest run (or "No runs yet")
//   /$ws/automations/workflows/$id/runs/$versionId/$runId        run viewer
//   /$ws/automations/workflows/$id/settings                      settings tab
//   /$ws/settings/automations/workflows                          admin list
//   /$ws/settings/automations/workflows/$id/permissions          admin permissions
//   /$ws/settings/billing/automation-credit-usage                credits usage (workflow-credit-usage redirects)
import { type AnyRoute, createRoute, lazyRouteComponent, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { ContentSpinner } from '../shell/AppShell';
import { useWorkspace } from '../shell/workspaceContext';
import { AdminWorkflowPermissionsPage, AdminWorkflowsPage, CreditUsagePage } from './admin/AdminPages';
import { createWorkflow, reportError, useWs } from './data';
import { WorkflowLayout } from './editor/WorkflowLayout';
import { WorkflowsPage } from './index/WorkflowsPage';
import { editorPath, workflowsPath } from './paths';
import { SettingsTab } from './settings/SettingsTab';

function toEditor(params: unknown): never {
  const p = params as { workspaceSlug: string; workflowId: string };
  throw redirect({ href: `/${p.workspaceSlug}/${editorPath(p.workflowId)}`, replace: true });
}

function NewWorkflowRoute() {
  const ws = useWs();
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    createWorkflow(ws)
      .then((w) => navigate({ href: href(editorPath(w.id)), replace: true }))
      .catch((error) => {
        reportError(error, 'Failed to create workflow');
        void navigate({ href: href(workflowsPath()), replace: true });
      });
  }, []);
  return <ContentSpinner />;
}

// The canvas (@xyflow/react) loads with the editor and run viewer only.
const EditorTab = lazyRouteComponent(() => import('./editor/EditorTab'), 'EditorTab');
const RunsTab = lazyRouteComponent(() => import('./runs/RunsTab'), 'RunsTab');

/** Pass the main (`_main`) route. */
export function workflowRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const index = createRoute({ getParentRoute, path: 'automations/workflows', component: WorkflowsPage });
  const create = createRoute({ getParentRoute, path: 'automations/workflows/new', component: NewWorkflowRoute });
  const workflow = createRoute({
    getParentRoute,
    path: 'automations/workflows/$workflowId',
    component: WorkflowLayout,
  });
  const workflowIndex = createRoute({
    getParentRoute: () => workflow,
    path: '/',
    beforeLoad: ({ params }) => toEditor(params),
  });
  const editor = createRoute({ getParentRoute: () => workflow, path: 'editor', component: EditorTab });
  const runs = createRoute({ getParentRoute: () => workflow, path: 'runs', component: RunsTab });
  const run = createRoute({ getParentRoute: () => workflow, path: 'runs/$versionId/$runId', component: RunsTab });
  const settings = createRoute({ getParentRoute: () => workflow, path: 'settings', component: SettingsTab });
  const splat = createRoute({
    getParentRoute: () => workflow,
    path: '$',
    beforeLoad: ({ params }) => toEditor(params),
  });
  return [index, create, workflow.addChildren([workflowIndex, editor, runs, run, settings, splat])];
}

/** Pass the settings route. */
export function workflowSettingsRoutes(getParentRoute: () => AnyRoute): AnyRoute[] {
  const admin = createRoute({ getParentRoute, path: 'automations/workflows', component: AdminWorkflowsPage });
  const permissions = createRoute({
    getParentRoute,
    path: 'automations/workflows/$workflowId/permissions',
    component: AdminWorkflowPermissionsPage,
  });
  const usage = createRoute({ getParentRoute, path: 'billing/automation-credit-usage', component: CreditUsagePage });
  const usageAlias = createRoute({
    getParentRoute,
    path: 'billing/workflow-credit-usage',
    beforeLoad: ({ params }) => {
      throw redirect({
        href: `/${(params as { workspaceSlug: string }).workspaceSlug}/settings/billing/automation-credit-usage`,
        replace: true,
      });
    },
  });
  return [admin, permissions, usage, usageAlias];
}

/** Paths these routes own (the router drops the matching placeholders). */
export const WORKFLOW_SETTINGS_PATHS = ['automations/workflows'];
