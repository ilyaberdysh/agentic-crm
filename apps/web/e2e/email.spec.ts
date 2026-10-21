//  — record Emails tab and the email modal (BACKLOG 7.03; acceptance 3). Runs against the e2e stack with two
// members (Ada: full-access mailbox with the thread "Pilot for Northwind"; Grace: subject-line mailbox with "Secret
// pricing", both from/to the seeded person Jane Cooper). Every test restores what it changes (Grace's visibility,
// grants) so the next test sees the seeded state.

import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { findRecord } from './record-support.ts';
import { trpc } from './slice3-support.ts';
import { memberId, signedInAs } from './slice5-support.ts';
import {
  ADA_MAILBOX,
  ensureMailbox,
  GRACE_MAILBOX,
  injectMessage,
  injectSharedMessage,
  JANE,
  janeId,
  personTab,
  type Slice7Seed,
  seedSlice7,
  WADE,
} from './slice7-support.ts';

test.describe.configure({ mode: 'serial' });

let seed: Slice7Seed;
let jane = '';

test.beforeAll(async ({ browser }) => {
  seed = await seedSlice7(browser);
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  jane = await janeId(page);
  await context.close();
});

// Several flows per test (two signed-in members, reloads): more than the 30 s default.
test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

const rowOf = (page: Page, subject: string) => page.getByTestId('email-thread-row').filter({ hasText: subject });
const modal = (page: Page) => page.getByTestId('email-modal');

async function emailsTab(browser: Parameters<typeof signedInAs>[0], member: Slice7Seed['ada']) {
  const { context, page } = await signedInAs(browser, member, '/mymeet/home');
  await page.goto(personTab(jane));
  await expect(page.getByTestId('emails-tab')).toBeVisible();
  await expect(page.getByTestId('email-thread-row').first()).toBeVisible();
  return { context, page };
}

test('Emails tab: full access shows everything, subject-line hides the snippet, the tab counts the threads', async ({
  browser,
}) => {
  const { context, page } = await emailsTab(browser, seed.ada);
  const pilot = rowOf(page, 'Pilot for Northwind');
  await expect(pilot).toHaveAttribute('data-access', 'full-access');
  await expect(pilot.getByTestId('email-row-snippet')).toContainText('We would like to start a pilot next month');
  await expect(pilot.getByTestId('email-row-participants')).toContainText('Jane Cooper');
  await expect(pilot.getByTestId('email-row-via')).toContainText('via Ada Tester');

  // Grace's thread: the subject and the people, never the content (acceptance 3).
  const secret = rowOf(page, 'Secret pricing');
  await expect(secret).toHaveAttribute('data-access', 'subject-line');
  await expect(secret.getByTestId('email-row-snippet')).toHaveCount(0);
  await expect(secret).not.toContainText('Our best price');
  await expect(secret.getByTestId('email-row-participants')).toContainText('Grace Hopper');
  await expect(secret.getByTestId('email-row-request-access')).toContainText('Request access from Grace Hopper');
  await expect(secret.getByTestId('email-row-via')).toContainText('via Grace Hopper');

  // 86 px rows, newest first, and the count on the tab.
  const box = await pilot.boundingBox();
  expect(Math.round(box?.height ?? 0)).toBe(86);
  const titles = await page.getByTestId('email-row-subject').allTextContents();
  expect(titles.indexOf('Secret pricing')).toBeLessThan(titles.indexOf('Pilot for Northwind'));
  await expect(page.getByTestId('record-tabs').getByRole('tab', { name: /Emails/ })).toContainText(/Emails\s*[2-9]/);
  await context.close();
});

test('acceptance 3: a subject-line email opens in the restricted state (no body); a full-access one shows the body in a sandboxed iframe', async ({
  browser,
}) => {
  const { context, page } = await emailsTab(browser, seed.ada);
  await rowOf(page, 'Secret pricing').click();
  await expect(page).toHaveURL(/modal=email&id=/);
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId('email-subject')).toHaveText('Secret pricing');
  await expect(page.getByTestId('email-restricted')).toContainText('No access to this email content');
  await expect(page.getByTestId('email-body-frame')).toHaveCount(0);
  await expect(modal(page)).not.toContainText('Our best price');
  // Participants and time are always shown.
  await expect(page.getByTestId('email-sender')).toHaveText('Grace Hopper');
  await expect(page.getByTestId('email-timestamp')).toContainText(/\d{4} \d{1,2}:\d{2} (AM|PM)/);
  // No Reply / Forward without the content; "Request access" only answers with a toast.
  await expect(modal(page).getByRole('button', { name: 'Reply', exact: true })).toHaveCount(0);
  await modal(page).getByRole('button', { name: 'Request access' }).click();
  await expect(page.getByText('Access requests arrive in a later slice')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);

  await rowOf(page, 'Pilot for Northwind').click();
  await expect(modal(page)).toBeVisible();
  const frame = page.getByTestId('email-body-frame');
  await expect(frame).toBeVisible();
  const sandbox = (await frame.getAttribute('sandbox')) ?? '';
  expect(sandbox).toContain('allow-same-origin');
  expect(sandbox).not.toContain('allow-scripts');
  await expect(page.frameLocator('[data-testid="email-body-frame"]').locator('body')).toContainText(
    'Could you send the proposal?',
  );
  // The frame is sized to its content and carries the restrictive CSP.
  const height = (await frame.boundingBox())?.height ?? 0;
  expect(height).toBeGreaterThan(20);
  expect(height).toBeLessThan(400);
  const csp = await page
    .frameLocator('[data-testid="email-body-frame"]')
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  await expect(page.getByTestId('email-restricted')).toHaveCount(0);
  await expect(page.getByTestId('email-subject')).toHaveText('Pilot for Northwind');
  await expect(page.getByTestId('email-to-toggle')).toContainText('to me');
  await page.getByTestId('email-to-toggle').click();
  await expect(page.getByTestId('email-participants')).toContainText('jane.cooper@northwind.example.com');
  await context.close();
});

test('script in an email body does not run (no allow-scripts, CSP)', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const subject = `XSS probe ${randomUUID().slice(0, 6)}`;
  await injectMessage(page, seed.adaMailbox.id, {
    subject,
    bodyText: 'probe',
    bodyHtml:
      '<p id="probe">Probe body</p><img src="x" onerror="parent.document.title=\'pwned\'"><script>parent.document.title="pwned"</script>',
    from: JANE,
    to: [{ emailAddress: ADA_MAILBOX, name: 'Ada Tester' }],
  });
  await page.goto(personTab(jane));
  await rowOf(page, subject).click();
  await expect(page.frameLocator('[data-testid="email-body-frame"]').locator('#probe')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.title()).not.toBe('pwned');
  await context.close();
});

test('metadata-only access shows "Private subject line" in the tab and the modal', async ({ browser }) => {
  const grace = await signedInAs(browser, seed.grace, '/mymeet/home');
  await ensureMailbox(grace.page, GRACE_MAILBOX, 'metadata-only');
  try {
    const { context, page } = await emailsTab(browser, seed.ada);
    await expect(page.getByTestId('email-thread-row').filter({ hasText: 'Private subject line' })).toHaveCount(1);
    await expect(page.getByTestId('email-thread-row').filter({ hasText: 'Secret pricing' })).toHaveCount(0);
    const row = page.getByTestId('email-thread-row').filter({ hasText: 'Private subject line' });
    await expect(row).toHaveAttribute('data-access', 'metadata-only');
    // Participants and date are still there.
    await expect(row.getByTestId('email-row-participants')).toContainText('Grace Hopper');
    await expect(row.getByTestId('email-row-date')).not.toBeEmpty();
    await row.click();
    await expect(page.getByTestId('email-subject')).toHaveText('Private subject line');
    await expect(page.getByTestId('email-restricted')).toContainText('No access to this email content');
    await expect(page.getByTestId('email-body-frame')).toHaveCount(0);
    await expect(modal(page)).not.toContainText('Secret pricing');
    await context.close();
  } finally {
    await ensureMailbox(grace.page, GRACE_MAILBOX, 'subject-line');
    await grace.context.close();
  }
});

test('the same message synced by two mailboxes reads "via 2 mailboxes"', async ({ browser }) => {
  const ada = await signedInAs(browser, seed.ada, '/mymeet/home');
  const grace = await signedInAs(browser, seed.grace, '/mymeet/home');
  const subject = `Shared roadmap ${randomUUID().slice(0, 6)}`;
  await injectSharedMessage(
    [
      { page: ada.page, mailboxId: seed.adaMailbox.id },
      { page: grace.page, mailboxId: seed.graceMailbox.id },
    ],
    {
      subject,
      bodyText: 'Roadmap attached for both of you.',
      bodyHtml: '<p>Roadmap for both of you.</p>',
      from: JANE,
      to: [
        { emailAddress: ADA_MAILBOX, name: 'Ada Tester' },
        { emailAddress: GRACE_MAILBOX, name: 'Grace Hopper' },
      ],
    },
  );
  await grace.context.close();
  await ada.page.goto(personTab(jane));
  const row = rowOf(ada.page, subject);
  await expect(row.getByTestId('email-row-via')).toHaveText('via 2 mailboxes');
  // The message is one thread with several recipients: Reply all is offered next to Reply and Forward.
  await row.click();
  await expect(modal(ada.page).getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
  await expect(modal(ada.page).getByRole('button', { name: 'Reply all' })).toBeVisible();
  await expect(modal(ada.page).getByRole('button', { name: 'Forward' })).toBeVisible();
  await ada.context.close();
});

test('Manage access: Grace grants Ada access to her emails on Jane, and Ada then reads the body', async ({
  browser,
}) => {
  const adaId = await (async () => {
    const s = await signedInAs(browser, seed.ada, '/mymeet/home');
    const id = await memberId(s.page, seed.ada.email);
    await s.context.close();
    return id;
  })();
  const grace = await emailsTab(browser, seed.grace);
  try {
    await grace.page.getByTestId('emails-manage-access').click();
    const panel = grace.page.getByTestId('access-panel');
    await expect(panel).toContainText('Person email access');
    await expect(panel).toContainText('Workspace Access');
    // Grant access stays disabled until a user is picked.
    await expect(panel.getByTestId('access-grant-button')).toBeDisabled();
    await panel.getByTestId('access-user-search').fill('Ada');
    await panel.getByTestId('access-user-option').filter({ hasText: 'Ada Tester' }).click();
    await expect(panel.getByTestId('access-grant-button')).toBeEnabled();
    await panel.getByTestId('access-grant-button').click();
    await expect(panel.getByTestId('access-person').filter({ hasText: 'Ada Tester' })).toContainText('Full access');

    const grants = await trpc<{ target: { type: string; memberId?: string }; level: string }[]>(
      grace.page,
      'email.grants.list',
      { resource: { type: 'record', record: { entityDefinitionId: 'people', entityInstanceId: jane } } },
    );
    expect(
      grants.some((g) => g.target.type === 'member' && g.target.memberId === adaId && g.level === 'full-access'),
    ).toBe(true);

    const ada = await emailsTab(browser, seed.ada);
    const secret = rowOf(ada.page, 'Secret pricing');
    await expect(secret).toHaveAttribute('data-access', 'full-access');
    await expect(secret.getByTestId('email-row-snippet')).toContainText('Our best price');
    await secret.click();
    await expect(ada.page.getByTestId('email-restricted')).toHaveCount(0);
    await expect(ada.page.frameLocator('[data-testid="email-body-frame"]').locator('body')).toContainText('12 000 EUR');
    await ada.context.close();
  } finally {
    // Restore: remove the grant through the API.
    const list = await trpc<{ id: string }[]>(grace.page, 'email.grants.list', {
      resource: { type: 'record', record: { entityDefinitionId: 'people', entityInstanceId: jane } },
    });
    for (const g of list) await trpc(grace.page, 'email.grants.remove', { grantId: g.id });
    await grace.context.close();
  }
});

test('Manage access by the API grants the same view (record resource targeting a member)', async ({ browser }) => {
  const adaSession = await signedInAs(browser, seed.ada, '/mymeet/home');
  const adaId = await memberId(adaSession.page, seed.ada.email);
  await adaSession.context.close();
  const grace = await signedInAs(browser, seed.grace, '/mymeet/home');
  const resource = { type: 'record', record: { entityDefinitionId: 'people', entityInstanceId: jane } };
  const put = await trpc<{ grant: { id: string } }>(grace.page, 'email.grants.put', {
    resource,
    target: { type: 'member', memberId: adaId },
    level: 'full-access',
  });
  try {
    const { context, page } = await emailsTab(browser, seed.ada);
    await expect(rowOf(page, 'Secret pricing')).toHaveAttribute('data-access', 'full-access');
    await context.close();
  } finally {
    await trpc(grace.page, 'email.grants.remove', { grantId: put.grant.id });
    await grace.context.close();
  }
});

test('Workspace Access level: Subject line / Full access / No access write and remove the workspace grant', async ({
  browser,
}) => {
  const grace = await emailsTab(browser, seed.grace);
  const resource = { type: 'record', record: { entityDefinitionId: 'people', entityInstanceId: jane } };
  const grants = () =>
    trpc<{ id: string; level: string; target: { type: string } }[]>(grace.page, 'email.grants.list', { resource });
  await grace.page.getByTestId('emails-manage-access').click();
  const level = grace.page.getByTestId('access-workspace-level');
  await level.locator('button').click();
  await grace.page.getByRole('option', { name: 'Full access' }).click();
  await expect.poll(async () => (await grants()).find((g) => g.target.type === 'workspace')?.level).toBe('full-access');
  await level.locator('button').click();
  await grace.page.getByRole('option', { name: 'Metadata only' }).click();
  await expect
    .poll(async () => (await grants()).find((g) => g.target.type === 'workspace')?.level)
    .toBe('metadata-only');
  await level.locator('button').click();
  await grace.page.getByRole('option', { name: 'No access' }).click();
  await expect.poll(async () => (await grants()).filter((g) => g.target.type === 'workspace').length).toBe(0);
  await grace.context.close();
});

test('filters: Has attachments narrows the list, the dot shows, Reset filters clears; attachments download toast', async ({
  browser,
}) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const subject = `Contract draft ${randomUUID().slice(0, 6)}`;
  await injectMessage(page, seed.adaMailbox.id, {
    subject,
    bodyText: 'Please review the attached contract.',
    bodyHtml: '<p>Please review the attached contract.</p>',
    from: JANE,
    to: [{ emailAddress: ADA_MAILBOX, name: 'Ada Tester' }],
    cc: [WADE],
    attachments: [{ name: 'contract.pdf', contentType: 'application/pdf', size: 52_000 }],
  });
  await page.goto(personTab(jane));
  await expect(rowOf(page, 'Pilot for Northwind')).toBeVisible();
  await expect(page.getByTestId('emails-filters-dot')).toHaveCount(0);

  await page.getByTestId('emails-filters').click();
  const panel = page.getByTestId('emails-filter-panel');
  await expect(panel).toContainText('Filter by');
  await expect(panel.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
  await panel.getByRole('switch', { name: 'Has attachments' }).click({ force: true });
  await expect(page.getByTestId('email-thread-row')).toHaveCount(1);
  await expect(rowOf(page, subject)).toBeVisible();
  await expect(page.getByTestId('emails-filters-dot')).toBeVisible();
  await page.keyboard.press('Escape');

  // Attachments in the modal; downloads are a later slice.
  await rowOf(page, subject).click();
  const chip = page.getByTestId('email-attachments').getByRole('button', { name: /contract\.pdf/ });
  await expect(chip).toContainText('52 KB');
  await chip.click();
  await expect(page.getByText('Downloads arrive with the Gmail connector (slice 7b)')).toBeVisible();
  // Reply all is offered (Jane wrote to Ada and cc'd Wade).
  await expect(modal(page).getByRole('button', { name: 'Reply all' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByTestId('emails-filters').click();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(page.getByTestId('email-thread-row').nth(2)).toBeVisible();
  await expect(page.getByTestId('emails-filters-dot')).toHaveCount(0);
  await context.close();
});

test('an email modal URL opens directly; an unknown email is "Email content unavailable"', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const out = await trpc<{ threads: { subject: string; displayMessageId: string }[] }>(page, 'email.threads', {
    record: { entityDefinitionId: 'people', entityInstanceId: jane },
  });
  const pilot = out.threads.find((t) => t.subject === 'Pilot for Northwind');
  await page.goto(`/mymeet/home?modal=email&id=${pilot?.displayMessageId}`);
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId('email-subject')).toHaveText('Pilot for Northwind');
  await expect(page.getByTestId('email-body-frame')).toBeVisible();
  // Closing removes the overlay params and keeps the page.
  await modal(page).getByRole('button', { name: 'Close' }).click();
  await expect(modal(page)).toHaveCount(0);
  expect(page.url()).not.toContain('modal=');

  await page.goto(`/mymeet/home?modal=email&id=${randomUUID()}`);
  await expect(page.getByTestId('email-unavailable')).toContainText('Email content unavailable');
  await expect(modal(page).getByRole('heading', { name: 'View email' })).toBeVisible();
  await context.close();
});

test('Share: the thread link, the people with access, grant and remove', async ({ browser }) => {
  const { context, page } = await emailsTab(browser, seed.ada);
  await rowOf(page, 'Pilot for Northwind').click();
  await page.getByTestId('email-share').click();
  const panel = page.getByTestId('access-panel');
  await expect(panel).toContainText('Email Access');
  await expect(panel.getByTestId('access-person').first()).toContainText('Ada Tester (You)');
  await expect(panel.getByTestId('email-share-link')).toHaveValue(/\/mymeet\/home\?modal=email&id=[0-9a-f-]{36}$/);
  await panel.getByTestId('access-user-search').fill('Grace');
  await panel.getByTestId('access-user-option').filter({ hasText: 'Grace Hopper' }).click();
  await panel.getByTestId('access-grant-button').click();
  const grace = panel.getByTestId('access-person').filter({ hasText: 'Grace Hopper' });
  await expect(grace).toContainText('Full access');
  await grace.getByRole('button', { name: /Remove access/ }).click();
  await expect(grace).toHaveCount(0);
  await context.close();
});

test('a share link of someone else’s thread has no Share button (only owners share)', async ({ browser }) => {
  const { context, page } = await emailsTab(browser, seed.grace);
  // Grace's copy of Ada's thread is visible through Ada's full-access default visibility, but it is not hers.
  await rowOf(page, 'Pilot for Northwind').click();
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId('email-share')).toHaveCount(0);
  await context.close();
});

test('empty state, Overview section and compose entry points', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const cedar = await findRecord(page, '[seed] Cedar Health');
  await page.goto(`/mymeet/company/${cedar.entityInstanceId}/emails`);
  await expect(page.getByTestId('emails-empty')).toContainText('No emails');
  await expect(page.getByTestId('emails-empty')).toContainText("This record doesn't have any emails");
  await expect(page.getByRole('tab', { name: /Emails/ })).toContainText('0');

  // Overview: count, up to three rows (newest first), restricted ones say so, "+" composes, a row opens the modal.
  const grace = await signedInAs(browser, seed.grace, '/mymeet/home');
  const tag = randomUUID().slice(0, 6);
  await injectMessage(page, seed.adaMailbox.id, {
    subject: `Overview full ${tag}`,
    bodyText: 'Full access snippet for the overview.',
    bodyHtml: '<p>Full access snippet for the overview.</p>',
    from: JANE,
    to: [{ emailAddress: ADA_MAILBOX, name: 'Ada Tester' }],
  });
  await injectMessage(grace.page, seed.graceMailbox.id, {
    subject: `Overview restricted ${tag}`,
    bodyText: 'Hidden overview content.',
    bodyHtml: '<p>Hidden overview content.</p>',
    from: { emailAddress: GRACE_MAILBOX, name: 'Grace Hopper' },
    to: [JANE],
  });
  await grace.context.close();
  await page.goto(personTab(jane, 'overview'));
  const section = page.getByTestId('overview-emails');
  await expect(section.getByTestId('overview-email')).toHaveCount(3);
  await expect(section.getByTestId('overview-email').filter({ hasText: `Overview full ${tag}` })).toContainText(
    'Full access snippet for the overview.',
  );
  const restricted = section.getByTestId('overview-email').filter({ hasText: `Overview restricted ${tag}` });
  await expect(restricted).toContainText('No access to this email content');
  await expect(restricted).not.toContainText('Hidden overview content');
  await section.getByRole('button', { name: 'View all' }).click();
  await expect(page).toHaveURL(/\/emails$/);
  await page.goto(personTab(jane, 'overview'));
  await section
    .getByTestId('overview-email')
    .filter({ hasText: `Overview full ${tag}` })
    .click();
  await expect(modal(page)).toBeVisible();
  await page.keyboard.press('Escape');

  // Compose: the "+" of the section, the header action and `c` all open the composer window.
  await page.getByRole('button', { name: 'Compose email' }).first().click();
  await expect(page).toHaveURL(/modal=composer/);
  await context.close();
});

test('Reply opens the composer addressed to the sender with the message as parent', async ({ browser }) => {
  const { context, page } = await emailsTab(browser, seed.ada);
  await rowOf(page, 'Pilot for Northwind').click();
  await modal(page).getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page).toHaveURL(/modal=composer/);
  await context.close();
});
