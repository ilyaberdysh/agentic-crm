// Email and calendar settings (BACKLOG 7.08; F settings): the accounts list with a dev-only test account, mailbox
// General (visibility, individuals with full access), blocklist, signatures, and the workspace Email visibility and
// Record creation tabs. Runs against the e2e stack; every test connects mailboxes of its own (unique addresses) and
// restores the workspace settings it changes, so the other  specs see the seeded state.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { trpc, ws } from './slice3-support.ts';
import { ada, memberId, mod, secondMember, signedInAs } from './slice5-support.ts';
import { ensureMailbox } from './slice7-support.ts';

const ACCOUNTS = ws('settings/email-and-calendar-accounts');
const WORKSPACE_EMAIL = ws('settings/workspace-email-and-calendar');
const RUN = Date.now().toString(36);

test.beforeAll(() => {
  secondMember();
});

// Several flows per test (reloads, dialogs): more than the 30 s default.
test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

interface MailboxRow {
  id: string;
  emailAddress: string;
  isDefault: boolean;
}

const addressOf = (name: string) => `${name}-${RUN}@mymeet.ai`;

async function mailboxes(page: Page): Promise<MailboxRow[]> {
  return trpc<MailboxRow[]>(page, 'mailboxes.list', {});
}

async function disconnect(page: Page, address: string) {
  const found = (await mailboxes(page)).find((m) => m.emailAddress === address);
  if (found) await trpc(page, 'mailboxes.disconnect', { mailboxId: found.id });
}

const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

/** The row of the accounts list for an address. */
const accountRow = (page: Page, address: string) => page.getByTestId('account-row').filter({ hasText: address });

/** Switches are hidden inputs inside their label: toggling clicks the label. */
const flip = (control: Locator) => control.locator('xpath=ancestor::label').click();

async function openMenu(page: Page, trigger: Locator) {
  await trigger.click();
  await page.getByRole('menu').waitFor();
}

// ---- accounts list ---------------------------------------------------------------------------------------------------

test('accounts: connect a test account through the dialog, make it default, remove it', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, ada(), ACCOUNTS);
  const first = addressOf('accounts-a');
  const second = addressOf('accounts-b');
  try {
    await expect(page.getByRole('heading', { name: 'Email and calendar accounts', level: 1 })).toBeVisible();
    await expect(page.getByText('Manage and sync your email and calendar accounts to stay organized.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connected accounts' })).toBeVisible();

    // Google: the e2e stack has no Google OAuth client, so the button is disabled and says why.
    await expect(page.getByRole('button', { name: 'Connect Google Account' })).toBeDisabled();
    await expect(page.getByTestId('google-not-configured')).toHaveText('Google is not configured on this server');

    // Connect test account (dev builds): validates the address, then the row appears with its sub-label and chip.
    await page.getByRole('button', { name: 'Connect test account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Connect test account' });
    await dialog.getByLabel('Email address').fill('not an address');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByText('Enter a valid email address.')).toBeVisible();
    await dialog.getByLabel('Email address').fill(first);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const row = accountRow(page, first);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Email and Calendar');
    await expect(row.getByText(/In Sync|Syncing\.\.\./)).toBeVisible();

    // A second account; Make default moves the Default badge.
    await ensureMailbox(page, second);
    await page.reload();
    await expect(accountRow(page, second)).toBeVisible();
    await expect(page.getByTestId('account-row').getByText('Default', { exact: true })).toHaveCount(1);
    await openMenu(page, accountRow(page, second).getByRole('button', { name: 'Options' }));
    await page.getByRole('menuitem', { name: 'Make default' }).click();
    await expect(accountRow(page, second).getByText('Default', { exact: true })).toBeVisible();
    await expect(accountRow(page, first).getByText('Default', { exact: true })).toHaveCount(0);
    expect((await mailboxes(page)).find((m) => m.emailAddress === second)?.isDefault).toBe(true);
    // The default mailbox has no "Make default".
    await openMenu(page, accountRow(page, second).getByRole('button', { name: 'Options' }));
    await expect(page.getByRole('menuitem', { name: 'Make default' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Manage opens the mailbox page; the row itself links there too.
    await accountRow(page, first).getByRole('link', { name: first }).click();
    await expect(page).toHaveURL(new RegExp(`${ACCOUNTS}/[0-9a-f-]+/general$`));
    await expect(page.getByRole('heading', { name: first, level: 1 })).toBeVisible();
    await page.goBack();

    // Remove mailbox: the alert lists the consequences; Cancel keeps it, Confirm removes it.
    await openMenu(page, accountRow(page, first).getByRole('button', { name: 'Options' }));
    await page.getByRole('menuitem', { name: 'Remove mailbox' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText(`Remove ${first}?`);
    await expect(alert).toContainText('emails and calendar events synced from this mailbox are deleted');
    await expect(alert).toContainText('access grants');
    await alert.getByRole('button', { name: 'Cancel' }).click();
    await expect(accountRow(page, first)).toBeVisible();
    await openMenu(page, accountRow(page, first).getByRole('button', { name: 'Options' }));
    await page.getByRole('menuitem', { name: 'Remove mailbox' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove mailbox' }).click();
    await expect(accountRow(page, first)).toHaveCount(0);
    expect((await mailboxes(page)).some((m) => m.emailAddress === first)).toBe(false);
  } finally {
    await disconnect(page, first);
    await disconnect(page, second);
    await context.close();
  }
});

// ---- mailbox: General -------------------------------------------------------------------------------------------------

test('mailbox general: email visibility persists after reload; the owner is not offered in Add person', async ({
  browser,
}) => {
  const { context, page } = await signedInAs(browser, ada(), ACCOUNTS);
  const address = addressOf('general');
  try {
    const mailbox = await ensureMailbox(page, address, 'subject-line');
    await page.goto(`${ACCOUNTS}/${mailbox.id}/general`);
    await expect(page.getByRole('link', { name: 'Back to accounts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: address, level: 1 })).toBeVisible();
    await expect(page.getByText('Update your account permissions and settings.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Mailbox-only blocklist' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Signatures' })).toBeVisible();

    const cards = page.getByTestId('visibility-cards');
    await expect(cards.getByRole('radio', { name: /^Subject line and metadata/ })).toBeChecked();
    await page.getByTestId('visibility-cards-metadata-only').click();
    await expect(cards.getByRole('radio', { name: /^Metadata only/ })).toBeChecked();
    const visibilityOf = async () =>
      (await trpc<{ defaultVisibility: string }>(page, 'mailboxes.get', { mailboxId: mailbox.id })).defaultVisibility;
    await expect.poll(visibilityOf).toBe('metadata-only');
    await page.reload();
    await expect(page.getByTestId('visibility-cards').getByRole('radio', { name: /^Metadata only/ })).toBeChecked();
    await page.getByTestId('visibility-cards-full-access').click();
    await expect.poll(visibilityOf).toBe('full-access');
    await page.reload();
    await expect(page.getByTestId('visibility-cards').getByRole('radio', { name: /^Full access/ })).toBeChecked();

    // The info alert and the empty "Individuals with full access".
    await expect(
      page.getByText('Only applicable if "metadata only" or "subject line and metadata" is selected'),
    ).toBeVisible();
    await expect(page.getByTestId('granted-person')).toHaveCount(0);

    // `advanced` is flag-gated: it renders General.
    await page.goto(`${ACCOUNTS}/${mailbox.id}/advanced`);
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('visibility-cards')).toBeVisible();
  } finally {
    await disconnect(page, address);
    await context.close();
  }
});

test('mailbox general: add and remove a person with full access', async ({ browser }) => {
  const grace = secondMember();
  const { context, page } = await signedInAs(browser, ada(), ACCOUNTS);
  const address = addressOf('sharing');
  try {
    const mailbox = await ensureMailbox(page, address, 'subject-line');
    await page.goto(`${ACCOUNTS}/${mailbox.id}/general`);
    await expect(page.getByRole('heading', { name: 'Individuals with full access' })).toBeVisible();

    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add person' });
    await expect(dialog.getByRole('button', { name: /Cancel/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Confirm/ })).toBeDisabled();
    await dialog.getByRole('button', { name: /Select a person/ }).click();
    // The owner (Ada) is not offered; Grace is.
    const options = page.getByRole('listbox').getByRole('option');
    await expect(options.filter({ hasText: grace.name })).toBeVisible();
    await expect(options.filter({ hasText: 'Ada Tester' })).toHaveCount(0);
    await options.filter({ hasText: grace.name }).click();
    await page.keyboard.press(`${mod}+Enter`);
    await expect(dialog).toHaveCount(0);

    const person = page.getByTestId('granted-person');
    await expect(person).toHaveCount(1);
    await expect(person).toContainText(grace.name);
    await expect(person).toContainText(grace.email);
    await page.reload();
    await expect(page.getByTestId('granted-person')).toHaveCount(1);

    // Already granted: no longer offered.
    await page.getByRole('button', { name: 'Add person' }).click();
    await page
      .getByRole('dialog', { name: 'Add person' })
      .getByRole('button', { name: /Select a person/ })
      .click();
    await expect(page.getByRole('listbox').getByRole('option').filter({ hasText: grace.name })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add person' })).toHaveCount(0);

    // Stop sharing.
    await page.getByTestId('granted-person').getByRole('button', { name: 'Stop sharing' }).click();
    await expect(page.getByTestId('granted-person')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('granted-person')).toHaveCount(0);
  } finally {
    await disconnect(page, address);
    await context.close();
  }
});

// ---- mailbox: blocklist ----------------------------------------------------------------------------------------------

test('blocklist: empty state, invalid and duplicate tokens, remove', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, ada(), ACCOUNTS);
  const address = addressOf('blocklist');
  try {
    const mailbox = await ensureMailbox(page, address, 'subject-line');
    await page.goto(`${ACCOUNTS}/${mailbox.id}/general`);
    await page.getByRole('tab', { name: 'Mailbox-only blocklist' }).click();
    await expect(page).toHaveURL(/\/blocklist$/);
    const empty = page.getByTestId('blocklist-empty');
    await expect(empty).toContainText('No emails or domains yet');
    await expect(empty).toContainText("Emails from blocklisted domains and addresses won't appear in Agentic CRM.");

    await empty.getByRole('button', { name: 'Add to blocklist' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mailbox-only blocklist' });
    await expect(
      dialog.getByText('Separate your domains and email addresses by a comma or space to add multiple'),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Confirm/ })).toBeDisabled();
    const box = dialog.getByRole('textbox', { name: 'Enter a domain/email to block from your mailbox' });

    // Something added + something invalid: the dialog closes and the leftovers are told in a toast.
    await box.fill('spam-e2e.test, mallory@evil-e2e.test, not@@valid');
    await page.keyboard.press(`${mod}+Enter`);
    await expect(dialog).toHaveCount(0);
    await expect(toast(page, '1 invalid entry was not added')).toBeVisible();
    const rows = page.getByTestId('blocklist-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'spam-e2e.test' })).toContainText('Domain');
    await expect(rows.filter({ hasText: 'mallory@evil-e2e.test' })).toContainText('Email address');

    // Nothing new: the dialog stays, flags the invalid token and counts the duplicates.
    await page.getByRole('button', { name: 'Add to blocklist' }).click();
    const again = page.getByRole('dialog', { name: 'Mailbox-only blocklist' });
    await again.getByRole('textbox').fill('SPAM-e2e.test not@@valid');
    await again.getByRole('button', { name: /Confirm/ }).click();
    const problems = again.getByTestId('token-problems');
    await expect(problems).toContainText('Invalid email/domain');
    await expect(problems).toContainText('not@@valid');
    await expect(problems).toContainText('1 duplicate domain was not added');
    await expect(again).toBeVisible();
    await expect(again.getByRole('textbox')).toHaveValue('not@@valid spam-e2e.test');
    await page.keyboard.press('Escape');
    await expect(again).toHaveCount(0);
    await expect(rows).toHaveCount(2);

    // Persisted; remove both.
    await page.reload();
    await expect(page.getByTestId('blocklist-row')).toHaveCount(2);
    await page
      .getByTestId('blocklist-row')
      .filter({ hasText: 'spam-e2e.test' })
      .getByRole('button', { name: 'Remove spam-e2e.test' })
      .click();
    await expect(page.getByTestId('blocklist-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Remove mallory@evil-e2e.test' }).click();
    await expect(page.getByTestId('blocklist-empty')).toBeVisible();
  } finally {
    await disconnect(page, address);
    await context.close();
  }
});

// ---- mailbox: signatures ---------------------------------------------------------------------------------------------

test('signatures: create, rename, autosave the body, default handling, delete', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, ada(), ACCOUNTS);
  const address = addressOf('signatures');
  try {
    const mailbox = await ensureMailbox(page, address, 'subject-line');
    await page.goto(`${ACCOUNTS}/${mailbox.id}/signatures`);
    const empty = page.getByTestId('signatures-empty');
    await expect(empty).toContainText('No email signatures');
    await expect(empty).toContainText('Create multiple signatures for your mailbox.');

    // The first signature becomes the default.
    await empty.getByRole('button', { name: 'Create first signature' }).click();
    const items = page.getByTestId('signature-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('New signature');
    await expect(items.first().getByText('Default', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Signatures', level: 2 })).toBeVisible();
    await expect(
      page.getByText('Create multiple signatures for your mailbox, and set up your default signature.'),
    ).toBeVisible();

    // Rename (autosaves) and write the body (autosaves after ~600 ms): both survive a reload.
    const title = page.getByRole('textbox', { name: 'Signature title' });
    await expect(title).toHaveValue('New signature');
    await title.fill('Work signature');
    const body = page.getByTestId('signature-body-editor');
    await expect(body).toBeVisible();
    await body.click();
    await page.keyboard.type('Best regards,');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ada Tester');
    await expect
      .poll(async () => {
        const list = await trpc<{ title: string; body: { text: string }[] }[]>(page, 'email.signatures.list', {
          mailboxId: mailbox.id,
        });
        return `${list[0]?.title}|${(list[0]?.body ?? []).map((b) => b.text).join('/')}`;
      })
      .toBe('Work signature|Best regards,/Ada Tester');
    await page.reload();
    await expect(page.getByTestId('signature-item').first()).toContainText('Work signature');
    await expect(page.getByTestId('signature-body-editor')).toContainText('Best regards,');
    await expect(page.getByTestId('signature-body-editor')).toContainText('Ada Tester');

    // Insert menu: Body, Bulleted list, Numbered list.
    await page.getByRole('button', { name: 'Insert' }).click();
    await expect(page.getByRole('menuitem', { name: /Body/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Bulleted list/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Numbered list/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // A second signature is not the default; Set as default moves the badge, Clear default removes it.
    await page.getByRole('button', { name: 'New signature' }).click();
    await expect(items).toHaveCount(2);
    const second = items.filter({ hasText: 'New signature' });
    await expect(second.getByText('Default', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Signature title' })).toHaveValue('New signature');
    await openMenu(page, second.getByRole('button', { name: 'Show menu' }));
    await page.getByRole('menuitem', { name: 'Set as default' }).click();
    await expect(second.getByText('Default', { exact: true })).toBeVisible();
    await expect(items.filter({ hasText: 'Work signature' }).getByText('Default', { exact: true })).toHaveCount(0);
    await openMenu(page, second.getByRole('button', { name: 'Show menu' }));
    await page.getByRole('menuitem', { name: 'Clear default' }).click();
    await expect(items.getByText('Default', { exact: true })).toHaveCount(0);
    expect(
      (await trpc<{ isDefault: boolean }[]>(page, 'email.signatures.list', { mailboxId: mailbox.id })).some(
        (s) => s.isDefault,
      ),
    ).toBe(false);

    // Delete: Cancel keeps it, Confirm deletes it.
    await openMenu(page, second.getByRole('button', { name: 'Show menu' }));
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const alert = page.getByRole('alertdialog');
    await expect(alert).toContainText('Are you sure?');
    await expect(alert).toContainText('This signature will be permanently deleted, this cannot be undone.');
    await alert.getByRole('button', { name: 'Cancel' }).click();
    await expect(items).toHaveCount(2);
    await openMenu(page, second.getByRole('button', { name: 'Show menu' }));
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(items).toHaveCount(1);
    await openMenu(page, items.first().getByRole('button', { name: 'Show menu' }));
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByTestId('signatures-empty')).toBeVisible();
  } finally {
    await disconnect(page, address);
    await context.close();
  }
});

// ---- workspace: record creation --------------------------------------------------------------------------------------

test('record creation: default mode and company switch persist; suppression add and remove', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, ada(), `${WORKSPACE_EMAIL}/record-creation`);
  const settings = () =>
    trpc<{ recordCreation: string; autoCreateCompanies: boolean; defaultVisibility: string }>(
      page,
      'workspaceEmail.settings.get',
      {},
    );
  const before = await settings();
  try {
    await expect(page.getByRole('heading', { name: 'Email and calendar', level: 1 })).toBeVisible();
    await expect(page.getByText('Workspace-wide email and calendar settings')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Record creation' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Record creation', level: 2 })).toBeVisible();
    const cards = page.getByTestId('record-creation-cards');
    await expect(cards.getByRole('radio', { name: /^All contacts/ })).toBeVisible();
    await expect(page.getByTestId('record-creation-cards-selective')).toContainText('Recommended');
    await expect(cards.getByRole('radio', { name: /^None/ })).toBeVisible();

    // Mode.
    await page.getByTestId('record-creation-cards-none').click();
    await expect(cards.getByRole('radio', { name: /^None/ })).toBeChecked();
    await expect.poll(async () => (await settings()).recordCreation).toBe('none');
    await page.reload();
    await expect(page.getByTestId('record-creation-cards').getByRole('radio', { name: /^None/ })).toBeChecked();
    await page.getByTestId('record-creation-cards-all').click();
    await expect.poll(async () => (await settings()).recordCreation).toBe('all');
    await page.reload();
    await expect(page.getByTestId('record-creation-cards').getByRole('radio', { name: /^All contacts/ })).toBeChecked();

    // Company records.
    const companies = page.getByRole('switch', { name: 'Automatically create company records' });
    const wasOn = before.autoCreateCompanies;
    await expect(companies).toBeChecked({ checked: wasOn });
    await flip(companies);
    await expect.poll(async () => (await settings()).autoCreateCompanies).toBe(!wasOn);
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Automatically create company records' })).toBeChecked({
      checked: !wasOn,
    });

    // Record suppression: info alert, add, remove.
    await expect(
      page.getByText('This does not affect related information, such as emails, visible within your workspace.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Add contacts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record suppression' });
    await dialog
      .getByRole('textbox', { name: 'Type an email address or domain to suppress record creation' })
      .fill(`newsletter-${RUN}.example news@bad-${RUN}.example`);
    await page.keyboard.press(`${mod}+Enter`);
    await expect(dialog).toHaveCount(0);
    const rows = page.getByTestId('suppression-row');
    await expect(rows.filter({ hasText: `newsletter-${RUN}.example` })).toContainText('Domain');
    await expect(rows.filter({ hasText: `news@bad-${RUN}.example` })).toContainText('Email address');
    await page.reload();
    await expect(page.getByTestId('suppression-row').filter({ hasText: `newsletter-${RUN}.example` })).toBeVisible();
    for (const value of [`newsletter-${RUN}.example`, `news@bad-${RUN}.example`]) {
      const row = page.getByTestId('suppression-row').filter({ hasText: value });
      await openMenu(page, row.getByRole('button', { name: `Options for ${value}` }));
      await page.getByRole('menuitem', { name: 'Remove suppression' }).click();
      await expect(row).toHaveCount(0);
    }
  } finally {
    await trpc(page, 'workspaceEmail.settings.update', {
      recordCreation: before.recordCreation,
      autoCreateCompanies: before.autoCreateCompanies,
    });
    await context.close();
  }
});

// ---- workspace: email visibility -------------------------------------------------------------------------------------

test('email visibility: protected contacts (add, enforcement, remove), internal domain switch, default level', async ({
  browser,
}) => {
  const { context, page } = await signedInAs(browser, ada(), WORKSPACE_EMAIL);
  const settings = () =>
    trpc<{ defaultVisibility: string; internalDomains: string[]; unprotectedDomains: string[] }>(
      page,
      'workspaceEmail.settings.get',
      {},
    );
  const before = await settings();
  const vip = `vip-${RUN}.example`;
  try {
    // /workspace-email-and-calendar redirects to the first tab.
    await expect(page).toHaveURL(/\/workspace-email-and-calendar\/email-visibility$/);
    await expect(page.getByRole('tab', { name: 'Email visibility' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Email visibility', level: 2 })).toBeVisible();
    await expect(page.getByText('Workspace protected and blocked contacts')).toBeVisible();
    await expect(
      page.getByText('Hide emails and calendar event entries involving certain contacts, everywhere in Agentic CRM.'),
    ).toBeVisible();

    // Built-in rows: members' addresses, and one switch per internal domain.
    const table = page.getByTestId('protected-table');
    for (const header of ['Email / Domain', 'Enforcement level', 'Last update', 'Added by']) {
      await expect(table.getByRole('columnheader', { name: header })).toBeVisible();
    }
    const members = table.getByTestId('protected-row-members');
    await expect(members).toContainText("Workspace members' email addresses");
    await expect(members).toContainText('Protected');
    await expect(members).toContainText('System default');
    expect(before.internalDomains).toContain('mymeet.ai');
    const domainSwitch = page.getByRole('switch', { name: 'Protect mymeet.ai' });
    await expect(domainSwitch).toBeChecked();
    await flip(domainSwitch);
    await expect.poll(async () => (await settings()).unprotectedDomains).toContain('mymeet.ai');
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Protect mymeet.ai' })).not.toBeChecked();
    await flip(page.getByRole('switch', { name: 'Protect mymeet.ai' }));
    await expect.poll(async () => (await settings()).unprotectedDomains).not.toContain('mymeet.ai');

    // Add contacts: an invalid token is flagged, the valid one is added as Protected.
    await page.getByRole('button', { name: 'Add contacts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add to protected and blocked contacts' });
    const box = dialog.getByRole('textbox', {
      name: 'Enter domains or email addresses, separated by commas or spaces',
    });
    await box.fill('bad@@token');
    await page.keyboard.press(`${mod}+Enter`);
    await expect(dialog.getByTestId('token-problems')).toContainText('Invalid email/domain');
    await box.fill(`${vip}, ceo@${vip}`);
    await page.keyboard.press(`${mod}+Enter`);
    await expect(dialog).toHaveCount(0);
    const rowOf = (value: string) => page.locator(`[data-testid="protected-row"][data-value="${value}"]`);
    await expect(rowOf(`ceo@${vip}`)).toContainText('Protected');
    await expect(rowOf(`ceo@${vip}`)).toContainText('Ada Tester');

    // Search narrows the table.
    await page.getByRole('searchbox', { name: 'Search addresses or domains' }).fill(`ceo@${vip}`);
    await expect(page.getByTestId('protected-row')).toHaveCount(1);
    await expect(page.getByTestId('protected-row-members')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search addresses or domains' }).fill('');

    // Enforcement level: Protected → Blocked, persisted.
    await rowOf(vip)
      .getByRole('button', { name: /Enforcement level/ })
      .click();
    await page.getByRole('option', { name: 'Blocked' }).click();
    await expect
      .poll(
        async () =>
          (
            await trpc<{ value: string; enforcement: string }[]>(page, 'workspaceEmail.protectedContacts.list', {})
          ).find((c) => c.value === vip)?.enforcement,
      )
      .toBe('blocked');
    await page.reload();
    await expect(rowOf(vip).getByRole('button', { name: /Enforcement level/ })).toContainText('Blocked');

    // Remove both.
    for (const value of [vip, `ceo@${vip}`]) {
      await openMenu(page, rowOf(value).getByRole('button', { name: `Options for ${value}` }));
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      await expect(rowOf(value)).toHaveCount(0);
    }

    // Default email visibility of new mailboxes.
    const select = page.getByRole('button', { name: /Default email visibility of new mailboxes/ });
    await select.click();
    await page.getByRole('option', { name: 'Full access' }).click();
    await expect.poll(async () => (await settings()).defaultVisibility).toBe('full-access');
  } finally {
    await trpc(page, 'workspaceEmail.settings.update', {
      defaultVisibility: before.defaultVisibility,
      unprotectedDomains: before.unprotectedDomains,
    });
    for (const c of await trpc<{ id: string; value: string }[]>(page, 'workspaceEmail.protectedContacts.list', {})) {
      if (c.value.endsWith(vip)) await trpc(page, 'workspaceEmail.protectedContacts.remove', { id: c.id });
    }
    await context.close();
  }
});

// ---- admins only -----------------------------------------------------------------------------------------------------

test('workspace email settings are admin-only: members see them read-only and cannot write', async ({ browser }) => {
  const grace = secondMember();
  // Grace joined the seeded workspace as an admin: she is a plain member for this test.
  const admin = await signedInAs(browser, ada(), ws('home'));
  const graceId = await memberId(admin.page, grace.email);
  await trpc(admin.page, 'members.updateAccessLevel', { memberId: graceId, accessLevel: 'member' });
  const { context, page } = await signedInAs(browser, grace, `${WORKSPACE_EMAIL}/email-visibility`);
  try {
    // The page never crashes for a member: same content, no controls.
    await expect(page.getByRole('heading', { name: 'Email and calendar', level: 1 })).toBeVisible();
    await expect(page.getByTestId('read-only-note')).toContainText('Only workspace admins can change these settings.');
    await expect(page.getByRole('button', { name: 'Add contacts' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /^Protect / }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: /Default email visibility of new mailboxes/ })).toBeDisabled();

    await page.getByRole('tab', { name: 'Record creation' }).click();
    await expect(page.getByTestId('read-only-note')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add contacts' })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Automatically create company records' })).toBeDisabled();

    // The server refuses member writes.
    const response = await page.request.post('/trpc/workspaceEmail.settings.update', {
      headers: { 'content-type': 'application/json', 'x-workspace-slug': 'mymeet' },
      data: { recordCreation: 'none' },
    });
    expect(response.status()).toBe(403);

    // A member still manages their own mailbox: the accounts page works.
    await page.goto(ACCOUNTS);
    await expect(page.getByRole('heading', { name: 'Email and calendar accounts', level: 1 })).toBeVisible();
    const mine = await memberId(page, grace.email);
    expect(mine).toBe(graceId);
    // The settings navigation lists the workspace entry for admins only.
    await expect(page.getByRole('link', { name: 'Email and calendar', exact: true })).toHaveCount(0);
  } finally {
    await trpc(admin.page, 'members.updateAccessLevel', { memberId: graceId, accessLevel: 'admin' });
    await context.close();
    await admin.context.close();
  }
});

test('accounts: empty state when the member has no mailbox', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, ada(), ws('home'));
  try {
    // The list answers [] (the real mailboxes of the shared e2e workspace stay untouched).
    await page.route('**/trpc/**', async (route) => {
      const path = new URL(route.request().url()).pathname.split('/trpc/')[1] ?? '';
      const index = decodeURIComponent(path).split(',').indexOf('mailboxes.list');
      if (index < 0) return route.continue();
      const response = await route.fetch();
      const body = (await response.json()) as unknown[];
      body[index] = { result: { data: [] } };
      return route.fulfill({ response, json: body });
    });
    await page.goto(ACCOUNTS);
    await expect(page.getByText('No connected accounts')).toBeVisible();
    await expect(
      page.getByText('Connect your email and calendar to see conversations and meetings on your records.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect Google Account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect test account' })).toBeVisible();
    await expect(page.getByTestId('account-row')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
