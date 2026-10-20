// A composer session: the working copy of one draft while its window is open (F composer §2.2). It lives outside React
// so that minimising, pinning and expanding (which remount the window) keep every keystroke:
//   - opening creates the draft at once (client-minted id, idempotent) or loads an existing one;
//   - every edit updates the local copy and schedules an autosave: only the changed fields are written
//     (`email.drafts.update`, each field stamped separately on the server), batched per ~600 ms;
//   - closing the window flushes pending edits and deletes a draft that is still empty;
//   - attachments: create (presigned PUT) → upload → commit, with local progress rows.
// The network is injected (`ComposerApi`) so the logic is unit-tested without a server.
import type { CreateDraftInput, MessageDraft, UpdateDraftInput } from '@agentic-crm/contracts';
import type { Block, LineValue } from '@agentic-crm/editor';
import { isDraftEmpty, type RecipientLike, withSignature } from './model';

export type Draft = MessageDraft;
export type DraftRecipient = Draft['to'][number];
export type DraftAttachment = Draft['attachments'][number];
export type RecipientField = 'to' | 'cc' | 'bcc';

/** What a new draft starts with. */
export interface ComposerSeed {
  to?: RecipientLike[];
  cc?: RecipientLike[];
  bcc?: RecipientLike[];
  subject?: string;
  body?: Block[];
  isMassSend?: boolean;
  parentMessageId?: string;
  templateId?: string;
}

export interface SignatureLike {
  id: string;
  body: Block[];
}

export interface ComposerApi {
  create(input: CreateDraftInput): Promise<Draft>;
  get(draftId: string): Promise<Draft>;
  update(input: UpdateDraftInput): Promise<Draft>;
  remove(draftId: string): Promise<void>;
  createAttachment(input: {
    draftId: string;
    id: string;
    name: string;
    contentType: string;
    size: number;
  }): Promise<{ attachment: DraftAttachment; uploadUrl: string }>;
  upload(url: string, file: Blob, contentType: string): Promise<void>;
  commitAttachment(input: { draftId: string; attachmentId: string }): Promise<DraftAttachment>;
  removeAttachment(input: { draftId: string; attachmentId: string }): Promise<void>;
  signature(mailboxId: string, signatureId: string): Promise<SignatureLike | null>;
  /** A change seq was learnt (mutation response): the next reads must not be older. */
  noteSeq?(seq: string | null): void;
}

export type SessionStatus = 'loading' | 'ready' | 'error';

export interface UploadRow {
  id: string;
  name: string;
  size: number;
  state: 'uploading' | 'failed';
  error?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  draft: Draft | null;
  error: string | null;
  uploads: UploadRow[];
  /** An autosave is in flight or scheduled. */
  saving: boolean;
  /** The last save failed (the next edit retries). */
  saveError: string | null;
  /** Blocks of the signature currently in the body (so it does not count as content). */
  signatureBlocks: Block[] | null;
  /** The draft was sent or deleted: the window closes. */
  finished: boolean;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const FIELD_ORDER = ['subject', 'body', 'to', 'cc', 'bcc', 'isMassSend', 'senderMailboxId', 'signatureId'] as const;
type Field = (typeof FIELD_ORDER)[number];

export interface SessionOptions {
  debounceMs?: number;
  newId: () => string;
}

const hasVariables = (draft: Pick<Draft, 'subject' | 'body'>): boolean =>
  (draft.subject.variables?.length ?? 0) > 0 || (draft.body as Block[]).some((b) => (b.variables?.length ?? 0) > 0);

export class ComposerSession {
  private snapshot: SessionSnapshot = {
    status: 'loading',
    draft: null,
    error: null,
    uploads: [],
    saving: false,
    saveError: null,
    signatureBlocks: null,
    finished: false,
  };
  private listeners = new Set<() => void>();
  private dirty = new Set<Field>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private disposed = false;

  constructor(
    readonly id: string,
    private readonly api: ComposerApi,
    private readonly options: SessionOptions,
  ) {}

  // ---- store -------------------------------------------------------------------------------------------------

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private patchDraft(patch: Partial<Draft>): void {
    const draft = this.snapshot.draft;
    if (!draft) return;
    const next = { ...draft, ...patch };
    next.hasVariables = hasVariables(next);
    this.set({ draft: next });
  }

  // ---- opening -----------------------------------------------------------------------------------------------

  /** Creates the draft (a seed given: new window) or loads it (reopened draft, page reload). */
  async start(seed?: ComposerSeed): Promise<void> {
    try {
      const draft = seed
        ? await this.api.create({
            id: this.id,
            ...(seed.subject ? { subject: { text: seed.subject, variables: [] } } : {}),
            ...(seed.body ? { body: seed.body } : {}),
            ...(seed.to ? { to: seed.to } : {}),
            ...(seed.cc ? { cc: seed.cc } : {}),
            ...(seed.bcc ? { bcc: seed.bcc } : {}),
            ...(seed.isMassSend !== undefined ? { isMassSend: seed.isMassSend } : {}),
            ...(seed.parentMessageId ? { parentMessageId: seed.parentMessageId } : {}),
            ...(seed.templateId ? { templateId: seed.templateId } : {}),
          })
        : await this.api.get(this.id);
      // The window shows the draft only once its starting text is final: a fresh blank draft gets the sender's
      // default signature below the caret (F settings §2.3) before the editors mount.
      this.set({ draft });
      if (draft.signatureId && draft.senderMailboxId) {
        if (seed) await this.insertDefaultSignature(draft);
        else await this.rememberSignature(draft);
      }
      this.set({ status: 'ready' });
    } catch (error) {
      this.set({ status: 'error', error: error instanceof Error ? error.message : 'Failed to open the draft' });
    }
  }

  private async rememberSignature(draft: Draft): Promise<void> {
    if (!draft.signatureId || !draft.senderMailboxId) return;
    const signature = await this.api.signature(draft.senderMailboxId, draft.signatureId).catch(() => null);
    if (signature && !this.disposed) this.set({ signatureBlocks: signature.body });
  }

  private async insertDefaultSignature(draft: Draft): Promise<void> {
    if (!draft.signatureId || !draft.senderMailboxId) return;
    const signature = await this.api.signature(draft.senderMailboxId, draft.signatureId).catch(() => null);
    if (!signature || this.disposed || signature.body.length === 0) return;
    const body = draft.body as Block[];
    const blank = body.every((b) => b.type !== 'image-embed' && b.text.trim() === '');
    if (blank && !draft.templateId && !draft.parentMessageId) {
      this.patchDraft({ body: withSignature(body, null, signature.body) as Draft['body'] });
      this.set({ signatureBlocks: signature.body });
      this.markDirty('body');
    } else {
      this.set({ signatureBlocks: signature.body });
    }
  }

  // ---- edits -------------------------------------------------------------------------------------------------

  private markDirty(field: Field): void {
    this.dirty.add(field);
    this.set({ saving: true });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.options.debounceMs ?? 600);
  }

  setSubject(value: LineValue): void {
    this.patchDraft({ subject: { text: value.text, variables: value.variables } as Draft['subject'] });
    this.markDirty('subject');
  }

  setBody(blocks: Block[]): void {
    this.patchDraft({ body: blocks as Draft['body'] });
    this.markDirty('body');
  }

  setRecipients(field: RecipientField, list: RecipientLike[]): void {
    this.patchDraft({
      [field]: list.map((r) => ({ emailAddress: r.emailAddress, name: r.name ?? null, record: r.record ?? null })),
    } as Partial<Draft>);
    this.markDirty(field);
  }

  setMassSend(on: boolean): void {
    this.patchDraft({ isMassSend: on });
    this.markDirty('isMassSend');
  }

  setSender(mailboxId: string): void {
    this.patchDraft({ senderMailboxId: mailboxId });
    this.markDirty('senderMailboxId');
  }

  /** The signature picked in the footer menu; the caller already changed the body. */
  setSignature(signatureId: string | null, blocks: Block[] | null): void {
    this.patchDraft({ signatureId });
    this.set({ signatureBlocks: blocks });
    this.markDirty('signatureId');
  }

  // ---- saving ------------------------------------------------------------------------------------------------

  /** Writes the pending fields now and resolves when nothing is pending (or the save failed). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight || this.dirty.size > 0) {
      if (this.inFlight) {
        await this.inFlight;
        if (this.snapshot.saveError) return;
        continue;
      }
      this.inFlight = this.writePending().finally(() => {
        this.inFlight = null;
      });
    }
    this.set({ saving: false });
  }

  private async writePending(): Promise<void> {
    const draft = this.snapshot.draft;
    if (!draft || this.snapshot.finished) {
      this.dirty.clear();
      return;
    }
    const fields = FIELD_ORDER.filter((f) => this.dirty.has(f));
    this.dirty.clear();
    const payload: UpdateDraftInput = { draftId: this.id };
    for (const f of fields) {
      if (f === 'subject') payload.subject = draft.subject;
      else if (f === 'body') payload.body = draft.body;
      else if (f === 'to' || f === 'cc' || f === 'bcc') {
        payload[f] = draft[f].map((r) => ({ emailAddress: r.emailAddress, name: r.name, record: r.record }));
      } else if (f === 'isMassSend') payload.isMassSend = draft.isMassSend;
      else if (f === 'senderMailboxId') {
        if (draft.senderMailboxId) payload.senderMailboxId = draft.senderMailboxId;
      } else if (f === 'signatureId') payload.signatureId = draft.signatureId;
    }
    try {
      const saved = await this.api.update(payload);
      this.set({ saveError: null });
      // The server resolves recipients to records: adopt that for lists that were not edited since.
      const adopt: Partial<Draft> = {};
      for (const f of ['to', 'cc', 'bcc'] as const) if (!this.dirty.has(f)) adopt[f] = saved[f];
      this.patchDraft({ ...adopt, revision: saved.revision, fieldUpdatedAt: saved.fieldUpdatedAt });
    } catch (error) {
      // Keep the fields dirty: the next edit (or an explicit flush) retries.
      for (const f of fields) this.dirty.add(f);
      this.set({ saveError: error instanceof Error ? error.message : 'Failed to save the draft', saving: false });
    }
  }

  // ---- attachments -------------------------------------------------------------------------------------------

  async addFiles(files: File[]): Promise<{ failed: { name: string; message: string }[] }> {
    const failed: { name: string; message: string }[] = [];
    for (const file of files) {
      const id = this.options.newId();
      const contentType = file.type || 'application/octet-stream';
      if (file.size > MAX_ATTACHMENT_BYTES) {
        failed.push({ name: file.name, message: 'Attachment is too large. Max size is 25 MB' });
        continue;
      }
      this.set({
        uploads: [...this.snapshot.uploads, { id, name: file.name, size: file.size, state: 'uploading' }],
      });
      try {
        // The draft exists on the server already; its attachment rows follow the three-step upload (B.23).
        const { attachment, uploadUrl } = await this.api.createAttachment({
          draftId: this.id,
          id,
          name: file.name,
          contentType,
          size: file.size,
        });
        await this.api.upload(uploadUrl, file, contentType);
        const committed = await this.api.commitAttachment({ draftId: this.id, attachmentId: attachment.id });
        const draft = this.snapshot.draft;
        this.set({ uploads: this.snapshot.uploads.filter((u) => u.id !== id) });
        if (draft) this.patchDraft({ attachments: [...draft.attachments.filter((a) => a.id !== id), committed] });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to upload attachment';
        this.set({ uploads: this.snapshot.uploads.filter((u) => u.id !== id) });
        // Best effort: a half-created attachment would block sending ("pending attachments").
        await this.api.removeAttachment({ draftId: this.id, attachmentId: id }).catch(() => undefined);
        failed.push({ name: file.name, message });
      }
    }
    return { failed };
  }

  async removeAttachment(attachmentId: string): Promise<void> {
    const draft = this.snapshot.draft;
    if (!draft) return;
    const before = draft.attachments;
    this.patchDraft({ attachments: before.filter((a) => a.id !== attachmentId) });
    try {
      await this.api.removeAttachment({ draftId: this.id, attachmentId });
    } catch (error) {
      this.patchDraft({ attachments: before });
      throw error;
    }
  }

  // ---- finishing ---------------------------------------------------------------------------------------------

  /** Whether closing the window should delete the draft. */
  isEmpty(): boolean {
    const draft = this.snapshot.draft;
    return draft ? isDraftEmpty(draft as never, this.snapshot.signatureBlocks) : false;
  }

  /** Delete draft (composer trash, Drafts list, an empty draft being closed). */
  async discard(): Promise<void> {
    this.dispose();
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight?.catch(() => undefined);
    await this.api.remove(this.id);
    this.set({ finished: true });
  }

  /** The window closed (not minimised): save what is pending, drop the draft if it is empty. */
  async close(): Promise<void> {
    if (this.snapshot.finished) return;
    await this.flush();
    if (this.snapshot.status === 'ready' && this.isEmpty()) {
      await this.api.remove(this.id).catch(() => undefined);
      this.set({ finished: true });
    }
    this.dispose();
  }

  /** Marks the draft as handed to the outbox (sent): the window closes without deleting anything. */
  sent(): void {
    this.set({ finished: true });
    this.dispose();
  }

  dispose(): void {
    this.disposed = true;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}
