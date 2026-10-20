// What the composer does with a draft beyond editing it: send (hand its emails to the outbox) and the failure copy.
import type { QueryClient } from '@tanstack/react-query';
import { emailKeys } from '../../data/emailKeys';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../data/trpc';
import { issueText } from './model';
import type { ComposerSession } from './session';

export interface SendResult {
  count: number;
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
  }
}

/**
 * Saves the pending edits, then sends the draft: single send = one outbox email, mass send = one per recipient.
 * `allowEmptyVariables` sends although some variables have no value (the review step showed them).
 */
export async function sendDraft(
  client: QueryClient,
  ws: WorkspaceRef,
  session: ComposerSession,
  options: { allowEmptyVariables?: boolean } = {},
): Promise<SendResult> {
  await session.flush();
  if (session.getSnapshot().saveError) throw new SendError('The draft could not be saved', []);
  try {
    const out = await api.email.drafts.send.mutate(
      { draftId: session.id, allowEmptyVariables: options.allowEmptyVariables ?? false },
      inWorkspace(ws),
    );
    noteAcceptAfter(ws.id, out.seq);
    session.sent();
    void client.invalidateQueries({ queryKey: emailKeys.drafts(ws.id) });
    void client.invalidateQueries({ queryKey: emailKeys.outbox(ws.id) });
    return { count: out.outbox.length };
  } catch (error) {
    const issues = issuesOf(error);
    if (issues.length > 0) throw new SendError(issues.map(issueText).join('. '), issues);
    throw new SendError(errorEnvelopeOf(error).message ?? 'Failed to send the email', []);
  }
}

/** The blocking issues a `DRAFT_NOT_SENDABLE` error carries. */
function issuesOf(error: unknown): string[] {
  const shape = (error as { shape?: { additional_information?: { issues?: unknown } | null } }).shape;
  const issues = shape?.additional_information?.issues;
  return Array.isArray(issues) ? issues.filter((i): i is string => typeof i === 'string') : [];
}
