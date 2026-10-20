import { createContext, useContext } from 'react';
import type { Me } from '../../data/session';
import type { WorkspaceSummary } from '../../data/workspaces';

export interface WorkspaceContextValue {
  workspace: WorkspaceSummary;
  me: Me;
  isAdmin: boolean;
  /** `/<slug>/<path>` */
  href: (path?: string) => string;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside a workspace route');
  return ctx;
}

export function workspaceHref(slug: string, path = ''): string {
  return path ? `/${slug}/${path}` : `/${slug}`;
}
