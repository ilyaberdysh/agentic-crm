// Composer (BACKLOG 7.06–7.07; F composer.md; acceptance 4): opening and closing, autosave per field, variables and
// fallbacks, window modes (minimise, pin, expand), attachments, mass sending with the review step (an unfilled variable
// stops there), the outbox (cancel), drafts list, templates, signature, and the table's "Send email".
import { expect, type Page, test } from '@playwright/test';
import { trpc, ws } from './slice3-support.ts';
import { ada, signedInAs } from './slice5-support.ts';
import { clearSignatures, seedSlice7 } from './slice7-support.ts';

interface DraftRow {
  id: string;
  subject: { text: string };
  fieldUpdatedAt: Record<string, string>;
  isMassSend: boolean;
  to: { emailAddress: string; record: unknown }[];
  attachments: { name: string; state: string }[];
  body: { text: string }[];
}

const drafts = (page: Page) => trpc<DraftRow[]>(page, 'email.drafts.list', undefined);
/** The outbox without failures: those stay listed for three months (an earlier spec leaves one behind). */
const outbox = async (page: Page) =>
  (
    await trpc<{ id: string; deliveryState: string; subject: string; source: string }[]>(
      page,
      'email.outbox.list',
      undefined,
    )
  ).filter((o) => o.deliveryState !== 'failed');

async function clean(page: Page): Promise<void> {
  for (const d of await drafts(page)) await trpc(page, 'email.drafts.delete', { draftId: d.id });
  await trpc(page, 'email.outbox.cancel', { all: true });
  await clearSignatures(page);
}

async function openPage(browser: import('@playwright/test').Browser, path = ws('emails/drafts')) {
  const seed = await seedSlice7(browser);
  const session = await signedInAs(browser, ada(), path);
  void seed;
  await clean(session.page);
  await session.page.reload();
  return session;
}

const composer = (page: Page) => page.getByTestId('composer');

async function addRecipient(page: Page, query: string, field = 'composer-to') {
  await page.getByTestId(`${field}-input`).fill(query);
  await page.getByTestId('recipient-suggestion').first().click();
}

test.describe('composer window', () => {
  test('creates the draft at once, deletes it when closed empty and keeps it with content', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await expect.poll(async () => (await drafts(page)).length).toBe(1);
    await expect(page.getByTestId('emails-count-drafts')).toHaveText('1');
    // Esc closes the window; an empty draft goes away.
    await page.keyboard.press('Escape');
    await composer(page).waitFor({ state: 'detached' });
    await expect.poll(async () => (await drafts(page)).length).toBe(0);
    await expect(page.getByTestId('emails-count-drafts')).toHaveText('0');

    // With a subject the draft stays and reopens from the list.
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Keep me');
    await page.getByTestId('composer-body').click();
    await page.keyboard.type('Some body text');
    await page.keyboard.press('Escape');
    await composer(page).waitFor({ state: 'detached' });
    await expect(page.getByTestId('draft-row')).toHaveCount(1);
    await expect(page.getByTestId('draft-subject')).toHaveText('Keep me');
    await expect(page.getByTestId('draft-preview')).toHaveText('Some body text');
    await page.getByTestId('draft-row').click();
    await composer(page).waitFor();
    await expect(page.getByTestId('composer-subject')).toHaveText('Keep me');
    await expect(page.getByTestId('composer-body')).toContainText('Some body text');
    await context.close();
  });

  test('autosaves each field on its own', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('First subject');
    await expect.poll(async () => (await drafts(page))[0]?.subject.text).toBe('First subject');
    const before = (await drafts(page))[0]?.fieldUpdatedAt ?? {};
    await page.waitForTimeout(1100);
    await page.getByTestId('composer-body').click();
    await page.keyboard.type('Then the body');
    await expect
      .poll(async () => (await drafts(page))[0]?.body.map((b) => b.text).join('\n'))
      .toContain('Then the body');
    const after = (await drafts(page))[0]?.fieldUpdatedAt ?? {};
    // The subject was not rewritten: its stamp is the one from before the body edit.
    expect(after.subject).toBe(before.subject);
    expect(Date.parse(after.body ?? '')).toBeGreaterThan(Date.parse(before.body ?? ''));
    await addRecipient(page, 'jane');
    await expect
      .poll(async () => (await drafts(page))[0]?.to[0]?.emailAddress)
      .toBe('jane.cooper@northwind.example.com');
    expect((await drafts(page))[0]?.to[0]?.record).toBeTruthy();
    await context.close();
  });

  test('variables: the { menu, chip colours, fallback, Review replaces Send', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await addRecipient(page, 'jane');
    await expect(page.getByTestId('composer-primary')).toHaveText('Send email');
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Hello {');
    await page.getByTestId('variable-menu').waitFor();
    await page.getByRole('menuitem', { name: /^Name/ }).click();
    await page.getByRole('menuitem', { name: 'First' }).click();
    const chip = composer(page).locator('.agentic-crm-variable');
    await expect(chip).toHaveText('{ Name › First }');
    await expect(chip).not.toHaveAttribute('data-variable-fallback', /.*/);
    await expect(page.getByTestId('composer-primary')).toHaveText('Review');
    // Fallback turns the chip blue (info).
    await chip.click();
    await page.getByTestId('variable-fallback').fill('there');
    await page.keyboard.press('Enter');
    await expect(chip).toHaveAttribute('data-variable-fallback', 'there');
    await expect.poll(async () => (await drafts(page))[0]?.subject.text).toBe('Hello _');
    // Variables with one recipient: the To input is disabled until mass sending is on.
    await expect(page.getByTestId('composer-to-input')).toBeDisabled();
    // Delete the chip from its popover: back to a plain Send.
    await chip.click();
    await page.getByRole('button', { name: 'Delete variable' }).click();
    await expect(chip).toHaveCount(0);
    await expect(page.getByTestId('composer-primary')).toHaveText('Send email');
    await context.close();
  });

  test('minimise to the dock, pin to the screen and expand keep the content', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Window modes');
    await page.getByTestId('composer-body').click();
    await page.keyboard.type('Body survives');
    // Minimise → a 32 px bubble, the subject as tooltip.
    await page.getByRole('button', { name: 'Minimize' }).click();
    await composer(page).waitFor({ state: 'detached' });
    const bubble = page.locator('[data-testid="dock-bubble"][data-kind="composer"]');
    await expect(bubble).toHaveCount(1);
    await expect(bubble.getByRole('button').first()).toHaveAttribute('aria-label', /Window modes/);
    // The draft is still there (minimising is not closing).
    expect((await drafts(page)).length).toBe(1);
    // Click the bubble → pinned panel (page interactive, no dimming).
    await bubble.getByRole('button').first().click();
    const pinned = page.getByTestId('window-floating');
    await expect(pinned).toBeVisible();
    const box = await pinned.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(456);
    await expect(pinned.getByTestId('composer-subject')).toHaveText('Window modes');
    await expect(pinned.getByTestId('composer-body')).toContainText('Body survives');
    await expect(pinned.getByTestId('mass-switch')).toHaveCount(0);
    // Expand → the modal again.
    await pinned.getByRole('button', { name: 'Expand' }).click();
    await expect(page.getByTestId('window-modal').getByTestId('composer-subject')).toHaveText('Window modes');
    // Pin straight from the modal, then close with × (content kept as a draft).
    await page.getByRole('button', { name: 'Pin to screen' }).click();
    await expect(page.getByTestId('window-floating')).toBeVisible();
    await page.getByTestId('window-floating').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('window-floating')).toHaveCount(0);
    expect((await drafts(page)).length).toBe(1);
    await context.close();
  });

  test('attachments: add, show a card, remove', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-file-input').setInputFiles({
      name: 'seed-attachment.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('twenty-nine bytes of seed ok!'),
    });
    const card = page.getByTestId('composer-attachment');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('seed-attachment.txt');
    await expect(card).toContainText('29 bytes');
    await expect(card).toContainText('TXT');
    await expect.poll(async () => (await drafts(page))[0]?.attachments[0]?.state).toBe('committed');
    await card.getByRole('button', { name: 'Remove' }).click();
    await expect(card).toHaveCount(0);
    await expect.poll(async () => (await drafts(page))[0]?.attachments.length).toBe(0);
    await context.close();
  });

  test('delete draft asks for confirmation; the drafts list deletes at once', async ({ browser }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Delete me');
    await page.getByTestId('composer-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    expect((await drafts(page)).length).toBe(1);
    await page.getByTestId('composer-delete').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    await composer(page).waitFor({ state: 'detached' });
    await expect(page.getByText('Draft deleted')).toBeVisible();
    await expect.poll(async () => (await drafts(page)).length).toBe(0);
    await expect(page.getByTestId('emails-empty')).toBeVisible();

    // Row menu: Delete draft without a confirmation.
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Row delete');
    await page.keyboard.press('Escape');
    await composer(page).waitFor({ state: 'detached' });
    await page.getByTestId('draft-row').hover();
    await page.getByTestId('draft-row').getByRole('button', { name: 'Draft options' }).click();
    await page.getByRole('menuitem', { name: 'Delete draft' }).click();
    await expect(page.getByTestId('draft-row')).toHaveCount(0);
    await context.close();
  });
});

test.describe('mass sending, review and outbox', () => {
  test('a mass send with an unfilled variable stops at the review step; filled, it queues and the outbox cancels', async ({
    browser,
  }) => {
    const { context, page } = await openPage(browser);
    await page.getByTestId('compose-email').first().click();
    await composer(page).waitFor();
    await page.getByTestId('mass-switch').click();
    await expect(composer(page)).toHaveAttribute('data-mass', 'true');
    await expect(page.getByTestId('recipients-panel')).toBeVisible();
    // Two recipients: a person (variables resolve) and a bare address (no record: the variable has no value).
    await page.getByTestId('add-recipients').fill('jane');
    await page.getByTestId('recipient-suggestion').first().click();
    await page.getByTestId('add-recipients').fill('nobody@mass-test.example.com');
    await page.getByTestId('recipient-suggestion').first().click();
    await expect(page.getByTestId('recipient-row')).toHaveCount(2);
    await expect(page.getByTestId('composer-mass-chip')).toHaveText('Sending individual emails to 2 recipients');
    await expect(page.getByTestId('composer-primary')).toHaveText('Review Emails (2)');

    await page.getByTestId('composer-subject').click();
    await page.keyboard.type('Mass hello');
    await page.getByTestId('composer-body').click();
    await page.keyboard.type('Hi {');
    await page.getByTestId('variable-menu').waitFor();
    await page.getByRole('menuitem', { name: /^Name/ }).click();
    await page.getByRole('menuitem', { name: 'First' }).click();
    // Focus returns to the editor once the menu is gone (the page is inert while it is open).
    await expect(page.getByTestId('composer-body')).toBeFocused();
    await page.keyboard.type(', welcome.');

    // Review: the variable of the bare address has no value and no fallback → stopped here, nothing queued.
    await page.getByTestId('composer-primary').click();
    await page.getByTestId('composer-review').waitFor();
    await expect(page.getByTestId('review-title')).toHaveText('Review email');
    await expect(page.getByTestId('review-warning')).toContainText('Name › First');
    const rows = page.getByTestId('recipient-row');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('review-body')).toContainText('Hi [seed] Jane, welcome.');
    await rows.filter({ hasText: 'nobody@mass-test.example.com' }).click();
    await expect(page.getByTestId('review-to')).toContainText('nobody@mass-test.example.com');
    await expect(page.getByTestId('review-warning')).toBeVisible();
    expect((await outbox(page)).length).toBe(0);

    // Sending asks for confirmation; going back leaves everything unsent.
    await page.getByTestId('review-send').click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Some variables have no value');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await outbox(page)).length).toBe(0);

    // Back to the editor, give the variable a fallback, review again: no warning, send.
    await page.getByTestId('review-back').click();
    await composer(page).locator('.agentic-crm-variable').click();
    await page.getByTestId('variable-fallback').fill('friend');
    await page.keyboard.press('Enter');
    await page.getByTestId('composer-primary').click();
    await page.getByTestId('composer-review').waitFor();
    await expect(page.getByTestId('review-warning')).toHaveCount(0);
    await page.getByTestId('recipient-row').filter({ hasText: 'nobody@' }).click();
    await expect(page.getByTestId('review-body')).toContainText('Hi friend, welcome.');
    await expect(page.getByTestId('review-send')).toHaveText('Send emails (2)');
    await page.getByTestId('review-send').click();
    await composer(page).waitFor({ state: 'detached' });
    await expect(page.getByText('Emails sent')).toBeVisible();

    // The outbox: mass sends are spaced; the later email is still scheduled and can be cancelled.
    await expect.poll(async () => (await outbox(page)).filter((o) => o.deliveryState === 'scheduled').length).toBe(1);
    await page.goto(ws('emails/outbox'));
    await expect(page.getByTestId('outbox-item')).not.toHaveCount(0);
    const scheduled = page.locator('[data-testid="outbox-item"][data-state="scheduled"]');
    await expect(scheduled).toHaveCount(1);
    await scheduled.click();
    await expect(page.getByTestId('outbox-preview')).toContainText('Hi friend, welcome.');
    await page.getByRole('button', { name: 'Email options' }).click();
    await page.getByRole('menuitem', { name: 'Cancel email' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Are you sure you want to cancel this email?');
    await confirm.getByRole('button', { name: 'Go back' }).click();
    expect((await outbox(page)).filter((o) => o.deliveryState === 'scheduled').length).toBe(1);
    await page.getByRole('button', { name: 'Email options' }).click();
    await page.getByRole('menuitem', { name: 'Cancel email' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel email' }).click();
    await expect(page.getByText('Email canceled')).toBeVisible();
    await expect.poll(async () => (await outbox(page)).filter((o) => o.deliveryState === 'scheduled').length).toBe(0);
    await context.close();
  });
});
