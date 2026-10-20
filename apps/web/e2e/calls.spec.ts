// Slice 10 calls UI (BACKLOG 10.11–10.15): the Calls list, the call page (transcript with speaker blocks, range links
// and the selection popover; speakers with focus; meeting; summary and insights), insight templates (list, editor,
// presets, preview, publish / discard), calls on record pages, live updates (X-27) and Settings → Call intelligence.
// Calls are imported through the public /v2 path (the mymeet integration) on a stack running AGENTIC_CRM_LLM=fake.
import { expect, type Page, test } from '@playwright/test';
import {
  callUrl,
  deleteCallsLike,
  ensureNorthwind,
  type ImportedCall,
  importCall,
  NORTHWIND_TITLE,
} from './calls-support.ts';
import { signedInPage, trpc, ws } from './slice3-support.ts';
import { mod } from './slice5-support.ts';

let northwind: ImportedCall;

test.beforeAll(async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  try {
    northwind = await ensureNorthwind(page);
  } finally {
    await context.close();
  }
});

/** Rows of the Calls list by title. */
const rowOf = (page: Page, title: string) => page.getByTestId('call-row').filter({ hasText: title });

test.describe('Calls list', () => {
  test('shows the imported call with its record, participants, duration and date group', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('calls'));
    try {
      await expect(page.getByTestId('calls-page')).toBeVisible();
      const row = rowOf(page, NORTHWIND_TITLE);
      await expect(row).toBeVisible();
      await expect(row.getByTestId('call-row-title')).toHaveText(NORTHWIND_TITLE);
      await expect(row).toContainText('30min');
      await expect(row.getByTestId('call-row-records')).toContainText('Northwind');
      await expect(row.getByTestId('participant-stack')).toBeVisible();
      await expect(page.getByTestId('calls-group').first()).toBeVisible();
      // 52 px rows
      const box = await row.boundingBox();
      expect(Math.round(box?.height ?? 0)).toBe(52);
      await expect(page.getByTestId('calls-tab-count-calls')).not.toHaveText('0');
    } finally {
      await context.close();
    }
  });

  test('search mirrors ?query= and filters; clearing restores the list', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('calls'));
    try {
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      await page.keyboard.press(`${mod}+f`);
      const input = page.getByTestId('calls-search-input');
      await expect(input).toBeFocused();
      await input.fill('zzz-no-such-call');
      await expect(page).toHaveURL(/query=zzz-no-such-call/);
      await expect(page.getByTestId('calls-no-match')).toContainText('No calls found');
      await page.getByTestId('calls-clear-filters').click();
      await expect(page).not.toHaveURL(/query=/);
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // a match in the transcript text
      await page.getByTestId('calls-search-input').fill('Rotterdam');
      await expect(page).toHaveURL(/query=Rotterdam/);
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // a direct link keeps the query
      await page.goto(`${ws('calls')}?query=Northwind`);
      await expect(page.getByTestId('calls-search-input')).toHaveValue('Northwind');
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('filters by record, participant and team; "is not" excludes; chips remove', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('calls'));
    try {
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // Record: [seed] Northwind Robotics
      await page.getByTestId('calls-filter').click();
      await page.getByTestId('filter-record').click();
      await page
        .getByRole('option', { name: /Northwind Robotics/ })
        .first()
        .click();
      const chip = page.getByTestId('calls-filter-chip').first();
      await expect(chip).toContainText('Record');
      await expect(chip).toContainText('Northwind Robotics');
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // "is not" excludes the call
      await page.getByTestId('calls-filter-operator').click();
      await expect(chip).toContainText('is not');
      await expect(page.getByTestId('calls-no-match')).toBeVisible();
      await chip.getByRole('button', { name: 'Remove filter' }).click();
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // Participant: a person record of the call
      await page.getByTestId('calls-filter').click();
      await page.getByTestId('filter-participant').click();
      await page.getByTestId('participant-filter-input').fill('Jane');
      await page
        .getByRole('option', { name: /Jane Cooper/ })
        .first()
        .click();
      await expect(page.getByTestId('calls-filter-chip').first()).toContainText('Participant');
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      // the filters survive a reload (kept in the browser)
      await page.reload();
      await expect(page.getByTestId('calls-filter-chip')).toHaveCount(1);
      await page.getByTestId('calls-filter-chip').getByRole('button', { name: 'Remove filter' }).click();
      await expect(page.getByTestId('calls-filter-chip')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('view settings: Group by None, Show favorites; favouriting fills the strip', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('calls'));
    try {
      await expect(page.getByTestId('favorites-strip')).toContainText('Calls that you favorite will appear here');
      const row = rowOf(page, NORTHWIND_TITLE);
      await row.hover();
      await row.getByTestId('call-favorite').click();
      await expect(page.getByTestId('favorites-strip').getByTestId('call-card')).toHaveCount(1);
      await expect(page.getByTestId('favorites-strip').getByTestId('call-card-title')).toHaveText(NORTHWIND_TITLE);
      await expect(page.getByTestId('favorites-strip').getByTestId('call-card-summary')).not.toBeEmpty();
      // the sidebar lists it as a favourite and opens the call
      await page.getByTestId('calls-view-settings').click();
      await page.getByRole('menuitem', { name: /Group by/ }).click();
      await page.getByRole('menuitem', { name: 'None' }).click();
      await expect(page.getByTestId('calls-group')).toHaveCount(0);
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      await page.getByTestId('calls-view-settings').click();
      await page.getByRole('menuitem', { name: /Group by/ }).click();
      await page.getByRole('menuitem', { name: 'Date' }).click();
      await expect(page.getByTestId('calls-group').first()).toBeVisible();
      // hide favourites
      await page.getByTestId('calls-view-settings').click();
      await page.getByRole('menuitem', { name: 'Show favorites' }).click();
      await expect(page.getByTestId('favorites-strip')).toHaveCount(0);
      await page.getByTestId('calls-view-settings').click();
      await page.getByRole('menuitem', { name: 'Show favorites' }).click();
      await expect(page.getByTestId('favorites-strip')).toBeVisible();
      // unfavourite
      await page.getByTestId('favorites-strip').getByTestId('call-menu').click();
      await page.keyboard.press('Escape');
      await rowOf(page, NORTHWIND_TITLE).getByTestId('call-favorite').click();
      await expect(page.getByTestId('favorites-strip').getByTestId('call-card')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a call imported through /v2 appears without a reload and can be deleted from the row menu (X-27)', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const title = '[e2e] Live import';
    const { context, page } = await signedInPage(browser, ws('calls'));
    try {
      await deleteCallsLike(page, title);
      await expect(rowOf(page, NORTHWIND_TITLE)).toBeVisible();
      const before = Number(await page.getByTestId('calls-tab-count-calls').innerText());
      const imported = await importCall({ title, wait: false });
      await expect(rowOf(page, title)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('calls-tab-count-calls')).toHaveText(String(before + 1));
      // once processing completes the row carries no pending state and the call page has the summary
      await page.goto(callUrl(imported));
      await expect(page.getByTestId('call-summary')).toBeVisible({ timeout: 60_000 });
      await page.goto(ws('calls'));
      const row = rowOf(page, title);
      await row.hover();
      await row.getByTestId('call-menu').click();
      await page.getByRole('menuitem', { name: 'Delete recording' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete recording' }).click();
      await expect(rowOf(page, title)).toHaveCount(0);
      await expect(page.getByTestId('calls-tab-count-calls')).toHaveText(String(before));
    } finally {
      await deleteCallsLike(page, title);
      await context.close();
    }
  });

  test('a workspace without calls shows the empty states of Calls and Insight Templates', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    try {
      const slug = `calls-empty-${Date.now().toString(36)}`;
      await trpc(page, 'workspaces.create', { id: crypto.randomUUID(), name: 'Calls empty', slug });
      await page.goto(`/${slug}/calls`);
      await expect(page.getByTestId('calls-empty')).toContainText('Call recordings');
      await expect(page.getByTestId('calls-empty')).toContainText(
        'No call recordings yet! Record your first call to get started.',
      );
      await expect(page.getByTestId('calls-tab-count-calls')).toHaveText('0');
      await page.getByTestId('calls-tab-templates').click();
      await expect(page.getByTestId('templates-empty')).toContainText('No insight templates yet');
      await expect(page.getByTestId('templates-empty')).toContainText(
        'Create a template to capture the key details that matter from any call.',
      );
    } finally {
      await context.close();
    }
  });
});

test.describe('Call page', () => {
  test('transcript: speaker blocks, members by name, timestamps, summary column', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, callUrl(northwind));
    try {
      await expect(page.getByTestId('call-page')).toBeVisible();
      await expect(page.getByTestId('call-title')).toHaveText(NORTHWIND_TITLE);
      // `/…/<recording>` redirects to the transcript; /timeline to the speakers
      await page.goto(callUrl(northwind, '').replace(/\/$/, ''));
      await expect(page).toHaveURL(/\/transcript$/);
      const blocks = page.getByTestId('transcript-block');
      await expect(blocks.first()).toBeVisible();
      // the importer sent 25 segments; consecutive segments of one speaker are one block (acceptance 3)
      expect(await blocks.count()).toBeLessThan(25);
      const jane = blocks.filter({ hasText: "Sounds good. I'll give the business context" });
      await expect(jane).toHaveCount(1);
      await expect(jane).toContainText('We make autonomous picking robots');
      await expect(jane.getByTestId('transcript-paragraph')).toHaveCount(1);
      // the organiser is a workspace member: member name, never the raw address (X-28)
      await expect(blocks.first().getByTestId('speaker-name')).toHaveText('Ada Tester');
      await expect(blocks.first()).not.toContainText('@');
      await expect(blocks.first().getByTestId('transcript-timestamp')).toHaveText('0:02');
      // persons are record chips; a hover card opens
      const janeChip = jane.getByTestId('speaker-chip');
      await expect(janeChip.getByTestId('speaker-name')).toHaveText('[seed] Jane Cooper');
      await expect(janeChip).toHaveAttribute('data-kind', 'person');
      await janeChip.hover();
      await expect(page.getByTestId('speaker-hover-card')).toContainText('jane.cooper@northwind.example.com');
      // summary column at 40 % width with the summary text and the insights placeholder
      const panel = page.getByTestId('summary-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('call-summary')).toContainText('Northwind');
      await expect(page.getByTestId('insights-empty')).toContainText('No template selected for insights');
      const row = await page.getByTestId('call-panel').boundingBox();
      const side = await panel.boundingBox();
      const total = (row?.width ?? 0) + (side?.width ?? 0);
      expect((side?.width ?? 0) / total).toBeGreaterThan(0.37);
      expect((side?.width ?? 0) / total).toBeLessThan(0.43);
    } finally {
      await context.close();
    }
  });

  test('selection popover: Copy selection, Copy link to section, and the range link dims the rest', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, callUrl(northwind));
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const wade = page.getByTestId('transcript-block').filter({ hasText: "Honestly it's a patchwork" });
      await expect(wade).toBeVisible();
      await wade.getByTestId('transcript-paragraph').click({ clickCount: 3 });
      const menu = page.getByTestId('selection-menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitem')).toHaveText(['Copy link to section', 'Copy selection', 'Ask AI']);
      // Copy selection: the transcript copy format
      await page.getByTestId('selection-copy').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
        "[0:44] [seed] Wade Warren: Honestly it's a patchwork. Each robot pushes logs to our own server, and we have a dashboard that shows battery level and error codes, but it refreshes every fifteen minutes and nobody trusts it.",
      );
      await expect(menu).toHaveCount(0);
      // Copy link to section: first utterance start to last utterance end
      await wade.getByTestId('transcript-paragraph').click({ clickCount: 3 });
      await page.getByTestId('selection-copy-link').click();
      const link = await page.evaluate(() => navigator.clipboard.readText());
      expect(link).toMatch(/\/transcript\?start=44\.6&end=58\.2$/);
      // Ask AI opens the chat with the call and the selected range as its context and the quote in the composer
      await wade.getByTestId('transcript-paragraph').click({ clickCount: 3 });
      await page.getByTestId('selection-ask').click();
      await expect(page.getByTestId('ask-panel')).toBeVisible();
      await expect(page.getByTestId('ask-context-chip')).toContainText(NORTHWIND_TITLE);
      await expect(page.getByTestId('ask-context-chip')).toContainText('0:44-0:58');
      await expect(page.getByTestId('ask-input')).toContainText("Honestly it's a patchwork");
      await page.getByTestId('ask-close').click();
      // the link scrolls to the range and dims everything outside it
      await page.goto(link);
      await expect(page.getByTestId('transcript-range')).toContainText('0:44 – 0:58');
      const dimmed = page.getByTestId('transcript-block').and(page.locator('[data-dimmed]'));
      const all = await page.getByTestId('transcript-block').count();
      expect(await dimmed.count()).toBe(all - 1);
      const inRange = page.getByTestId('transcript-block').filter({ hasText: "Honestly it's a patchwork" });
      await expect(inRange).not.toHaveAttribute('data-dimmed', /.*/);
      const box = await inRange.boundingBox();
      expect(box?.y ?? 9999).toBeLessThan(400);
      // "Show full transcript" clears the highlight
      await page.getByTestId('transcript-range-clear').click();
      await expect(page).not.toHaveURL(/start=/);
      await expect(page.locator('[data-dimmed]')).toHaveCount(0);
      // a timestamp highlights its block as a shareable section
      await page.getByTestId('transcript-timestamp').nth(2).click();
      await expect(page).toHaveURL(/start=38\.4&end=43\.1/);
      await expect(page.getByTestId('transcript-range')).toContainText('0:38');
      // an invalid range is ignored
      await page.goto(`${callUrl(northwind)}?start=50&end=10`);
      await expect(page.getByTestId('transcript-block').first()).toBeVisible();
      await expect(page.getByTestId('transcript-range')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('speakers: talk share, 4 px timelines and focus mode without a player', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, callUrl(northwind, 'speakers'));
    try {
      const rows = page.getByTestId('speaker-row');
      await expect(rows).toHaveCount(3);
      const shares = (await page.getByTestId('speaker-share').allInnerTexts()).map((t) => Number.parseFloat(t));
      expect(shares.every((n) => n > 0)).toBe(true);
      expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(0.6);
      await expect(page.getByTestId('speaker-time').first()).toHaveText(/^\d+(s|m)$/);
      const timeline = await rows.first().getByTestId('speaker-timeline').boundingBox();
      expect(Math.round(timeline?.height ?? 0)).toBe(4);
      expect(await rows.first().getByTestId('speaker-segment').count()).toBeGreaterThan(2);
      // the member renders with the member name, persons as records
      await expect(rows.nth(0).getByTestId('speaker-name')).toHaveText('Ada Tester');
      // focus mode: the other rows dim, the transcript shows only that speaker in full
      const jane = rows.filter({ hasText: 'Jane Cooper' });
      await jane.getByTestId('speaker-focus').click();
      await expect(jane.getByTestId('speaker-focus')).toHaveAttribute('aria-label', 'Exit focus mode');
      await expect(rows.filter({ hasText: 'Ada Tester' })).toHaveAttribute('data-dimmed', 'true');
      await expect(jane).toHaveAttribute('data-dimmed', 'false');
      await page.getByTestId('call-tab-transcript').click();
      await expect(page.getByTestId('transcript-focus')).toContainText('Focusing on [seed] Jane Cooper');
      const blocks = page.getByTestId('transcript-block');
      const dimmed = await blocks.and(page.locator('[data-dimmed]')).count();
      const total = await blocks.count();
      const janeBlocks = await blocks.filter({ hasText: 'Rotterdam' }).count();
      expect(janeBlocks).toBeGreaterThan(0);
      expect(dimmed).toBeGreaterThan(0);
      expect(dimmed).toBeLessThan(total);
      await page.getByRole('button', { name: 'Remove focus from speaker' }).click();
      await expect(page.locator('[data-dimmed]')).toHaveCount(0);
      // a timeline segment opens the transcript at that moment
      await page.getByTestId('call-tab-speakers').click();
      await rows.nth(0).getByTestId('speaker-segment').nth(1).click();
      await expect(page).toHaveURL(/\/transcript\?start=[\d.]+&end=[\d.]+/);
      await expect(page.getByTestId('transcript-range')).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('meeting tab: details, participants and linked records', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, callUrl(northwind, 'meeting'));
    try {
      await expect(page.getByTestId('meeting-time')).toContainText('5:00 PM');
      await expect(page.getByTestId('meeting-time')).toContainText('5:30 PM');
      await expect(page.getByTestId('meeting-time')).toContainText('(30m)');
      const participants = page.getByTestId('meeting-participant');
      await expect(participants).toHaveCount(3);
      await expect(participants.first()).toContainText('Ada Tester');
      await expect(participants.first()).toContainText('Host');
      await expect(page.getByTestId('meeting-rsvp').first()).toHaveText('Attended');
      // link and unlink a record
      await page.getByTestId('meeting-link-records').click();
      await page
        .getByRole('option', { name: /Northwind Robotics/ })
        .first()
        .click();
      await expect(page.getByTestId('meeting-linked-record')).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Remove linked record' }).click();
      await expect(page.getByTestId('meeting-linked-record')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('narrow pages get a Summary tab; wide pages redirect /summary; the column resizes', async ({ browser }) => {
    const narrow = await signedInPage(browser, callUrl(northwind), { viewport: { width: 760, height: 900 } });
    try {
      const page = narrow.page;
      await expect(page.getByTestId('call-tab-summary')).toBeVisible();
      await expect(page.getByTestId('summary-panel')).toHaveCount(0);
      await page.getByTestId('call-tab-summary').click();
      await expect(page).toHaveURL(/\/summary$/);
      await expect(page.getByTestId('call-summary')).toContainText('Northwind');
    } finally {
      await narrow.context.close();
    }
    const wide = await signedInPage(browser, callUrl(northwind, 'summary'));
    try {
      const page = wide.page;
      await expect(page).toHaveURL(/\/transcript$/);
      await expect(page.getByTestId('call-tab-summary')).toHaveCount(0);
      const panel = page.getByTestId('summary-panel');
      const before = (await panel.boundingBox())?.width ?? 0;
      const handle = (await page.getByTestId('summary-resize').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const x = handle.x + handle.width / 2;
      const y = handle.y + 200;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 120, y, { steps: 6 });
      await page.mouse.up();
      const after = (await panel.boundingBox())?.width ?? 0;
      expect(after).toBeGreaterThan(before + 100);
      // persisted; a double click resets to 40 %
      await page.reload();
      expect((await page.getByTestId('summary-panel').boundingBox())?.width ?? 0).toBeGreaterThan(before + 100);
      await page.getByTestId('summary-resize').dblclick();
      await expect
        .poll(async () => Math.round((await page.getByTestId('summary-panel').boundingBox())?.width ?? 0))
        .toBe(Math.round(before));
    } finally {
      await wide.context.close();
    }
  });

  test('header: favourite, Share popover, call menu (Copy link, Copy transcript) and Ask AI', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, callUrl(northwind));
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await expect(page.getByTestId('call-page')).toBeVisible();
      await page.getByTestId('call-favorite').first().click();
      await expect(page.getByTestId('call-favorite').first()).toHaveAttribute('data-favorite', 'true');
      // the sidebar favourite opens the call
      await page.goto(ws('home'));
      const fav = page.locator('aside').getByText(NORTHWIND_TITLE);
      await expect(fav).toBeVisible();
      await fav.click();
      await expect(page).toHaveURL(new RegExp(`/calls/${northwind.meetingId}/${northwind.recordingId}/transcript`));
      await page.getByTestId('call-favorite').first().click();
      await expect(page.getByTestId('call-favorite').first()).not.toHaveAttribute('data-favorite', 'true');
      // Share
      await page.getByTestId('call-share').click();
      await expect(page.getByTestId('share-popover')).toContainText('External access');
      await page.getByTestId('share-copy-link').click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
        `/calls/${northwind.meetingId}/${northwind.recordingId}/transcript`,
      );
      await page.keyboard.press('Escape');
      // menu: Copy transcript puts the whole transcript in the copy format on the clipboard
      await page.getByTestId('call-menu').click();
      await page.getByRole('menuitem', { name: 'Transcript' }).click();
      await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(/^\[0:02\] Ada Tester: Hi Jane, hi Wade/);
      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text.split('\n').length).toBeGreaterThan(10);
      // Ask AI opens the chat with the call attached as the page context
      await page.getByTestId('ask-button').click();
      await expect(page.getByTestId('ask-panel')).toBeVisible();
      await expect(page.getByTestId('ask-context-chip')).toContainText(NORTHWIND_TITLE);
    } finally {
      await context.close();
    }
  });

  test('an unknown call shows the unavailable state', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws(`calls/${crypto.randomUUID()}/${crypto.randomUUID()}`));
    try {
      await expect(page.getByTestId('call-unavailable')).toContainText(
        "This call either doesn't exist or you don't have permission to view it",
      );
    } finally {
      await context.close();
    }
  });
});
