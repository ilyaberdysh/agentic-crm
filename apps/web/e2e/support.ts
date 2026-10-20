// Shared e2e helpers: the seeded account and a UI sign-in.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { credentialsFile, E2E_DATABASE } from './env.ts';

const here = dirname(fileURLToPath(import.meta.url));

export function credentials(): { email: string; password: string } {
  return JSON.parse(readFileSync(join(here, '.auth', credentialsFile(E2E_DATABASE)), 'utf8'));
}

/** Fills the sign-in form on the current page and waits until it leaves /auth/sign-in. */
export async function submitSignIn(page: Page, password = credentials().password): Promise<void> {
  await page.getByLabel('Email address').fill(credentials().email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function signIn(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await submitSignIn(page);
  await expect(page).not.toHaveURL(/\/auth\/sign-in/);
}

/** Path + search of the page, decoded for readable assertions. */
export function pathOf(page: Page): string {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

export const sidebar = (page: Page) => page.locator('aside').first();

/**
 * Lifts the sidebar's Records cap (6 objects, then "All objects") for this browser context: specs of a full run
 * leave custom objects behind, which push standard objects behind the cap. Reloads the page.
 */
export async function showAllSidebarObjects(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('ar:sidebar-records-show-all', 'true'));
  await page.reload();
}
