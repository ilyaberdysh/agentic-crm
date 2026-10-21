// Reproducible storefront capture: seeded Northwind evidence → human approval → task receipt.
import { mkdirSync } from 'node:fs';
import { type Browser, expect, test } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { findRecord, recordPath } from './record-support.ts';
import { submitSignIn } from './support.ts';

async function signedInState(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(`/auth/sign-in?origin=${encodeURIComponent(`/${WORKSPACE_SLUG}/home`)}`);
  await submitSignIn(page);
  await page.waitForURL((url) => !url.pathname.startsWith('/auth/'));
  const northwind = await findRecord(page, '[seed] Northwind Robotics');
  const storageState = await context.storageState();
  await context.close();
  return { storageState, recordUrl: recordPath('company', northwind.entityInstanceId, 'agent') };
}

test('record the seeded agent review and receipt flow', async ({ browser }, testInfo) => {
  const { storageState, recordUrl } = await signedInState(browser);
  const videoDir = testInfo.outputPath('video');
  mkdirSync(videoDir, { recursive: true });
  const context = await browser.newContext({
    storageState,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'reduce',
    recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  await page.goto(recordUrl);

  const state = page.locator('[data-testid^="agent-state-"]');
  await expect(page.getByTestId('agent-state-proposed')).toBeVisible();
  await expect(page.getByTestId('agent-evidence-item')).toContainText(
    'Could you send over the rollout timeline by Friday?',
  );
  await page.waitForTimeout(900);

  // Approval and the exact approved task write are one supervised UI action in the Agent tab.
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('agent-state-completed')).toBeVisible();
  await expect(state).toContainText('Created task “Send the rollout timeline by Friday”.');
  await expect(state.getByText('Receipt', { exact: true })).toBeVisible();
  await page.waitForTimeout(1400);
  await context.close();
});
