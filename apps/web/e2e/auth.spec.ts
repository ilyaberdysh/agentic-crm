// BACKLOG §1 acceptance 2: the logged-out routing matrix (K README §2.1), return-to after sign-in, sign-in errors,
// sign-out.
import { expect, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { pathOf, signIn, submitSignIn } from './support.ts';

test.describe('logged-out routing matrix', () => {
  const matrix: Array<[opened: string, final: string]> = [
    ['/', '/auth/sign-in'],
    ['/auth', '/auth/sign-in'],
    ['/auth/temporary-password', '/auth/sign-in'],
    ['/auth/join/acme', '/auth/sign-in?origin=%2Fauth%2Fjoin%2Facme'],
    [`/${WORKSPACE_SLUG}/home`, `/auth/sign-in?origin=%2F${WORKSPACE_SLUG}%2Fhome`],
    [`/${WORKSPACE_SLUG}/companies?x=1`, `/auth/sign-in?origin=%2F${WORKSPACE_SLUG}%2Fcompanies%3Fx%3D1`],
    ['/welcome', '/welcome/sign-in'],
    ['/welcome/personal-details', '/welcome/sign-in'],
    ['/welcome/workspace-details', '/welcome/sign-in'],
    ['/onboarding', '/welcome/sign-in'],
    ['/onboarding/about-you', '/welcome/sign-in'],
    [`/${WORKSPACE_SLUG}/welcome`, '/welcome/sign-in'],
    ['/deleting-account', '/workspaces'],
  ];
  for (const [opened, final] of matrix) {
    test(`${opened} → ${final}`, async ({ page }) => {
      await page.goto(opened);
      await expect.poll(() => pathOf(page)).toBe(final);
    });
  }

  test('/workspaces shows the error state with Sign out', async ({ page }) => {
    await page.goto('/workspaces');
    await expect(page.getByText('Something went wrong.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    expect(pathOf(page)).toBe('/workspaces');
  });

  test('sign-up without an invite explains it is by invitation', async ({ page }) => {
    await page.goto('/welcome/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign-up is by invitation' })).toBeVisible();
  });
});

test('wrong password shows the inline error and keeps the user on sign-in', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await submitSignIn(page, 'definitely-not-the-password');
  await expect(page.getByText('Email or password not entered correctly')).toBeVisible();
  expect(pathOf(page)).toBe('/auth/sign-in');
});

test('validation: empty fields', async ({ page }) => {
  await page.goto('/auth/sign-in');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Please enter a valid email')).toBeVisible();
  await expect(page.getByText('Please enter your password')).toBeVisible();
});

test('a deep link opened while signed out returns to that page after sign-in', async ({ page }) => {
  await page.goto(`/${WORKSPACE_SLUG}/settings/appearance`);
  await expect.poll(() => pathOf(page)).toBe(`/auth/sign-in?origin=%2F${WORKSPACE_SLUG}%2Fsettings%2Fappearance`);
  await submitSignIn(page);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/settings/appearance$`));
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
});

test('signed in: /auth/sign-in and / go to the workspace', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
  await page.goto('/auth/sign-in');
  await expect(page).toHaveURL(new RegExp(`/${WORKSPACE_SLUG}/home$`));
});

test('sign out from the workspace menu ends the session', async ({ page }) => {
  await signIn(page, `/${WORKSPACE_SLUG}/home`);
  await page.getByRole('button', { name: /Workspace menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await page.goto(`/${WORKSPACE_SLUG}/home`);
  await expect.poll(() => pathOf(page)).toBe(`/auth/sign-in?origin=%2F${WORKSPACE_SLUG}%2Fhome`);
});

test('sign-out in one tab signs out the other tabs', async ({ context }) => {
  const a = await context.newPage();
  await signIn(a, `/${WORKSPACE_SLUG}/home`);
  const b = await context.newPage();
  await b.goto(`/${WORKSPACE_SLUG}/tasks`);
  await expect(b.getByTestId('page-header')).toContainText('Tasks');
  await a.getByRole('button', { name: /Workspace menu/ }).click();
  await a.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(b).toHaveURL(/\/auth\/sign-in/);
});
