// Mutations of a chat: send, stop, approve / deny a write, try again, feedback, web search permission. Each one keeps
// the live store in step: sending shows the user turn and an empty assistant turn at once (optimistic), then opens
// the SSE stream; approve / deny / allow resume the turn, which the server runs on, so their stream is opened again.
import type {
  AiAnnotation,
  AiContext,
  AiFeedback,
  AiRefinement,
  AiToolPart,
  AiTurn,
  AiUserPart,
} from '@agentic-crm/contracts';
import { toast } from '@agentic-crm/ui';
import { queryClient } from '../../data/queryClient';
import { api, errorEnvelopeOf, httpStatusOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { type AiThreadDetailData, askKeys } from './data';
import { liveStore } from './stream/live';

export interface SendArgs {
  ws: WorkspaceRef;
  memberId: string;
  threadId: string;
  content: string;
  annotations: AiAnnotation[];
  context?: AiContext | undefined;
  /** "auto" or a model id. */
  model: string;
  /** The assistant turn the message replies to (null / undefined = the start of the thread). */
  parentTurnId?: string | null | undefined;
  source?: 'composer' | 'suggestion' | 'reply-suggestion';
}

const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

function interestParts(context: AiContext | undefined): AiUserPart[] {
  const parts: AiUserPart[] = [];
  for (const r of context?.records ?? []) {
    parts.push({
      type: 'interest',
      interestType: 'entity-instance',
      params: { entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId },
      prominence: 'high',
    });
  }
  if (context?.call) {
    parts.push({
      type: 'interest',
      interestType: context.call.startTime !== undefined ? 'call-recording-transcript-selection' : 'call-recording',
      params: { ...context.call },
      prominence: 'high',
    });
  }
  if (context?.meeting) {
    parts.push({ type: 'interest', interestType: 'meeting', params: { ...context.meeting }, prominence: 'high' });
  }
  return parts;
}

function baseTurn(threadId: string, memberId: string, over: Partial<AiTurn>): AiTurn {
  return {
    id: newId(),
    threadId,
    parentTurnId: null,
    role: 'user',
    parts: [],
    status: 'completed',
    model: null,
    modelMode: null,
    refinement: null,
    steps: [],
    pendingApprovals: [],
    creditCost: null,
    contextTokens: null,
    failureReason: null,
    feedback: null,
    createdByMemberId: memberId,
    createdAt: new Date().toISOString(),
    completedAt: null,
    canceledAt: null,
    failedAt: null,
    ...over,
  };
}

/** A readable message for a failed AI call (credits, not configured, provider errors). */
export function aiErrorMessage(error: unknown): string {
  const { message, code } = errorEnvelopeOf(error);
  if (code === 'CREDITS_EXHAUSTED' || httpStatusOf(error) === 402) {
    return "You've reached your credit limit. Credits reset at the start of the next period.";
  }
  if (code === 'AI_NOT_CONFIGURED') return 'Ask AI is not set up on this server yet.';
  return message || 'Something went wrong';
}

/** Sends a message: optimistic turns, the mutation, then the stream. Resolves with the assistant turn id, or null. */
export async function sendTurn(args: SendArgs): Promise<string | null> {
  const { ws, memberId, threadId } = args;
  const userTurnId = newId();
  const turnId = newId();
  const now = new Date().toISOString();
  const user = baseTurn(threadId, memberId, {
    id: userTurnId,
    parentTurnId: args.parentTurnId ?? null,
    parts: [{ type: 'text', content: args.content, annotations: args.annotations }, ...interestParts(args.context)],
    createdAt: now,
  });
  const assistant = baseTurn(threadId, memberId, {
    id: turnId,
    parentTurnId: userTurnId,
    role: 'assistant',
    status: 'executing',
    model: args.model === 'auto' ? null : args.model,
    modelMode: args.model === 'auto' ? 'auto' : 'manual',
    createdAt: now,
  });
  liveStore.addOptimistic(threadId, [user, assistant]);
  try {
    const out = await api.ai.turns.send.mutate(
      {
        threadId,
        userTurnId,
        turnId,
        content: args.content,
        ...(args.annotations.length ? { annotations: args.annotations } : {}),
        ...(args.context && Object.keys(args.context).length ? { context: args.context } : {}),
        model: args.model,
        ...(args.parentTurnId ? { parentTurnId: args.parentTurnId } : {}),
        source: args.source ?? 'composer',
        timeZone: browserTimeZone(),
      },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, out.seq);
    void queryClient.invalidateQueries({ queryKey: askKeys.threadsAll(ws.id) });
    liveStore.startStream(ws, threadId, out.turnId);
    return out.turnId;
  } catch (error) {
    liveStore.discardOptimistic(threadId, [userTurnId, turnId]);
    toast.error({ title: 'Failed to send message', description: aiErrorMessage(error) });
    return null;
  }
}

/** Writes a returned turn into the cached thread (approve / deny / cancel answer with the updated turn). */
function writeTurn(ws: WorkspaceRef, returned: unknown): void {
  const turn = returned as AiTurn;
  queryClient.setQueryData<AiThreadDetailData>(askKeys.thread(ws.id, turn.threadId), (data) =>
    data ? { ...data, turns: data.turns.map((t) => (t.id === turn.id ? turn : t)) } : data,
  );
}

export async function cancelTurn(ws: WorkspaceRef, turn: Pick<AiTurn, 'id' | 'threadId'>): Promise<void> {
  try {
    const { turn: updated, seq } = await api.ai.turns.cancel.mutate({ turnId: turn.id }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    writeTurn(ws, updated);
  } catch (error) {
    toast.error({ title: 'Failed to stop the answer', description: aiErrorMessage(error) });
  }
}

/** Approval card "Create ⌘↵": runs the (edited) call, then follows the resumed turn. Returns false on failure. */
export async function approveTool(
  ws: WorkspaceRef,
  turn: Pick<AiTurn, 'id' | 'threadId'>,
  part: Pick<AiToolPart, 'toolCallId'>,
  input?: unknown,
): Promise<boolean> {
  try {
    const { turn: updated, seq } = await api.ai.turns.approve.mutate(
      { turnId: turn.id, toolCallId: part.toolCallId, ...(input !== undefined ? { input } : {}) },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, seq);
    writeTurn(ws, updated);
    liveStore.startStream(ws, turn.threadId, turn.id);
    return true;
  } catch (error) {
    toast.error({ title: "Couldn't run this action", description: aiErrorMessage(error) });
    return false;
  }
}

/** "Discard" / "Deny". */
export async function denyTool(
  ws: WorkspaceRef,
  turn: Pick<AiTurn, 'id' | 'threadId'>,
  part: Pick<AiToolPart, 'toolCallId'>,
): Promise<boolean> {
  try {
    const { turn: updated, seq } = await api.ai.turns.deny.mutate(
      { turnId: turn.id, toolCallId: part.toolCallId, reason: null },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, seq);
    writeTurn(ws, updated);
    liveStore.startStream(ws, turn.threadId, turn.id);
    return true;
  } catch (error) {
    toast.error({ title: 'Failed to discard the action', description: aiErrorMessage(error) });
    return false;
  }
}

/** Web search permission card: "Allow" for this thread, "Always allow" for the member. */
export async function allowWebSearch(
  ws: WorkspaceRef,
  turn: Pick<AiTurn, 'id' | 'threadId'>,
  always: boolean,
): Promise<boolean> {
  try {
    const { seq } = await api.ai.webSearch.allow.mutate({ threadId: turn.threadId, always }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
    if (always) void queryClient.invalidateQueries({ queryKey: askKeys.settings(ws.id) });
    liveStore.startStream(ws, turn.threadId, turn.id);
    return true;
  } catch (error) {
    toast.error({ title: 'Failed to allow web search', description: aiErrorMessage(error) });
    return false;
  }
}

/** "Try again": a new sibling assistant turn (another model or a refinement); streamed like a sent message. */
export async function retryTurn(
  ws: WorkspaceRef,
  turn: Pick<AiTurn, 'id' | 'threadId'>,
  options: { model?: string; refinement?: AiRefinement } = {},
): Promise<string | null> {
  const newTurnId = newId();
  try {
    const out = await api.ai.turns.retry.mutate({ turnId: turn.id, newTurnId, ...options }, inWorkspace(ws));
    noteAcceptAfter(ws.id, out.seq);
    await queryClient.invalidateQueries({ queryKey: askKeys.thread(ws.id, turn.threadId) });
    liveStore.startStream(ws, turn.threadId, out.turnId);
    return out.turnId;
  } catch (error) {
    toast.error({ title: 'Failed to try again', description: aiErrorMessage(error) });
    return null;
  }
}

/** Thumbs up / down; `null` clears the rating. */
export async function setFeedback(
  ws: WorkspaceRef,
  turn: Pick<AiTurn, 'id' | 'threadId'>,
  feedback: AiFeedback | null,
): Promise<void> {
  const key = askKeys.thread(ws.id, turn.threadId);
  const prev = queryClient.getQueryData<AiThreadDetailData>(key);
  queryClient.setQueryData<AiThreadDetailData>(key, (data) =>
    data ? { ...data, turns: data.turns.map((t) => (t.id === turn.id ? { ...t, feedback } : t)) } : data,
  );
  try {
    const { seq } = await api.ai.turns.feedback.mutate({ turnId: turn.id, feedback }, inWorkspace(ws));
    noteAcceptAfter(ws.id, seq);
  } catch (error) {
    if (prev) queryClient.setQueryData(key, prev);
    toast.error({ title: 'Failed to save feedback', description: aiErrorMessage(error) });
  }
}
