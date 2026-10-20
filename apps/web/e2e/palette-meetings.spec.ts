// The command palette's "Upcoming meetings" page (command-palette.md §2): today's and tomorrow's meetings of the member;
// selecting one opens the meeting modal.
import { expect, test } from '@playwright/test';
import { ws } from './slice3-support.ts';
import { openPalette, paletteRows, signedInAs } from './slice5-support.ts';
import { ADA_MAILBOX, injectEvent, JANE, seedSlice7 } from './slice7-support.ts';

test('View upcoming meetings lists the next meetings and opens the modal', async ({ browser }) => {
  const seed = await seedSlice7(browser);
  const { context, page } = await signedInAs(browser, seed.ada, ws('home'));
  const title = `Palette sync ${Date.now()}`;
  const start = new Date(Date.now() + 2 * 3_600_000);
  await injectEvent(page, seed.adaMailbox.id, {
    title,
    start: start.toISOString(),
    end: new Date(start.getTime() + 3_600_000).toISOString(),
    attendees: [
      { emailAddress: ADA_MAILBOX, name: 'Ada Tester', status: 'accepted', isOrganizer: true },
      { ...JANE, status: 'accepted' },
    ],
  });
  await page.reload();
  await openPalette(page);
  await page.getByTestId('palette-input').fill('upcoming meetings');
  await page.keyboard.press('Enter');
  const row = paletteRows(page).filter({ hasText: title });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByTestId('meeting-modal')).toBeVisible();
  await expect(page.getByTestId('meeting-title')).toHaveText(title);
  await context.close();
});
