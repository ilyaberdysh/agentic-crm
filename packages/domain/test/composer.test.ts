// Composer server side (BACKLOG 7.06–7.07; F composer §2–6; acceptance 4 server data): drafts autosave per field,
// privacy, review with merged variables / fallbacks / blocking issues, send → outbox → test connector delivery,
// failure reasons and retries, cancel, templates (documents) and "use template", signatures (first = default),
// variable values.

import { sql } from '@agentic-crm/db';
import type { Block } from '@agentic-crm/editor/model';
import { describe, expect, it } from 'vitest';
import { FAILURE_REASONS } from '../src/index.ts';
import { documentRow } from './collab-fixtures.ts';
import { type EmailFixture, emailFixture, iso, plainMember } from './email-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

const firstName = (fallback: string | null = null) => ({
  start: 3,
  length: 1 as const,
  path: [{ entityDefinitionId: 'people', attributeDefinitionId: 'name' }],
  field: 'first_name',
  fallback,
  label: 'Name › First',
});

const body = (text: string, variables: Block['variables'] = []): Block[] => [
  { type: 'unstyled', indent: 0, text, styles: [], mentions: [], variables },
];

async function person(f: EmailFixture, email: string, first?: string) {
  const id = newId();
  await domain.records.create(f.ctx, {
    entityDefinitionId: 'people',
    entityInstanceId: id,
    values: {
      email_addresses: [{ value: email }],
      ...(first ? { name: [{ value: { firstName: first, lastName: 'Doe' } }] } : {}),
    },
  });
  return id;
}

describe('drafts', () => {
  it('autosave writes only the given fields, stamps them and bumps the revision', async () => {
    const f = await emailFixture();
    const draftId = newId();
    const created = await domain.email.drafts.create(f.ctx, { id: draftId });
    expect(created).toMatchObject({ revision: 1, senderMailboxId: f.ada.mailboxId, isMassSend: false, to: [] });
    expect(Object.keys(created.fieldUpdatedAt).sort()).toEqual(
      ['bcc', 'body', 'cc', 'isMassSend', 'senderMailboxId', 'subject', 'to'].sort(),
    );
    const subjectSaved = await domain.email.drafts.update(f.ctx, {
      draftId,
      subject: { text: 'Hello', variables: [] },
    });
    const bodySaved = await domain.email.drafts.update(f.ctx, { draftId, body: body('Line one') as never });
    expect(bodySaved).toMatchObject({ revision: 3, subject: { text: 'Hello' }, preview: 'Line one' });
    expect(bodySaved.fieldUpdatedAt.subject).toBe(subjectSaved.fieldUpdatedAt.subject);
    expect((bodySaved.fieldUpdatedAt.body as string) > (subjectSaved.fieldUpdatedAt.body as string)).toBe(true);
    // Recipients are matched to people by address.
    const janeId = await person(f, `jane@acme-${f.tag}.com`, 'Jane');
    const withTo = await domain.email.drafts.update(f.ctx, {
      draftId,
      to: [{ emailAddress: `Jane@Acme-${f.tag}.com`, name: 'Jane' }, { emailAddress: `jane@acme-${f.tag}.com` }],
    });
    expect(withTo.to).toEqual([
      {
        emailAddress: `Jane@Acme-${f.tag}.com`,
        name: 'Jane',
        record: { entityDefinitionId: f.people, entityInstanceId: janeId },
      },
    ]);
    // Idempotent create; drafts are private; listing; delete.
    expect((await domain.email.drafts.create(f.ctx, { id: draftId })).revision).toBe(4);
    const bob = await plainMember(f, 'Bob');
    await expectCode(domain.email.drafts.get(bob.ctx, draftId), 'NOT_FOUND', 404);
    expect((await domain.email.drafts.list(bob.ctx)).length).toBe(0);
    expect((await domain.email.drafts.list(f.ctx)).map((d) => d.id)).toEqual([draftId]);
    await domain.email.drafts.delete(f.ctx, draftId);
    expect(await domain.email.drafts.list(f.ctx)).toEqual([]);
    await expectCode(
      domain.email.drafts.update(f.ctx, { draftId, subject: { text: 'x', variables: [] } }),
      'NOT_FOUND',
      404,
    );
  });
});

describe('review and send', () => {
  it('mass send with an unfilled variable stops at review; fallbacks fill it; send queues one email per recipient', async () => {
    const f = await emailFixture();
    const jane = await person(f, `jane@acme-${f.tag}.com`, 'Jane');
    await person(f, `nameless@acme-${f.tag}.com`);
    const draftId = newId();
    await domain.email.drafts.create(f.ctx, {
      id: draftId,
      subject: { text: 'Hi _', variables: [{ ...firstName(), start: 3 }] },
      body: body('Hi _, welcome!', [firstName()]) as never,
      to: [{ emailAddress: `jane@acme-${f.tag}.com` }, { emailAddress: `nameless@acme-${f.tag}.com` }],
    });
    // Variables with several recipients need mass send.
    let review = await domain.email.drafts.review(f.ctx, draftId);
    expect(review.issues).toContain('variables-need-mass-send');
    await domain.email.drafts.update(f.ctx, { draftId, isMassSend: true });
    review = await domain.email.drafts.review(f.ctx, draftId);
    expect(review.issues).toEqual(['unresolved-variables']);
    expect(review.canSend).toBe(false);
    expect(review.emails.map((e) => [e.recipient.emailAddress, e.subject, e.bodyText, e.missing.length])).toEqual([
      [`jane@acme-${f.tag}.com`, 'Hi Jane', 'Hi Jane, welcome!', 0],
      [`nameless@acme-${f.tag}.com`, 'Hi ', 'Hi , welcome!', 2],
    ]);
    expect(review.emails[1]?.missing[0]).toMatchObject({
      location: 'subject',
      label: 'Name › First',
      field: 'first_name',
    });
    expect(review.emails[0]?.recipient.record).toEqual({ entityDefinitionId: f.people, entityInstanceId: jane });
    await expectCode(domain.email.drafts.send(f.ctx, { draftId }), 'DRAFT_NOT_SENDABLE', 400);

    // A fallback resolves the empty value.
    await domain.email.drafts.update(f.ctx, {
      draftId,
      subject: { text: 'Hi _', variables: [{ ...firstName('there'), start: 3 }] },
      body: body('Hi _, welcome!', [firstName('there')]) as never,
    });
    review = await domain.email.drafts.review(f.ctx, draftId);
    expect(review.canSend).toBe(true);
    expect(review.emails[1]).toMatchObject({ subject: 'Hi there', bodyHtml: '<p>Hi there, welcome!</p>' });

    const sent = await domain.email.drafts.send(f.ctx, { draftId });
    expect(sent.outbox).toHaveLength(2);
    expect(sent.outbox.map((o) => [o.source, o.deliveryState, o.to[0]?.emailAddress])).toEqual([
      ['mass-send', 'scheduled', `jane@acme-${f.tag}.com`],
      ['mass-send', 'scheduled', `nameless@acme-${f.tag}.com`],
    ]);
    // Mass sends are spaced 5 minutes apart; the draft is closed.
    const [a, b] = sent.outbox;
    expect(Date.parse(b?.deliveryScheduledAt as string) - Date.parse(a?.deliveryScheduledAt as string)).toBe(300_000);
    expect(await domain.email.drafts.list(f.ctx)).toEqual([]);
    await expectCode(domain.email.drafts.send(f.ctx, { draftId }), 'EMAIL_STATE_CONFLICT', 409);

    // Delivery through the test connector: the first now, the second when due.
    let result = await domain.email.outbox.deliverDue(f.workspaceId);
    expect(result).toMatchObject({ sent: 1, failed: 0 });
    result = await domain.email.outbox.deliverDue(f.workspaceId, { now: iso(0.1) });
    expect(result).toMatchObject({ sent: 1 });
    const recorded = await domain.connectors.test.sent(f.ctx, f.ada.mailboxId);
    expect(recorded.map((r) => (r.message as { subject: string }).subject).sort()).toEqual(['Hi Jane', 'Hi there']);
    expect(await domain.email.outbox.list(f.ctx)).toEqual([]);
    // The sent copies come back through sync as outbound messages on the recipients' records.
    await domain.mailboxes.sync(f.ctx, { mailboxId: f.ada.mailboxId, wait: true });
    const threads = await domain.email.threads(f.ctx, {
      record: { entityDefinitionId: 'people', entityInstanceId: jane },
    });
    expect(threads.threads.map((t) => t.subject)).toEqual(['Hi Jane']);
  });

  it('single send checks recipients, sender and attachments', async () => {
    const f = await emailFixture();
    const draftId = newId();
    await domain.email.drafts.create(f.ctx, { id: draftId, subject: { text: 'Hello', variables: [] } });
    expect((await domain.email.drafts.review(f.ctx, draftId)).issues).toEqual(['no-recipients']);
    await domain.email.drafts.update(f.ctx, { draftId, to: [{ emailAddress: `x@y-${f.tag}.com` }] });
    const upload = await domain.email.drafts.attachments.create(f.ctx, {
      draftId,
      id: newId(),
      name: 'notes.txt',
      contentType: 'text/plain',
      size: 5,
    });
    expect(upload.uploadUrl).toContain('message-attachments');
    expect((await domain.email.drafts.review(f.ctx, draftId)).issues).toEqual(['pending-attachments']);
    await expectCode(
      domain.email.drafts.attachments.create(f.ctx, {
        draftId,
        id: newId(),
        name: 'big',
        contentType: 'x/y',
        size: 26 * 1024 * 1024,
      }),
      'VALIDATION_ERROR',
      400,
    );
    await domain.email.drafts.attachments.remove(f.ctx, { draftId, attachmentId: upload.attachment.id });
    expect((await domain.email.drafts.review(f.ctx, draftId)).canSend).toBe(true);
    // A member without a mailbox has no sender.
    const bob = await plainMember(f, 'Bob');
    const bobDraft = newId();
    await domain.email.drafts.create(bob.ctx, {
      id: bobDraft,
      subject: { text: 'x', variables: [] },
      to: [{ emailAddress: 'a@b.io' }],
    });
    expect((await domain.email.drafts.review(bob.ctx, bobDraft)).issues).toEqual(['no-sender']);
  });

  it('failure reasons, retries and cancel', async () => {
    const f = await emailFixture();
    const send = async (to: string) => {
      const id = newId();
      await domain.email.drafts.create(f.ctx, {
        id,
        subject: { text: `To ${to}`, variables: [] },
        to: [{ emailAddress: to }],
      });
      return (await domain.email.drafts.send(f.ctx, { draftId: id })).outbox[0]?.id as string;
    };
    const rejected = await send('rejected@fail.test');
    const limited = await send('rate-limited@fail.test');
    const later = await send(`later@ok-${f.tag}.com`);
    // Push one email into the future so it can be cancelled.
    await sql`UPDATE outbound_emails SET delivery_scheduled_at = now() + interval '1 day' WHERE id = ${later}`.execute(
      database.kysely,
    );
    const result = await domain.email.outbox.deliverDue(f.workspaceId);
    expect(result).toMatchObject({ sent: 0, failed: 1, retried: 1 });
    let outbox = await domain.email.outbox.list(f.ctx);
    const byId = new Map(outbox.map((o) => [o.id, o]));
    expect(byId.get(rejected)).toMatchObject({
      deliveryState: 'failed',
      lastErrorCode: 'provider_rejected_request',
      failureReason: FAILURE_REASONS.provider_rejected_request,
    });
    expect(byId.get(limited)).toMatchObject({
      deliveryState: 'error',
      lastErrorCode: 'provider_rate_limited',
      attempts: 1,
    });
    // Retries until the attempt limit, then max_delivery_attempts_exceeded.
    for (let i = 0; i < 10; i++) await domain.email.outbox.deliverDue(f.workspaceId, { now: iso(2 + i) });
    outbox = await domain.email.outbox.list(f.ctx, { now: iso(12) });
    expect(outbox.find((o) => o.id === limited)).toMatchObject({
      deliveryState: 'failed',
      lastErrorCode: 'max_delivery_attempts_exceeded',
      attempts: 7,
      failureReason: 'The email could not be delivered after several attempts',
    });
    // Cancel.
    await expectCode(domain.email.outbox.cancel(f.ctx, { ids: [rejected] }), 'EMAIL_STATE_CONFLICT', 409);
    const canceled = await domain.email.outbox.cancel(f.ctx, { all: true });
    expect(canceled.map((c) => [c.id, c.deliveryState])).toEqual([[later, 'canceled']]);
    // A removed sender mailbox fails with mailbox_disconnected.
    const last = await send(`gone@ok-${f.tag}.com`);
    await domain.mailboxes.disconnect(f.ctx, f.ada.mailboxId);
    await domain.email.outbox.deliverDue(f.workspaceId);
    expect((await domain.email.outbox.list(f.ctx)).find((o) => o.id === last)).toMatchObject({
      lastErrorCode: 'mailbox_disconnected',
      failureReason: 'The connected email account was disconnected — please reconnect it',
    });
  });
});

describe('templates, signatures, variables', () => {
  it('templates are documents; "use template" copies subject and body with variables', async () => {
    const f = await emailFixture();
    const templateId = newId();
    const template = await domain.email.templates.create(f.ctx, {
      id: templateId,
      title: 'Welcome',
      subject: { text: 'Welcome _', variables: [{ ...firstName(), start: 8 }] },
      body: body('Hi _!', [firstName('friend')]) as never,
    });
    expect(template).toMatchObject({ title: 'Welcome', preview: 'Hi {{first_name}}!', isFavorite: false });
    expect(template.subject).toMatchObject({ text: 'Welcome _', variables: [{ start: 8, field: 'first_name' }] });
    const doc = await documentRow(template.bodyDocumentId);
    expect(doc).toMatchObject({ doc_type: 'email-template', parent_ref: templateId });
    // Every member sees and edits templates; favourites are per member.
    const bob = await plainMember(f, 'Bob');
    await domain.email.templates.update(bob.ctx, { templateId, title: 'Welcome!' });
    await domain.email.templates.favorite(bob.ctx, { templateId, favorite: true });
    expect((await domain.email.templates.get(bob.ctx, templateId)).isFavorite).toBe(true);
    expect(await domain.email.templates.get(f.ctx, templateId)).toMatchObject({ title: 'Welcome!', isFavorite: false });
    expect(await domain.documents.resolveAccess(bob.ctx, template.bodyDocumentId)).toBe('edit');

    const draft = await domain.email.drafts.create(f.ctx, { id: newId(), templateId });
    expect(draft).toMatchObject({ templateId, hasVariables: true, subject: { text: 'Welcome _' } });
    expect((draft.body[0] as Block).variables?.[0]).toMatchObject({ field: 'first_name', fallback: 'friend' });

    await domain.email.templates.delete(f.ctx, templateId);
    expect(await domain.email.templates.list(f.ctx)).toEqual([]);
  });

  it('signatures: the first is the default; owner-only; deleting the default clears it', async () => {
    const f = await emailFixture();
    const first = await domain.email.signatures.create(f.ctx, {
      id: newId(),
      mailboxId: f.ada.mailboxId,
      body: body('Ada Lovelace — CEO') as never,
    });
    expect(first).toMatchObject({ title: 'New signature', isDefault: true });
    const second = await domain.email.signatures.create(f.ctx, {
      id: newId(),
      mailboxId: f.ada.mailboxId,
      title: 'Short',
    });
    expect(second.isDefault).toBe(false);
    await domain.email.signatures.setDefault(f.ctx, { signatureId: second.id, isDefault: true });
    expect((await domain.mailboxes.get(f.ctx, f.ada.mailboxId)).defaultSignatureId).toBe(second.id);
    // New drafts pick the default signature of the sender mailbox.
    expect((await domain.email.drafts.create(f.ctx, { id: newId() })).signatureId).toBe(second.id);
    const bob = await plainMember(f, 'Bob');
    await expectCode(domain.email.signatures.list(bob.ctx, f.ada.mailboxId), 'NOT_FOUND', 404);
    expect(await domain.documents.resolveAccess(bob.ctx, first.documentId)).toBe('none');
    await domain.email.signatures.delete(f.ctx, second.id);
    expect((await domain.mailboxes.get(f.ctx, f.ada.mailboxId)).defaultSignatureId).toBeNull();
    expect((await domain.email.signatures.list(f.ctx, f.ada.mailboxId)).map((s) => s.id)).toEqual([first.id]);
  });

  it('variable values walk relationships and sub-fields', async () => {
    const f = await emailFixture();
    const company = newId();
    await domain.records.create(f.ctx, {
      entityDefinitionId: 'companies',
      entityInstanceId: company,
      values: { name: [{ value: 'Acme' }], domains: [{ value: `acme-${f.tag}.com` }] },
    });
    const jane = await person(f, `jane@acme-${f.tag}.com`, 'Jane');
    await domain.records.update(f.ctx, {
      entityDefinitionId: 'people',
      entityInstanceId: jane,
      values: { company: [{ value: { entityInstanceId: company } }], job_title: [{ value: 'CTO' }] },
    });
    const { values } = await domain.email.variables(f.ctx, {
      records: [{ entityDefinitionId: 'people', entityInstanceId: jane }],
      variables: [
        { path: [{ attributeDefinitionId: 'name' }], field: 'first_name', fallback: null },
        { path: [{ attributeDefinitionId: 'name' }], field: null, fallback: null },
        {
          path: [{ attributeDefinitionId: 'company' }, { attributeDefinitionId: 'name' }],
          field: null,
          fallback: null,
        },
        {
          path: [{ attributeDefinitionId: 'company' }, { attributeDefinitionId: 'domains' }],
          field: null,
          fallback: null,
        },
        { path: [{ attributeDefinitionId: 'job_title' }], field: null, fallback: null },
        { path: [{ attributeDefinitionId: 'description' }], field: null, fallback: 'n/a' },
        { path: [{ entityDefinitionId: 'companies', attributeDefinitionId: 'name' }], field: null, fallback: null },
      ],
    });
    expect(values[jane]).toEqual(['Jane', 'Jane Doe', 'Acme', `acme-${f.tag}.com`, 'CTO', null, null]);
  });
});
