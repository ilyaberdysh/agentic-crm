// The composer window (F composer): header (Minimize · Pin to screen / Expand · Close), From, To (+ Cc / Bcc), Subject
// and body editors with variables, attachments, footer tools (attachment, image, variable, signature, template),
// the Mass sending switch (1088 px wide with a recipients panel), Delete draft and Send email / Review. The working
// copy lives in a `ComposerSession` (autosave per field), so minimising and pinning keep every keystroke.
import { type Block, BlockEditor, isEmptyBlocks, LineEditor, textBlock, type VariableRef } from '@agentic-crm/editor';
import {
  AlertDialog,
  Button,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Switch,
  Tooltip,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useWs } from '../mailboxes/data';
import type { WindowContentProps } from '../overlays';
import { closeWindow, minimizeWindow } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { SendError, sendDraft } from './actions';
import * as s from './composer.css';
import { createTemplateNow, useTemplates } from './data';
import { TemplatesGlyph, VariableGlyph } from './glyphs';
import {
  addRecipients,
  MASS_SEND_MAX,
  massSendLabel,
  previewSubject,
  primaryLabel,
  type RecipientLike,
  stripSignature,
  withSignature,
} from './model';
import { AttachmentCards, ComposerHeader, DeliveryStrip, SenderField, SignatureMenu } from './parts';
import { ReviewView } from './ReviewView';
import { RecipientField, RecipientsPanel } from './recipients';
import { type ComposerSession, type Draft, type SessionSnapshot } from './session';
import { useComposerSession } from './sessions';
import { TemplateView } from './TemplateView';
import { useVariableUi } from './useVariableUi';

export function ComposerWindow({ id, mode }: WindowContentProps) {
  const { session, snapshot } = useComposerSession(id);
  // The draft was sent or deleted: the window goes (no empty-draft cleanup: the session already finished).
  useEffect(() => {
    if (snapshot.finished) closeWindow('composer', id);
  }, [snapshot.finished, id]);

  if (snapshot.status === 'loading' || !snapshot.draft) {
    return (
      <div className={s.root} data-mode={mode} data-testid="composer" data-state={snapshot.status}>
        <ComposerHeader id={id} mode={mode} canPin onClose={() => closeWindow('composer', id)} />
        <div className={s.stateBox}>
          {snapshot.status === 'error' ? (
            <>
              <span className={s.stateTitle} data-testid="composer-not-found">
                Draft not found
              </span>
              <span className={s.stateText}>It may have been sent or deleted.</span>
            </>
          ) : (
            <Icon icon="spinner" size={16} />
          )}
        </div>
      </div>
    );
  }
  return <ComposerView key={id} id={id} mode={mode} session={session} snapshot={snapshot} draft={snapshot.draft} />;
}

type View = 'edit' | 'review' | 'template';

function ComposerView({
  id,
  mode,
  session,
  snapshot,
  draft,
}: {
  id: string;
  mode: 'modal' | 'floating';
  session: ComposerSession;
  snapshot: SessionSnapshot;
  draft: Draft;
}) {
  const ws = useWs();
  const { href } = useWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>('edit');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [showCc, setShowCc] = useState(draft.cc.length > 0 || draft.bcc.length > 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmNoSubject, setConfirmNoSubject] = useState(false);
  const [sending, setSending] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const images = useRef<HTMLInputElement>(null);
  const vars = useVariableUi();
  // The editors start from the draft as it is when they mount: the window opening (pin / expand remount it, the
  // session keeps the text) and coming back from the review or template view.
  const [initial, setInitial] = useState(() => ({ subject: draft.subject, body: draft.body as Block[] }));
  const backToEditor = () => {
    setInitial({ subject: draft.subject, body: draft.body as Block[] });
    setView('edit');
  };

  // Turning mass sending on puts the caret in "Add recipients" (composer-mass-send-dark.png).
  const startedMass = useRef(draft.isMassSend).current;
  const isMass = draft.isMassSend;
  const recipients: RecipientLike[] = draft.to;
  const hasVariables = draft.hasVariables;
  const extraDisabled = hasVariables && !isMass && recipients.length >= 1;
  const closeWindowAndCleanup = () => closeWindow('composer', id);

  const setList = (field: 'to' | 'cc' | 'bcc', next: RecipientLike[]) => {
    if (field === 'to' && isMass && next.length > MASS_SEND_MAX) {
      toast.warning({ title: `Please add a maximum of ${MASS_SEND_MAX} recipients` });
      return;
    }
    session.setRecipients(field, next);
  };

  const onFiles = async (list: FileList | null, imagesOnly = false) => {
    const picked = [...(list ?? [])].filter((f) => !imagesOnly || f.type.startsWith('image/'));
    if (picked.length === 0) return;
    const { failed } = await session.addFiles(picked);
    for (const f of failed)
      toast.error({ title: 'Failed to upload attachment', description: `${f.name}: ${f.message}` });
  };

  const trySend = async (allowEmpty = false) => {
    setSending(true);
    const pending = toast({ title: 'Sending emails...', durationMs: Number.POSITIVE_INFINITY, icon: 'spinner' });
    try {
      const result = await sendDraft(client, ws, session, { allowEmptyVariables: allowEmpty });
      toast.dismiss(pending);
      toast.success({
        title: result.count === 1 ? 'Email sent' : 'Emails sent',
        action: { label: 'View outbox', onAction: () => void navigate({ href: href('emails/outbox') }) },
      });
    } catch (error) {
      toast.dismiss(pending);
      toast.error({
        title: 'Failed to send',
        description: error instanceof SendError || error instanceof Error ? error.message : undefined,
      });
      setSending(false);
    }
  };

  const onPrimary = async () => {
    if (isMass || hasVariables) {
      await session.flush();
      setView('review');
      return;
    }
    if (draft.subject.text.trim() === '') setConfirmNoSubject(true);
    else void trySend();
  };

  const onSignature = (signature: { id: string; body: unknown } | null) => {
    const handle = vars.handle('body');
    const blocks = signature ? (signature.body as Block[]) : null;
    const next = withSignature(handle?.getBlocks() ?? (draft.body as Block[]), snapshot.signatureBlocks, blocks);
    handle?.setBlocks(next);
    session.setSignature(signature?.id ?? null, blocks);
  };

  const templates = useTemplates();
  const templateList = templates.data ?? [];
  /** Puts a template's subject (when empty) and body into the draft, above the signature. */
  const applyTemplate = (templateId: string) => {
    const template = templateList.find((t) => t.id === templateId);
    if (!template) return;
    const body = vars.handle('body');
    const subject = vars.handle('subject');
    if (draft.subject.text.trim() === '') {
      subject?.setBlocks([
        { ...textBlock('unstyled', template.subject.text), variables: template.subject.variables as VariableRef[] },
      ]);
    }
    const signature = snapshot.signatureBlocks;
    const current = signature ? stripSignature(body?.getBlocks() ?? [], signature) : (body?.getBlocks() ?? []);
    const templateBody = template.body as Block[];
    body?.setBlocks(
      isEmptyBlocks(current)
        ? signature
          ? withSignature(templateBody, null, signature)
          : templateBody
        : [...(body?.getBlocks() ?? []), ...templateBody],
    );
    body?.focus('end');
  };

  const onCreateTemplate = async () => {
    try {
      // An empty template, by default uses the composer window switches to the template editor.
      const created = await createTemplateNow(client, ws);
      setTemplateId(created.id);
      setView('template');
    } catch (error) {
      toast.error({
        title: 'Failed to create the template',
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  if (view === 'template' && templateId) {
    return (
      <TemplateView id={id} mode={mode} templateId={templateId} onBack={backToEditor} onClose={closeWindowAndCleanup} />
    );
  }
  if (view === 'review') {
    return (
      <ReviewView
        id={id}
        mode={mode}
        session={session}
        draft={draft}
        onBack={backToEditor}
        onClose={closeWindowAndCleanup}
        onSend={(allowEmpty) => trySend(allowEmpty)}
        sending={sending}
        onDelete={() => setConfirmDelete(true)}
        confirmDelete={confirmDelete}
        setConfirmDelete={setConfirmDelete}
        onViewOutbox={() => {
          minimizeWindow('composer', id);
          void navigate({ href: href('emails/outbox') });
        }}
      />
    );
  }

  const compact = mode === 'floating';
  // "…or create a template"; once templates exist the link picks one ("…or pick a template", F composera).
  const placeholder = (
    <>
      Start typing your email, or{' '}
      {templateList.length > 0 ? (
        <MenuTrigger>
          <AriaButton className={s.placeholderLink} data-testid="pick-template">
            pick a template
          </AriaButton>
          <Menu
            aria-label="Email templates"
            placement="bottom start"
            width={300}
            onAction={(key) => applyTemplate(String(key))}
          >
            {templateList.map((t) => (
              <MenuItem
                key={t.id}
                id={t.id}
                description={t.subject.text ? previewSubject(t.subject.text, t.subject.variables) : undefined}
              >
                {t.title || 'Untitled Template'}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      ) : (
        <button type="button" className={s.placeholderLink} onClick={() => void onCreateTemplate()}>
          create a template
        </button>
      )}
    </>
  );

  return (
    <div
      className={s.root}
      data-mode={mode}
      data-mass={isMass || undefined}
      data-view="edit"
      data-testid="composer"
      data-draft-id={id}
      data-saving={snapshot.saving || undefined}
    >
      <ComposerHeader id={id} mode={mode} canPin={!isMass} onClose={closeWindowAndCleanup} />
      <div className={s.main}>
        <div className={s.editorColumn}>
          <div className={s.fields}>
            <div className={s.row}>
              <span className={s.rowLabel}>From</span>
              <div className={s.rowValue}>
                <SenderField
                  senderMailboxId={draft.senderMailboxId}
                  onChange={(mailboxId) => session.setSender(mailboxId)}
                />
              </div>
            </div>
            <div className={s.row}>
              <span className={s.rowLabel}>To</span>
              {isMass ? (
                <div className={s.rowValue}>
                  <span className={s.massChip} data-testid="composer-mass-chip">
                    <Icon icon="emails" size={16} />
                    {massSendLabel(recipients.length)}
                  </span>
                </div>
              ) : (
                <RecipientField
                  label="To"
                  testId="composer-to"
                  value={draft.to}
                  onChange={(next) => setList('to', next)}
                  disabled={extraDisabled}
                  disabledHint="Variables can only be used with one recipient. Turn on mass sending to add more."
                  autoFocus={draft.to.length === 0 && !compact}
                />
              )}
              {!showCc && (
                <div className={s.rowAction}>
                  <button
                    type="button"
                    className={s.linkButton}
                    onClick={() => setShowCc(true)}
                    data-testid="composer-cc-toggle"
                  >
                    Cc / Bcc
                  </button>
                </div>
              )}
            </div>
            {showCc && (
              <>
                <div className={s.row}>
                  <span className={s.rowLabel}>Cc</span>
                  <RecipientField
                    label="Cc"
                    testId="composer-cc"
                    value={draft.cc}
                    onChange={(next) => setList('cc', next)}
                  />
                </div>
                <div className={s.row}>
                  <span className={s.rowLabel}>Bcc</span>
                  <RecipientField
                    label="Bcc"
                    testId="composer-bcc"
                    value={draft.bcc}
                    onChange={(next) => setList('bcc', next)}
                  />
                </div>
              </>
            )}
            <div className={s.row}>
              <span className={s.rowLabel}>Subject</span>
              <div className={s.subjectEditor}>
                <LineEditor
                  initial={initial.subject}
                  placeholder="Enter subject..."
                  ariaLabel="Subject"
                  testId="composer-subject"
                  {...vars.bind('subject')}
                  onChange={(value) => session.setSubject(value)}
                  onEnter={() => vars.handle('body')?.focus('start')}
                />
              </div>
            </div>
          </div>
          {hasVariables && !isMass && recipients.length > 1 && (
            <div className={s.warning} data-testid="composer-variables-warning">
              <Icon icon="warning" size={16} />
              <span className={s.warningText}>
                To send emails with variables to several recipients, convert this email to a mass send.
              </span>
              <Button
                variant="secondary"
                size={20}
                onPress={() => session.setMassSend(true)}
                data-testid="convert-to-mass"
              >
                Convert to Mass send
              </Button>
            </div>
          )}
          <div
            className={s.bodyScroll}
            onMouseDown={(e) => e.target === e.currentTarget && vars.handle('body')?.focus('end')}
          >
            <BlockEditor
              className={s.bodyEditor}
              initialBlocks={initial.body}
              ariaLabel="Email body"
              testId="composer-body"
              placeholderNode={placeholder}
              autofocus={draft.to.length > 0 && !compact ? 'start' : false}
              {...vars.bind('body')}
              onChange={(blocks) => session.setBody(blocks)}
            />
          </div>
          <AttachmentCards
            attachments={draft.attachments}
            uploads={snapshot.uploads}
            onRemove={(attachmentId) =>
              void session
                .removeAttachment(attachmentId)
                .catch(() => toast.error({ title: 'Failed to remove attachment' }))
            }
          />
          {isMass && (
            <DeliveryStrip
              onViewOutbox={() => {
                minimizeWindow('composer', id);
                void navigate({ href: href('emails/outbox') });
              }}
            />
          )}
        </div>
        {isMass && (
          <RecipientsPanel
            autoFocus={!startedMass}
            recipients={recipients}
            onAdd={(next) => setList('to', addRecipients(recipients, next))}
            onRemove={(address) =>
              session.setRecipients(
                'to',
                recipients.filter((r) => r.emailAddress !== address),
              )
            }
          />
        )}
      </div>
      <div className={s.footer} data-testid="composer-footer">
        <div className={s.footerTools}>
          <IconButton
            icon="attach"
            aria-label="Add attachment"
            tooltip="Add attachment"
            size={28}
            onPress={() => files.current?.click()}
          />
          <IconButton
            icon="image"
            aria-label="Add image"
            tooltip="Add image"
            size={28}
            onPress={() => images.current?.click()}
          />
          <IconButton
            icon={VariableGlyph}
            aria-label="Add variable"
            tooltip="Add Variable"
            size={28}
            onPress={vars.addVariable}
            data-testid="composer-add-variable"
          />
          <SignatureMenu mailboxId={draft.senderMailboxId} currentId={draft.signatureId} onPick={onSignature} />
          <IconButton
            icon={TemplatesGlyph}
            aria-label="Create email template"
            tooltip="Create email template"
            size={28}
            onPress={() => void onCreateTemplate()}
            data-testid="composer-create-template"
          />
          <input
            ref={files}
            type="file"
            multiple
            hidden
            aria-label="Browse files to upload"
            data-testid="composer-file-input"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={images}
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-label="Browse images to upload"
            onChange={(e) => {
              void onFiles(e.target.files, true);
              e.target.value = '';
            }}
          />
        </div>
        <div className={s.footerRight}>
          {!compact && (
            <span className={s.massSwitch}>
              <Switch
                isSelected={isMass}
                onChange={(on) => session.setMassSend(on)}
                aria-label="Mass sending"
                data-testid="mass-switch"
              >
                Mass sending
              </Switch>
              <Tooltip content="Each email is sent individually to every recipient. Mass sending is needed to use variables with several recipients.">
                <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                  <Icon icon="info" size={14} />
                </span>
              </Tooltip>
            </span>
          )}
          <IconButton
            icon="delete"
            aria-label="Delete draft"
            tooltip="Delete draft"
            size={28}
            onPress={() => setConfirmDelete(true)}
            data-testid="composer-delete"
          />
          <Button
            variant="primary"
            size={32}
            icon={isMass || hasVariables ? 'show' : 'send'}
            isDisabled={recipients.length === 0 || sending}
            onPress={() => void onPrimary()}
            data-testid="composer-primary"
          >
            {primaryLabel({ hasVariables, isMassSend: isMass, recipients: recipients.length })}
          </Button>
        </div>
      </div>
      {vars.popovers}
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
      <AlertDialog
        isOpen={confirmNoSubject}
        onOpenChange={setConfirmNoSubject}
        title="This email has no subject"
        description="Would you like to send it anyway?"
        confirmLabel="Send anyway"
        onConfirm={() => {
          setConfirmNoSubject(false);
          void trySend();
        }}
      />
    </div>
  );
}
