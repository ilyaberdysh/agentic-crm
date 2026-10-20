// The review step (F composer §2.10, evidence/F/composer-review-mass-send.png): "Review email · Previewing" — the same
// window with every email as it will be sent (variables merged for the selected recipient, fallbacks applied), the
// recipients panel to switch the preview, "‹ Back to editor" and "Send emails (N)". An email with a variable that
// has no value and no fallback stops here: the recipient is flagged, and sending asks for confirmation.
import { AlertDialog, Button, Icon, IconButton, Skeleton, toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { emailKeys } from '../../data/emailKeys';
import { api, inWorkspace } from '../../data/trpc';
import { RecordAvatar } from '../attributes/ui/primitives';
import { useWs } from '../mailboxes/data';
import * as s from './composer.css';
import { issueText, sendEmailsLabel } from './model';
import { ComposerHeader, DeliveryStrip, SenderField } from './parts';
import { RecipientsPanel } from './recipients';
import { sanitizeEmailHtml } from './sanitize';
import type { ComposerSession, Draft } from './session';

export interface ReviewViewProps {
  id: string;
  mode: 'modal' | 'floating';
  session: ComposerSession;
  draft: Draft;
  onBack: () => void;
  onClose: () => void;
  onSend: (allowEmptyVariables: boolean) => void;
  sending: boolean;
  onDelete: () => void;
  confirmDelete: boolean;
  setConfirmDelete: (open: boolean) => void;
  onViewOutbox: () => void;
}

interface AffectedEmail {
  missing: readonly { label: string }[];
  recipient: { name: string | null; emailAddress: string };
}

/** "No value for { Name › First } and no fallback: Wade Warren, nobody@x.io" — every email that stops the send. */
export function missingText(affected: readonly AffectedEmail[]): string {
  const labels = [...new Set(affected.flatMap((e) => e.missing.map((m) => `{ ${m.label} }`)))].join(', ');
  const who = affected
    .slice(0, 3)
    .map((e) => e.recipient.name || e.recipient.emailAddress)
    .join(', ');
  const more = affected.length > 3 ? ` and ${affected.length - 3} more` : '';
  return `No value for ${labels} and no fallback: ${who}${more}.`;
}

/** Issues that stop sending for good (the unresolved-variables one can be confirmed). */
const CONFIRMABLE = 'unresolved-variables';

export function ReviewView({
  id,
  mode,
  session,
  draft,
  onBack,
  onClose,
  onSend,
  sending,
  onDelete,
  confirmDelete,
  setConfirmDelete,
  onViewOutbox,
}: ReviewViewProps) {
  const ws = useWs();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const review = useQuery({
    queryKey: emailKeys.draftReview(ws.id, id),
    queryFn: () => api.email.drafts.review.query({ draftId: id }, inWorkspace(ws)),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const emails = review.data?.emails ?? [];
  const current = emails.find((e) => e.recipient.emailAddress === selected) ?? emails[0];
  const html = useMemo(() => (current ? sanitizeEmailHtml(current.bodyHtml) : ''), [current]);
  const flagged = useMemo(
    () => new Set(emails.filter((e) => e.missing.length > 0).map((e) => e.recipient.emailAddress)),
    [emails],
  );
  const affected = useMemo(() => emails.filter((e) => e.missing.length > 0), [emails]);
  const issues = review.data?.issues ?? [];
  const blocking = issues.filter((i) => i !== CONFIRMABLE);
  const isMass = draft.isMassSend;
  const count = emails.length;

  const send = () => {
    if (issues.includes(CONFIRMABLE)) setConfirmEmpty(true);
    else onSend(false);
  };

  return (
    <div
      className={s.root}
      data-mode={mode}
      data-mass={isMass || undefined}
      data-view="review"
      data-testid="composer-review"
    >
      <ComposerHeader
        id={id}
        mode={mode}
        canPin={false}
        onClose={onClose}
        back={{ label: 'Back to editor', onPress: onBack }}
      >
        <span className={s.crumb}>
          <Icon icon="compose" size={16} />
          <span className={s.crumbMuted}>Compose email</span>
          <span className={s.crumbSeparator}>/</span>
          <span data-testid="review-title">Review email</span>
          <span className={s.previewPill}>
            <Icon icon="show" size={12} />
            Previewing
          </span>
        </span>
      </ComposerHeader>
      <div className={s.main}>
        <div className={s.editorColumn}>
          <div className={s.fields}>
            <div className={s.row}>
              <span className={s.rowLabel}>From</span>
              <div className={s.rowValue}>
                <SenderField senderMailboxId={draft.senderMailboxId} onChange={() => undefined} />
              </div>
            </div>
            <div className={s.row}>
              <span className={s.rowLabel}>To</span>
              <div className={s.rowValue} data-testid="review-to">
                {current && (
                  <span className={s.chip}>
                    <RecordAvatar kind="person" size={16} />
                    <span className={s.chipLabel}>{current.recipient.name || current.recipient.emailAddress}</span>
                  </span>
                )}
              </div>
            </div>
            <div className={s.row}>
              <span className={s.rowLabel}>Subject</span>
              <div className={s.rowValue}>
                <span className={s.reviewSubject} data-testid="review-subject">
                  {current?.subject ?? ''}
                </span>
              </div>
            </div>
          </div>
          {review.isPending && (
            <div className={s.reviewBody}>
              <Skeleton width="60%" height={12} />
            </div>
          )}
          {review.isError && (
            <div className={s.stateBox}>
              <span className={s.stateTitle}>The review could not be loaded</span>
              <Button variant="secondary" size={28} onPress={() => void review.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {review.isSuccess && (
            <>
              {(blocking.length > 0 || affected.length > 0) && (
                <div className={s.warning} data-testid="review-warning" role="alert">
                  <Icon icon="warning" size={16} />
                  <span className={s.warningText}>
                    {blocking.length > 0 ? blocking.map(issueText).join('. ') : missingText(affected)}
                  </span>
                </div>
              )}
              <div
                className={s.reviewBody}
                data-testid="review-body"
                // The HTML went through the allowlist above.
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
          {isMass && <DeliveryStrip onViewOutbox={onViewOutbox} />}
        </div>
        {isMass && (
          <RecipientsPanel
            recipients={emails.map((e) => e.recipient)}
            selected={current?.recipient.emailAddress}
            onSelect={setSelected}
            flagged={flagged}
            disabled
          />
        )}
      </div>
      <div className={s.footer}>
        <Button variant="ghost" size={28} icon="chevronLeft" onPress={onBack} data-testid="review-back">
          Back to editor
        </Button>
        <div className={s.footerTools} />
        <div className={s.footerRight}>
          <IconButton icon="delete" aria-label="Delete draft" tooltip="Delete draft" size={28} onPress={onDelete} />
          <Button
            variant="primary"
            size={32}
            icon="send"
            isDisabled={!review.isSuccess || blocking.length > 0 || count === 0 || sending}
            onPress={send}
            data-testid="review-send"
          >
            {sendEmailsLabel(count, isMass)}
          </Button>
        </div>
      </div>
      <AlertDialog
        isOpen={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        title="Some variables have no value"
        description={`${flagged.size === 1 ? 'One email has' : `${flagged.size} emails have`} a variable with no value and no fallback. It will be sent with that part empty. Send anyway?`}
        confirmLabel="Send anyway"
        onConfirm={() => {
          setConfirmEmpty(false);
          onSend(true);
        }}
      />
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Are you sure?"
        description="Permanently delete this email draft?"
        confirmLabel="Confirm"
        variant="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          void session.discard().then(
            () => toast({ title: 'Draft deleted' }),
            () => toast.error({ title: 'Failed to delete the draft' }),
          );
        }}
      />
    </div>
  );
}
