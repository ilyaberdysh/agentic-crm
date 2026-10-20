// Entry points of the composer from synced mail (F composer §1; BACKLOG 7.03): "Compose email" on a record (header
// action, `c`, Overview "+") and Reply / Reply all / Forward in the email modal. The composer itself belongs to
// features/composer; this module only decides who the message goes to.
import type { AttributeDefinition, EmailParticipant, EntityDefinition } from '@agentic-crm/contracts';
import { queryClient } from '../../data/queryClient';
import { valuesQuery } from '../../data/records';
import type { WorkspaceRef } from '../../data/trpc';
import { formatValue } from '../attributes';
import { openComposer } from '../composer';
import type { ComposerRecipient } from '../composer/open';
import { composeTarget, type ReplyKind } from './model';

interface RecordRefLike {
  entityDefinitionId: string;
  entityInstanceId: string;
}

/** The primary (first) email address of a person record, or null. */
export async function primaryEmailOf(
  workspace: WorkspaceRef,
  recordRef: RecordRefLike,
  attributes: readonly AttributeDefinition[],
): Promise<string | null> {
  const attribute = attributes.find((a) => a.type === 'email-address' && !a.isArchived);
  if (!attribute) return null;
  const { values } = await queryClient.fetchQuery(
    valuesQuery({ ...recordRef, workspace, attributeDefinitionId: attribute.id }),
  );
  const first = values.find((v) => v.activeUntil === null);
  if (!first) return null;
  return formatValue(attribute, [first]) || null;
}

/**
 * "Compose email" on a record: for a person the recipient is their primary email address (linked to the record so
 * variables merge from it); for any other record the composer opens without a recipient.
 */
export async function composeForRecord(input: {
  workspace: WorkspaceRef;
  recordRef: RecordRefLike;
  object: Pick<EntityDefinition, 'entityType'>;
  attributes: readonly AttributeDefinition[];
  name?: string | null;
}): Promise<void> {
  if (input.object.entityType !== 'person-record') {
    openComposer({});
    return;
  }
  let emailAddress: string | null = null;
  try {
    emailAddress = await primaryEmailOf(input.workspace, input.recordRef, input.attributes);
  } catch {
    emailAddress = null;
  }
  if (!emailAddress) {
    openComposer({});
    return;
  }
  openComposer({
    to: [{ emailAddress, name: input.name ?? null, record: input.recordRef }],
  });
}

/** A participant as a composer recipient (people link to their record). */
export function toRecipient(p: EmailParticipant): ComposerRecipient {
  return {
    emailAddress: p.emailAddress,
    name: p.name,
    record: p.personId ? { entityDefinitionId: 'people', entityInstanceId: p.personId } : null,
  };
}

/** Reply / Reply all / Forward of a message: opens the composer with the recipients and `parentMessageId`. */
export function respondTo(
  message: { id: string; subject: string | null; participants: readonly EmailParticipant[] },
  kind: ReplyKind,
  viewerMemberId: string | null,
): void {
  const target = composeTarget(message.participants, message.subject, kind, viewerMemberId);
  openComposer({
    to: target.to.map(toRecipient),
    cc: target.cc.map(toRecipient),
    subject: target.subject,
    parentMessageId: message.id,
  });
}
