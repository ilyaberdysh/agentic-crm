// Settings administration: profile (names on blur, avatar upload and
// removal, time preferences), workspace general (name, slug availability, slug change), members (invite dialog
// validation, pending invites, copy link, revoke), teams (create, members, usage, delete), security (export formula
// switch), the settings navigation search and the read-only members page for non-admins.
import { expect, type Page, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { newMember, PNG_1X1 } from './settings-support.ts';
import { trpc, uuid } from './slice3-support.ts';
import { signIn } from './support.ts';

const settings = (path: string) => `/${WORKSPACE_SLUG}/settings/${path}`;

test.describe.configure({ mode: 'serial' });

test('profile: names save on blur and survive a reload; time preferences; avatar upload and removal', async ({
  page,
}) => {
  await signIn(page, settings('account'));
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
  await expect(page.getByText('Changes to your profile will apply to all of your workspaces.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Primary email address' })).toHaveValue('e2e@mymeet.ai');

  const last = page.getByLabel('Last Name');
  await last.fill('Tester-X');
  const saved = page.waitForResponse((r) => r.url().includes('profile.update') && r.ok());
  await last.press('Tab');
  await saved;
  await page.reload();
  await expect(page.getByLabel('Last Name')).toHaveValue('Tester-X');

  // Time preferences: Start week on.
  await page.getByRole('button', { name: /Start week on/ }).click();
  const week = page.waitForResponse((r) => r.url().includes('profile.update') && r.ok());
  await page.getByRole('option', { name: 'Saturday' }).click();
  await week;
  await page.reload();
  await expect(page.getByRole('button', { name: /Start week on/ })).toContainText('Saturday');

  // Avatar: upload, shown, remove.
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await expect(page.getByRole('button', { name: 'Remove avatar' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove avatar' }).click();
  await expect(page.getByRole('button', { name: 'Remove avatar' })).toHaveCount(0);

  // Restore the shared account (later specs read "Ada" and week starts).
  await page.getByLabel('Last Name').fill('Tester');
  await page.getByLabel('Last Name').press('Tab');
  await trpc(page, 'profile.update', { weekStart: null });
  await page.reload();
  await expect(page.getByLabel('Last Name')).toHaveValue('Tester');
});

test('profile: avatar upload shows the picture', async ({ page }) => {
  await signIn(page, settings('account'));
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG_1X1 });
  const avatar = page.getByRole('main').getByRole('img', { name: 'Ada Tester' });
  await expect(avatar.locator('img')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove avatar' }).click();
  await expect(page.getByRole('button', { name: 'Remove avatar' })).toHaveCount(0);
});

test('workspace general: name saves on blur; the slug is checked as you type', async ({ page }) => {
  await signIn(page, settings('workspace'));
  await expect(page.getByRole('heading', { name: 'General', level: 1 })).toBeVisible();
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('mymeet');
  await name.fill('mymeet HQ');
  const saved = page.waitForResponse((r) => r.url().includes('workspace.update') && r.ok());
  await name.press('Tab');
  await saved;
  // The sidebar header follows the new name.
  await page.goto(`/${WORKSPACE_SLUG}/home`);
  await expect(page.getByRole('button', { name: /Workspace menu: mymeet HQ/ })).toBeVisible();
  await page.goto(settings('workspace'));
  await page.getByLabel('Name', { exact: true }).fill('mymeet');
  const restored = page.waitForResponse((r) => r.url().includes('workspace.update') && r.ok());
  await page.getByLabel('Name', { exact: true }).press('Tab');
  await restored;
  await page.goto(`/${WORKSPACE_SLUG}/home`);
  await expect(page.getByRole('button', { name: /Workspace menu: mymeet$/ })).toBeVisible();
  await page.goto(settings('workspace'));

  const slug = page.getByRole('textbox', { name: 'Slug' });
  await slug.fill('not valid');
  await expect(page.getByTestId('slug-status')).toContainText('Use lower-case letters, digits and single hyphens');
  await slug.fill('mymeet-next');
  await expect(page.getByTestId('slug-status')).toContainText('This slug is available');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await slug.fill('mymeet');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
});

test('workspace general: changing the slug of a workspace moves its URLs', async ({ page }) => {
  await signIn(page, settings('account'));
  const suffix = uuid().slice(0, 8);
  const first = `slug-lab-${suffix}`;
  const second = `slug-lab-b-${suffix}`;
  await trpc(page, 'workspaces.create', { id: uuid(), name: 'Slug lab', slug: first });
  await page.goto(`/${first}/settings/workspace`);
  const slug = page.getByRole('textbox', { name: 'Slug' });
  await slug.fill(second);
  await expect(page.getByTestId('slug-status')).toContainText('This slug is available');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change slug' }).click();
  await expect(page).toHaveURL(new RegExp(`/${second}/settings/workspace$`));
  await expect(page.getByRole('textbox', { name: 'Slug' })).toHaveValue(second);
});

test('security: the export formula-injection switch persists', async ({ page }) => {
  await signIn(page, settings('security'));
  await expect(page.getByRole('heading', { name: 'Security', level: 1 })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'Protect CSV exports against formula injection' });
  await expect(toggle).not.toBeChecked();
  const saved = page.waitForResponse((r) => r.url().includes('workspace.settings.update') && r.ok());
  await toggle.click({ force: true });
  await saved;
  await page.reload();
  await expect(toggle).toBeChecked();
  const off = page.waitForResponse((r) => r.url().includes('workspace.settings.update') && r.ok());
  await toggle.click({ force: true });
  await off;
  await page.reload();
  await expect(toggle).not.toBeChecked();
});

const memberRows = (page: Page) => page.getByRole('table', { name: 'Members' }).getByRole('row');

test('members: invite dialog validation, pending invites, copy link and revoke', async ({ page }) => {
  await signIn(page, settings('members-and-teams'));
  await expect(page).toHaveURL(new RegExp(`/settings/members-and-teams/members$`));
  await expect(page.getByRole('heading', { name: 'Members and teams', level: 1 })).toBeVisible();
  await expect(memberRows(page).filter({ hasText: 'Ada Tester' })).toContainText('(You)');
  await expect(memberRows(page).filter({ hasText: 'Ada Tester' })).toContainText('Admin');

  await page.getByRole('button', { name: 'Invite members' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite members' });
  await expect(dialog.getByLabel('Send Invite to ...')).toBeFocused();
  await dialog.getByRole('button', { name: /Send Invites/ }).click();
  await expect(dialog.getByText('Provide at least one email to invite')).toBeVisible();

  const input = dialog.getByLabel('Send Invite to ...');
  await input.fill('nope');
  await input.press('Enter');
  await dialog.getByRole('button', { name: /Send Invites/ }).click();
  await expect(dialog.getByText('This email looks invalid')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove nope' }).click();

  await input.fill('dup@example.com, dup@example.com ');
  await dialog.getByRole('button', { name: /Send Invites/ }).click();
  await expect(dialog.getByText('This email is already in the list')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove dup@example.com' }).first().click();
  await dialog.getByRole('button', { name: 'Remove dup@example.com' }).first().click();

  await input.fill('first-invite@example.com second-invite@example.com ');
  // Invite as Admin for the second address is not offered per address: both are Members here.
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(memberRows(page).filter({ hasText: 'first-invite@example.com' })).toContainText('Invite pending');
  await expect(memberRows(page).filter({ hasText: 'second-invite@example.com' })).toContainText('Invite pending');

  // The same address again is refused by the server.
  await page.getByRole('button', { name: 'Invite members' }).click();
  const again = page.getByRole('dialog', { name: 'Invite members' });
  await again.getByLabel('Send Invite to ...').fill('first-invite@example.com ');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(again.getByText('This email has already been invited')).toBeVisible();
  await page.keyboard.press('Escape');

  // Copy link and revoke.
  const row = memberRows(page).filter({ hasText: 'first-invite@example.com' });
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Copy invite link' }).click();
  await expect(page.getByText('Link copied to clipboard')).toBeVisible();
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke invite' }).click();
  await expect(memberRows(page).filter({ hasText: 'first-invite@example.com' })).toHaveCount(0);
  const second = memberRows(page).filter({ hasText: 'second-invite@example.com' });
  await second.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Revoke invite' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke invite' }).click();
  await expect(second).toHaveCount(0);

  // Filter: nobody is suspended.
  await page.getByRole('button', { name: 'Filter' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Suspended' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('No members match that filter')).toBeVisible();
});

test('teams: create, members, usage, delete; the empty state', async ({ page }) => {
  await signIn(page, settings('members-and-teams/teams'));
  // The empty state needs a workspace without teams: drop the ones earlier specs left (parity- re-creates its
  // [seed] team when it runs again).
  const existing = await trpc<{ id: string }[]>(page, 'teams.list', {});
  if (existing.length > 0) {
    for (const t of existing) await trpc(page, 'teams.delete', { teamId: t.id });
    await page.reload();
  }
  await expect(page.getByRole('heading', { name: 'Members and teams', level: 1 })).toBeVisible();
  await expect(page.getByText('Keep your workspace organized with teams')).toBeVisible();
  await page.getByRole('button', { name: 'Create first team' }).click();
  const dialog = page.getByRole('dialog', { name: 'New team' });
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog.getByText('Please provide a name for the team.')).toBeVisible();
  await dialog.getByLabel('Team name').fill('[e2e] Sales');
  await dialog.getByLabel('Team description').fill('Everyone who sells');
  await page.keyboard.press('ControlOrMeta+Enter');
  const teams = page.getByRole('table', { name: 'Teams' });
  await expect(teams.getByRole('row').filter({ hasText: '[e2e] Sales' })).toContainText('0');

  await teams.getByRole('row').filter({ hasText: '[e2e] Sales' }).click();
  await expect(page).toHaveURL(/\/teams\/[0-9a-f-]{36}\/configuration$/);
  await expect(page.getByRole('heading', { name: '[e2e] Sales', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Team description')).toHaveValue('Everyone who sells');
  const name = page.getByLabel('Team name');
  await name.fill('[e2e] Sales team');
  const saved = page.waitForResponse((r) => r.url().includes('teams.update') && r.ok());
  await name.press('Tab');
  await saved;
  await expect(page.getByRole('heading', { name: '[e2e] Sales team', level: 1 })).toBeVisible();

  await page.getByRole('tab', { name: /Members/ }).click();
  await expect(page.getByText('You have not added members to this team')).toBeVisible();
  await page.getByRole('button', { name: 'Add members' }).click();
  const picker = page.getByRole('dialog', { name: 'Invite to team' });
  await picker.getByRole('option', { name: /Ada Tester/ }).click();
  await picker.getByRole('button', { name: 'Confirm' }).click();
  const members = page.getByRole('table', { name: 'Team members' });
  await expect(members.getByRole('row').filter({ hasText: 'Ada Tester' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Members/ })).toContainText('1');

  await page.getByRole('tab', { name: /Usage/ }).click();
  await expect(page.getByText('This team is not used anywhere')).toBeVisible();

  await page.getByRole('tab', { name: /Configuration/ }).click();
  await page.getByRole('button', { name: 'Delete team' }).first().click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('This team is not used anywhere')).toBeVisible();
  await confirm.getByRole('button', { name: 'Permanently delete team' }).click();
  await expect(page).toHaveURL(/\/members-and-teams\/teams$/);
  await expect(page.getByText('Keep your workspace organized with teams')).toBeVisible();
});

test('settings navigation search lists matching entries and subsections', async ({ page }) => {
  await signIn(page, settings('account'));
  const search = page.getByRole('searchbox', { name: 'Search settings' });
  await search.fill('theme');
  await expect(
    page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Appearance' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Theme' })).toBeVisible();
  await search.fill('webhooks');
  await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Webhooks' }).click();
  await expect(page).toHaveURL(new RegExp(`/settings/developers/webhooks$`));
  await search.fill('zzzz');
  await expect(page.getByText('No results found')).toBeVisible();
});

test('non-admins: admin settings are hidden and redirected; members see the read-only list', async ({
  browser,
  page,
}) => {
  await signIn(page, settings('account'));
  const reader = await newMember(browser, page, { email: 'plain-member@example.com', name: 'Pat Member' });
  try {
    const p = reader.page;
    await p.goto(settings('account'));
    const nav = p.getByRole('navigation', { name: 'Settings' });
    await expect(nav.getByRole('link', { name: 'Profile' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Members', exact: true })).toBeVisible();
    for (const hidden of ['Members and teams', 'Developers', 'Security', 'General']) {
      await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
    }
    await p.goto(settings('members-and-teams'));
    await expect(p).toHaveURL(new RegExp(`/settings/members-read-only$`));
    await expect(p.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    const table = p.getByRole('table', { name: 'Members' });
    await expect(table.getByRole('row').filter({ hasText: 'Ada Tester' })).toContainText('Admin');
    await expect(table.getByRole('row').filter({ hasText: 'Pat Member' })).toContainText('(You)');
    await expect(table.getByRole('button', { name: 'Options' })).toHaveCount(0);
    for (const path of ['developers', 'workspace', 'security']) {
      await p.goto(settings(path));
      await expect(p).toHaveURL(new RegExp(`/settings/account$`));
    }
  } finally {
    await reader.context.close();
  }
  // The admin sees the member and can change the role and suspend / reactivate.
  await page.goto(settings('members-and-teams/members'));
  const rows = memberRows(page);
  const row = rows.filter({ hasText: 'Pat Member' });
  await expect(row).toContainText('Member');
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Make workspace admin' }).click();
  await expect(row).toContainText('Admin');
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Make workspace member' }).click();
  await expect(row).toContainText('Member');
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Suspend from workspace' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Suspend' }).click();
  await expect(row).toContainText('Suspended');
  await row.getByRole('button', { name: 'Options' }).click();
  await page.getByRole('menuitem', { name: 'Reactivate user' }).click();
  await expect(row).toContainText('Member');
  await row.click();
  await expect(page).toHaveURL(/\/members\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Pat Member', level: 1 })).toBeVisible();
  await expect(page.getByText('See all teams this user belongs to')).toBeVisible();
});
