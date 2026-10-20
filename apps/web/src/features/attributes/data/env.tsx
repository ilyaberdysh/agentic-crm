// The environment attribute Views / Editors run in: the workspace (query scope), the current member (optimistic
// `createdBy`, "current user" defaults) and the two server calls that are not plain cached reads — record search
// and member search for pickers (B.8) and inline option creation. The app uses the live defaults; the dev gallery and unit tests
// provide fixtures through <AttributeEnvProvider>.
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { getCurrentWorkspace, type WorkspaceRef } from '../../../data/trpc';
import { WorkspaceContext } from '../../shell/workspaceContext';
import type { AttributeDefinition, SelectOption } from '../types';
import {
  createOptionLive,
  type MemberSearchHit,
  type MemberSearchParams,
  type RecordSearchHit,
  type RecordSearchParams,
  searchMembersLive,
  searchRecordsLive,
} from './server';

export interface AttributeEnv {
  workspace: WorkspaceRef;
  /** Workspace membership id of the signed-in user (null in fixtures without a user). */
  memberId: string | null;
  searchRecords: (params: RecordSearchParams) => Promise<RecordSearchHit[]>;
  searchMembers: (params: MemberSearchParams) => Promise<MemberSearchHit[]>;
  createOption: (attribute: AttributeDefinition, title: string) => Promise<SelectOption>;
}

const EnvContext = createContext<AttributeEnv | null>(null);

export function AttributeEnvProvider({ value, children }: { value: AttributeEnv; children: ReactNode }) {
  return <EnvContext.Provider value={value}>{children}</EnvContext.Provider>;
}

const NO_WORKSPACE: WorkspaceRef = { id: '', slug: '' };

/** The provided environment, or the live one of the current workspace route. */
export function useAttributeEnv(): AttributeEnv {
  const provided = useContext(EnvContext);
  const route = useContext(WorkspaceContext);
  return useMemo<AttributeEnv>(() => {
    if (provided) return provided;
    const workspace = route
      ? { id: route.workspace.id, slug: route.workspace.slug }
      : (getCurrentWorkspace() ?? NO_WORKSPACE);
    return {
      workspace,
      memberId: route?.workspace.membership.id ?? null,
      searchRecords: (params) => searchRecordsLive(workspace, params),
      searchMembers: (params) => searchMembersLive(workspace, params),
      createOption: (attribute, title) => createOptionLive(workspace, attribute, title),
    };
  }, [provided, route]);
}
