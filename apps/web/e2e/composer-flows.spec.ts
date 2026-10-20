// Composer flows beyond the window itself (BACKLOG 7.06–7.07): single send through the outbox to the connector and a
// rejected email, email templates (create from the composer, use, favorite, rename, delete), the default signature, and
// the table's bulk "Send email" / reload / `c`.
import { expect, type Page, test } from '@playwright/test';
import { trpc, ws } from './slice3-support.ts';
import { ada, signedInAs } from './slice5-support.ts';
import { clearSignatures, seedSlice7 } from './slice7-support.ts';

interface DraftRow {
  id: string;
  subject: { text: string };
}

const drafts = (page: Page) => trpc<DraftRow[]>(page, 'email.drafts.list', undefined);
const outbox = (page: Page) => trpc<{ id: string; deliveryState: string }[]>(page, 'email.outbox.list', undefined);
const composer = (page: Page) => page.getByTestId('composer');

async function openPage(browser: import('@playwright/test').Browser, path = ws('emails/drafts')) {
  await seedSlice7(browser);
  const session = await signedInAs(browser, ada(), path);
  for (const d of await drafts(session.page)) await trpc(session.page, 'email.drafts.delete', { draftId: d.id });
  await trpc(session.page, 'email.outbox.cancel', { all: true });
  await clearSignatures(session.page);
  await session.page.reload();
  return session;
}

async function addRecipient(page: Page, query: string) {
  await page.getByTestId('composer-to-input').fill(query);
  await page.getByTestId('recipient-suggestion').first().click();
}

const rejectedSubject = `Will be rejected ${Date.now()}`;

test('a single email goes through the outbox to the connector; a rejected one shows its failure', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page } = await openPage(browser);
  await page.getByTestId('compose-email').first().click();
  await composer(page).waitFor();
  await addRecipient(page, 'jane');
  await page.getByTestId('composer-subject').click();
  await page.keyboard.type('Single send subject');
  await page.getByTestId('composer-body').click();
  await page.keyboard.type('Plain body');
  await expect(page.getByTestId('composer-primary')).toHaveText('Send email');
  await page.getByTestId('composer-primary').click();
  await composer(page).waitFor({ state: 'detached' });
  await expect(page.getByText('Email sent')).toBeVisible();
  // The worker hands it to the test connector (nothing is delivered anywhere).
  const mailboxes = await trpc<{ id: string; emailAddress: string }[]>(page, 'mailboxes.list', {});
  const mailbox = mailboxes.find((m) => m.emailAddress === 'ada@mymeet.ai');
  await expect
    .poll(
      async () =>
        (await trpc<{ message: { subject: string } }[]>(page, 'connectors.test.sent', { mailboxId: mailbox?.id })).some(
          (m) => m.message.subject === 'Single send subject',
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  // A recipient at fail.test simulates a rejection: the outbox shows "Failed" with the reason.
  await page.getByTestId('compose-email').first().click();
  await composer(page).waitFor();
  await page.getByTestId('composer-to-input').fill('rejected@fail.test');
  await page.getByTestId('recipient-suggestion').first().click();
  await page.getByTestId('composer-subject').click();
  await page.keyboard.type(rejectedSubject);
  await page.getByTestId('composer-body').click();
  await page.keyboard.type('x');
  await page.getByTestId('composer-primary').click();
  await composer(page).waitFor({ state: 'detached' });
  await expect
    .poll(async () => (await outbox(page)).some((o) => o.deliveryState === 'failed'), { timeout: 30_000 })
    .toBe(true);
  await page.goto(ws('emails/outbox'));
  const failed = page.locator('[data-testid="outbox-item"][data-state="failed"]').filter({ hasText: rejectedSubject });
  await expect(failed).toHaveCount(1);
  await expect(failed).toContainText('Failed');
  await failed.click();
  await expect(page.getByTestId('outbox-failure')).toContainText('The email provider rejected the email');
  // A failed email cannot be cancelled.
  await expect(page.getByRole('button', { name: 'Email options' })).toHaveCount(0);
  await context.close();
});

test('create an email template from the composer, use it, favorite it, rename and delete it', async ({ browser }) => {
  const { context, page } = await openPage(browser);
  for (const t of await trpc<{ id: string }[]>(page, 'email.templates.list', undefined)) {
    await trpc(page, 'email.templates.delete', { templateId: t.id });
  }
  await page.reload();
  await page.getByTestId('compose-email').first().click();
  await composer(page).waitFor();
  await page.getByTestId('composer-create-template').click();
  await page.getByTestId('composer-template').waitFor();
  await expect(page.getByTestId('template-title')).toHaveText('Untitled Template');
  await page.getByTestId('template-subject').click();
  await page.keyboard.type('Template subject');
  await page.getByTestId('template-body').click();
  await page.keyboard.type('Hi {');
  await page.getByTestId('variable-menu').waitFor();
  await page.getByRole('menuitem', { name: /^Name/ }).click();
  await page.getByRole('menuitem', { name: 'First' }).click();
  // Focus returns to the editor once the menu is gone (the page is inert while it is open).
  await expect(page.getByTestId('template-body')).toBeFocused();
  await page.keyboard.type(', this is a seed template body.');
  await expect
    .poll(async () => (await trpc<{ preview: string }[]>(page, 'email.templates.list', undefined))[0]?.preview)
    .toBe('Hi {{first_name}}, this is a seed template body.');
  // Options menu offers favorites and delete.
  await page.getByTestId('template-options').click();
  await expect(page.getByRole('menuitem', { name: 'Add to favorites' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete template' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Use template: a new draft with subject and body copied, the variable kept.
  await page.getByTestId('use-template').click();
  await expect(page.getByTestId('composer-subject')).toHaveText('Template subject');
  await expect(page.getByTestId('composer-body')).toContainText('this is a seed template body.');
  await expect(composer(page).locator('.agentic-crm-variable')).toHaveText('{ Name › First }');
  await page.keyboard.press('Escape');
  await composer(page).waitFor({ state: 'detached' });

  // Templates page: the card, the favorites strip, the dialog with an editable title, delete.
  await page.goto(ws('emails/templates'));
  const card = page.getByTestId('email-template-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Untitled Template');
  await expect(card).toContainText('Template subject');
  await expect(card).toContainText('Hi {{first_name}}, this is a seed template body.');
  await card.hover();
  await card.getByRole('button', { name: 'Email template options' }).click();
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  await expect(page.getByTestId('favorites-strip').getByTestId('email-template-card')).toHaveCount(1);
  await card.last().click();
  const title = page.getByTestId('template-title-input');
  await title.fill('Welcome template');
  await title.press('Enter');
  await expect
    .poll(async () => (await trpc<{ title: string }[]>(page, 'email.templates.list', undefined))[0]?.title)
    .toBe('Welcome template');
  await page.getByTestId('template-editor').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('email-template-card').first()).toContainText('Welcome template');
  const last = page.getByTestId('email-template-card').last();
  await last.hover();
  await last.getByRole('button', { name: 'Email template options' }).click();
  await page.getByRole('menuitem', { name: 'Delete template' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('email-template-card')).toHaveCount(0);
  await expect(page.getByTestId('emails-empty')).toBeVisible();
  await context.close();
});

test('a default signature starts a new draft and does not count as content', async ({ browser }) => {
  const { context, page } = await openPage(browser);
  const mailboxes = await trpc<{ id: string; emailAddress: string }[]>(page, 'mailboxes.list', {});
  const mailbox = mailboxes.find((m) => m.emailAddress === 'ada@mymeet.ai');
  for (const sig of await trpc<{ id: string }[]>(page, 'email.signatures.list', { mailboxId: mailbox?.id })) {
    await trpc(page, 'email.signatures.delete', { signatureId: sig.id });
  }
  await trpc(page, 'email.signatures.create', {
    id: crypto.randomUUID(),
    mailboxId: mailbox?.id,
    title: 'Work',
    body: [
      { type: 'unstyled', indent: 0, text: 'Best regards,', styles: [], mentions: [] },
      { type: 'unstyled', indent: 0, text: 'Ada Tester', styles: [], mentions: [] },
    ],
  });
  await page.getByTestId('compose-email').first().click();
  await composer(page).waitFor();
  await expect(page.getByTestId('composer-body')).toContainText('Best regards,');
  await expect(page.getByTestId('composer-body')).toContainText('Ada Tester');
  // Only the signature: closing deletes the draft.
  await page.getByTestId('composer-subject').click();
  await page.keyboard.press('Escape');
  await composer(page).waitFor({ state: 'detached' });
  await expect.poll(async () => (await drafts(page)).length).toBe(0);
  // The footer menu removes and re-adds it.
  await page.getByTestId('compose-email').first().click();
  await composer(page).waitFor();
  await page.getByTestId('composer-signature').click();
  await page.getByRole('menuitem', { name: 'No signature' }).click();
  await expect(page.getByTestId('composer-body')).not.toContainText('Best regards,');
  await page.getByTestId('composer-signature').click();
  await page.getByRole('menuitem', { name: 'Work' }).click();
  await expect(page.getByTestId('composer-body')).toContainText('Best regards,');
  await context.close();
});

test('the table sends mass email, the composer survives a reload and opens with c', async ({ browser }) => {
  const { context, page } = await openPage(browser, ws('people'));
  const rows = page.getByRole('checkbox', { name: /^(Select|Deselect) row$/ });
  await rows.nth(0).waitFor();
  await rows.nth(0).click();
  await rows.nth(1).click();
  await page.getByTestId('bulk-bar').getByRole('button', { name: 'Send email' }).click();
  await composer(page).waitFor();
  await expect(composer(page)).toHaveAttribute('data-mass', 'true');
  await expect(page.getByTestId('recipient-row')).not.toHaveCount(0);
  const count = await page.getByTestId('recipient-row').count();
  await expect(page.getByTestId('composer-mass-chip')).toContainText(`${count} recipient`);
  await page.getByTestId('composer-subject').click();
  await page.keyboard.type('Reload me');
  await expect.poll(async () => (await drafts(page))[0]?.subject.text).toBe('Reload me');
  // The URL carries the draft: a reload brings the window back with its content.
  await expect(page).toHaveURL(/modal=composer&id=/);
  await page.reload();
  await composer(page).waitFor();
  await expect(page.getByTestId('composer-subject')).toHaveText('Reload me');
  await expect(composer(page)).toHaveAttribute('data-mass', 'true');
  await page.keyboard.press('Escape');
  await composer(page).waitFor({ state: 'detached' });
  // `c` opens a new draft (from a quiet spot of the page).
  await page.getByTestId('page-header').click({ position: { x: 700, y: 20 } });
  await page.keyboard.press('c');
  await composer(page).waitFor();
  await page.keyboard.press('Escape');
  await composer(page).waitFor({ state: 'detached' });
  await context.close();
});
