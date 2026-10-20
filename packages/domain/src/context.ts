// Every workspace-scoped service call runs with a context: which workspace (I2) and who acts (values, history and
// change_log record the actor). Transports build it from the session or API token.
import type { Actor } from '@agentic-crm/contracts';
import { memberActor, systemActor } from './actors.ts';

export interface ServiceContext {
  workspaceId: string;
  actor: Actor;
  /** Set only by the authenticated runner tool host for one transaction. Never read from a request body. */
  agentRuntime?: { runnerId: string; grantId: string };
  /**
   * Optional sink a transport passes to learn the change_log seq of the write: after a successful call `seq` is the
   * highest change_log id the transaction wrote (null when nothing changed, e.g. an idempotent replay). Clients use it
   * to recognise invalidations their own response already reflects (realtime I4a).
   */
  receipt?: { seq: string | null };
  /**
   * User-level API tokens act with the permissions of the member who authorised them (token levels: "a
   * specific workspace member, limited to the data and permissions that member has"); the actor stays the token.
   */
  onBehalfOfMemberId?: string | null;
  /**
   * Set while a workflow run executes a step (actor `{type:'workflow', id}`): the run and its cascade depth. Trigger
   * events of the transaction carry it, so the fan-out never retriggers the same workflow and stops cascades between
   * workflows after WORKFLOW_LIMITS.maxCascadeDepth (B.28, G README §4.5).
   */
  workflowRun?: { runId: string; workflowId: string; depth: number };
}

export function memberContext(workspaceId: string, memberId: string): ServiceContext {
  return { workspaceId, actor: memberActor(memberId) };
}

export function systemContext(workspaceId: string, reason: string | null = null): ServiceContext {
  return { workspaceId, actor: systemActor(reason) };
}

/** The workspace member behind the context, if the actor is a member. */
export function actingMemberId(ctx: ServiceContext): string | null {
  return ctx.actor.type === 'workspace-member' ? ctx.actor.id : null;
}

/** The member whose grants apply to the call: the acting member, or the member behind a user-level token. */
export function permissionMemberId(ctx: ServiceContext): string | null {
  return actingMemberId(ctx) ?? (ctx.actor.type === 'api-token' ? (ctx.onBehalfOfMemberId ?? null) : null);
}
