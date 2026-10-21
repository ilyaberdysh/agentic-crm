//  calls UI, part 2 (BACKLOG 10.13–10.15): insight templates (list, editor, presets gallery, preview, publish and
// discard), insights on a call (choose, generate, Update, outdated), Settings → Call intelligence, and calls on record
// pages (Calls tab, activity meeting card, live updates). Same stack as calls.spec.ts (AGENTIC_CRM_LLM=fake).
import { expect, type Page, test } from '@playwright/test';
import {
  callUrl,
  deleteCallsLike,
  ensureNorthwind,
  type ImportedCall,
  importCall,
  NORTHWIND_TITLE,
} from './calls-support.ts';
import { findRecord, recordPath } from './record-support.ts';
import { signedInPage, trpc, ws } from './slice3-support.ts';

let northwind: ImportedCall;

test.beforeAll(async ({ browser }) => {
  const { context, page } = await signedInPage(browser, ws('home'));
  try {
    northwind = await ensureNorthwind(page);
  } finally {
    await context.close();
  }
});

interface PresetOut {
  id: string;
  title: string;
  sections: { title: string; type: string; prompt: string }[];
}

/** A published template made from one of the presets, through the API (the editor flows have their own test). */
async function publishedTemplate(page: Page, title: string, presetId = 'sales-discovery'): Promise<string> {
  const id = crypto.randomUUID();
  await trpc(page, 'insightTemplates.create', { id, presetId });
  await trpc(page, 'insightTemplates.update', { templateId: id, title });
  await trpc(page, 'insightTemplates.publish', { templateId: id });
  return id;
}

async function removeTemplatesLike(page: Page, prefix: string): Promise<void> {
  const list = await trpc<{ id: string; title: string | null; canDelete: boolean }[]>(
    page,
    'insightTemplates.list',
    {},
  );
  for (const t of list) {
    if (!t.title?.startsWith(prefix)) continue;
    if (t.canDelete) await trpc(page, 'insightTemplates.delete', { templateId: t.id });
    else await trpc(page, 'insightTemplates.update', { templateId: t.id, archived: true });
  }
}

/** Types into the rich-text editor of a section card once it is connected and editable. */
async function typeInSection(page: Page, card: ReturnType<Page['locator']>, field: 'title' | 'prompt', text: string) {
  const editor = card.getByTestId(`section-${field}`).locator('.ProseMirror');
  await expect(editor).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  await editor.click();
  await page.keyboard.type(text);
}

test.describe('Insight templates', () => {
  test('editor: new template, sections (title, prompt, format, duplicate, move, delete), preview, publish and discard', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page } = await signedInPage(browser, ws('calls/templates'));
    try {
      await removeTemplatesLike(page, 'E2E editor');
      await page.goto(ws('calls/templates'));
      await page.getByTestId('new-template').first().click();
      await expect(page).toHaveURL(/\/calls\/templates\/[0-9a-f-]{36}$/);
      await expect(page.getByTestId('template-editor')).toBeVisible();
      await expect(page.getByTestId('template-title')).toHaveAttribute('placeholder', 'Untitled Template');
      await expect(page.getByTestId('template-publish')).toHaveText('Publish template');
      await expect(page.getByTestId('template-discard')).toHaveCount(0);
      await expect(page.getByTestId('start-with-template')).toBeVisible();
      // publishing without sections explains what is missing
      await page.getByTestId('template-publish').click();
      await expect(page.getByTestId('incomplete-message')).toHaveText(
        'You cannot publish a template with missing content.',
      );
      await page.getByRole('button', { name: 'Cancel' }).click();

      // add a section: title, prompt and format
      await page.getByTestId('add-section').click();
      const first = page.getByTestId('section-card').first();
      await expect(first).toBeVisible();
      await typeInSection(page, first, 'title', 'Budget');
      await typeInSection(page, first, 'prompt', 'What budget was mentioned?');
      await first.getByTestId('section-format').click();
      await page.getByRole('menuitemradio', { name: 'List' }).click();
      await expect(first.getByTestId('section-format')).toContainText('List');
      // a second, empty section blocks publishing: the dialog lists it and "Go to first issue" focuses it
      await page.getByTestId('add-section').click();
      await expect(page.getByTestId('section-card')).toHaveCount(2);
      await page.getByTestId('template-publish').click();
      await expect(page.getByTestId('incomplete-issues')).toContainText('Section 2 · Missing title, prompt');
      await page.getByTestId('incomplete-go').click();
      const second = page.getByTestId('section-card').nth(1);
      await typeInSection(page, second, 'title', 'Timeline');
      await typeInSection(page, second, 'prompt', 'When do they want to start?');
      // duplicate, move down, delete
      await second.getByTestId('section-menu').click();
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(page.getByTestId('section-card')).toHaveCount(3);
      await page.getByTestId('section-card').first().getByTestId('section-menu').click();
      await expect(page.getByRole('menuitem', { name: 'Move Up' })).toHaveCount(0);
      await page.getByRole('menuitem', { name: 'Move Down' }).click();
      await expect(page.getByTestId('section-card').first().getByTestId('section-title')).toContainText('Timeline');
      await page.getByTestId('section-card').nth(2).getByTestId('section-menu').click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await expect(page.getByTestId('section-card')).toHaveCount(2);

      // inline title
      const title = page.getByTestId('template-title');
      await title.fill('E2E editor template');
      await title.press('Enter');

      // preview against a call: the editor offers the most recent completed calls
      await expect(page.getByTestId('preview-empty')).toContainText('Preview your call insights');
      await page.getByTestId('preview-generate').click();
      await expect(page.getByTestId('preview-sections')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('preview-section')).toHaveCount(2);
      await expect(page.getByTestId('preview-source')).toContainText('Discovery call');

      // publish
      await expect(page.getByTestId('template-publish')).toBeEnabled();
      await page.getByTestId('template-publish').click();
      await expect(page.getByTestId('template-publish')).toHaveText('Publish changes');
      await expect(page.getByTestId('template-publish')).toBeDisabled();
      await expect(page.getByTestId('template-discard')).toHaveCount(0);

      // edit after publishing: Publish changes and Discard changes appear; discarding restores the published version
      await page.getByTestId('add-section').click();
      await expect(page.getByTestId('section-card')).toHaveCount(3);
      await expect(page.getByTestId('template-publish')).toBeEnabled({ timeout: 15_000 });
      await expect(page.getByTestId('template-discard')).toBeVisible();
      await page.getByTestId('template-discard').click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
      await expect(page.getByTestId('section-card')).toHaveCount(2);
      await expect(page.getByTestId('template-discard')).toHaveCount(0);

      // the list: status, sections
      await page.goto(ws('calls/templates'));
      const row = page.getByTestId('template-row').filter({ hasText: 'E2E editor template' });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('template-status')).toHaveText('Published');
      await expect(row.getByTestId('template-sections')).toHaveText('2');
      // archive, restore, delete
      await row.getByTestId('template-menu').click();
      await page.getByRole('menuitem', { name: 'Archive template' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Archive template' }).click();
      await expect(row.getByTestId('template-status')).toHaveText('Archived');
      await row.getByTestId('template-menu').click();
      await page.getByRole('menuitem', { name: 'Restore template' }).click();
      await expect(row.getByTestId('template-status')).toHaveText('Published');
      await row.getByTestId('template-menu').click();
      await page.getByRole('menuitem', { name: 'Delete template' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete template' }).click();
      await expect(page.getByTestId('template-row').filter({ hasText: 'E2E editor template' })).toHaveCount(0);
    } finally {
      await removeTemplatesLike(page, 'E2E editor');
      await context.close();
    }
  });

  test('presets gallery: use cases in order, search, preview and "Use this template"', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await signedInPage(browser, ws('calls/templates'));
    try {
      await page.getByTestId('new-template').first().click();
      await expect(page.getByTestId('template-editor')).toBeVisible();
      await page.getByTestId('start-with-template').click();
      const gallery = page.getByTestId('preset-gallery');
      await expect(gallery).toBeVisible();
      await expect(gallery.getByTestId('preset-use-case')).toHaveText([
        'General',
        'Sales',
        'Success',
        'Product',
        'Marketing',
        'Recruiting',
        'Fundraising',
        'Investing',
      ]);
      expect(await gallery.getByTestId('preset-card').count()).toBe(22);
      // a use case filters, the search narrows by title and description
      const recruiting = gallery.getByTestId('preset-use-case').filter({ hasText: 'Recruiting' });
      await recruiting.click();
      const filtered = await gallery.getByTestId('preset-card').count();
      expect(filtered).toBeGreaterThan(3);
      expect(filtered).toBeLessThan(22);
      await recruiting.click();
      await expect(gallery.getByTestId('preset-card')).toHaveCount(22);
      await gallery.getByTestId('preset-search').fill('BANT');
      await expect(gallery.getByTestId('preset-card')).toHaveCount(1);
      const card = gallery.getByTestId('preset-card');
      await expect(card).toContainText('BANT');
      await expect(card).toContainText('4 Sections');
      await expect(card.getByTestId('preset-category')).toHaveText(['Sales']);
      // preview, back, preview again with the keyboard, use
      await card.click();
      await expect(gallery.getByTestId('preset-preview-title')).toHaveText('BANT');
      await expect(gallery.getByTestId('preset-section')).toHaveCount(4);
      await gallery.getByTestId('preset-back').click();
      await gallery.getByTestId('preset-search').press('Enter');
      await expect(gallery.getByTestId('preset-preview-title')).toHaveText('BANT');
      await gallery.getByTestId('preset-use').click();
      await expect(gallery).toHaveCount(0);
      await expect(page.getByTestId('section-card')).toHaveCount(4);
      await expect(page.getByTestId('section-card').first().getByTestId('section-title')).toContainText('Budget');
      // the template is transient until edited, so it stays out of the list; remove it anyway
      await page.getByTestId('template-menu').click();
      await page.getByRole('menuitem', { name: 'Delete template' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete template' }).click();
      await expect(page).toHaveURL(/\/calls\/templates$/);
    } finally {
      await context.close();
    }
  });

  test('a call page applies a published template: choose, generate, Update, outdated, remembered per call', async ({
    browser,
  }) => {
    test.setTimeout(150_000);
    const { context, page } = await signedInPage(browser, callUrl(northwind));
    try {
      await removeTemplatesLike(page, 'E2E insights');
      const presets = await trpc<PresetOut[]>(page, 'insightTemplates.presets', {});
      const preset = presets.find((p) => p.id === 'sales-discovery') as PresetOut;
      const templateId = await publishedTemplate(page, 'E2E insights template');
      await page.evaluate(
        ([m, r]) => localStorage.removeItem(`ar:active-template:${m}:${r}`),
        [northwind.meetingId, northwind.recordingId],
      );
      await page.reload();
      await expect(page.getByTestId('insights-empty')).toBeVisible();
      await page.getByTestId('template-picker').click();
      const options = page.getByTestId('template-option');
      await expect(options.filter({ hasText: 'E2E insights template' })).toHaveCount(1);
      await page.getByPlaceholder('Search templates...').fill('zzz');
      await expect(page.getByText('No results found')).toBeVisible();
      await page.getByPlaceholder('Search templates...').fill('E2E insights');
      await options.filter({ hasText: 'E2E insights template' }).click();
      // the insight appears with the template's sections (generated by the fake LLM)
      await expect(page.getByTestId('template-picker')).toContainText('E2E insights template');
      const sections = page.getByTestId('insight-section');
      await expect(sections).toHaveCount(preset.sections.length, { timeout: 60_000 });
      await expect(sections.first()).toContainText(preset.sections[0]?.title ?? '');
      await expect(page.getByTestId('analyzing')).toHaveCount(0);
      // remembered for this call
      await page.reload();
      await expect(page.getByTestId('template-picker')).toContainText('E2E insights template');
      await expect(sections).toHaveCount(preset.sections.length);
      // Update creates a new insight from the latest published version
      const count = async () =>
        (await trpc<unknown[]>(page, 'calls.insights.list', { recordingId: northwind.recordingId })).length;
      const before = await count();
      await page.getByTestId('insights').getByText('Insights', { exact: true }).hover();
      await page.getByTestId('insight-update').click();
      await expect.poll(count).toBe(before + 1);
      await expect(sections).toHaveCount(preset.sections.length, { timeout: 60_000 });
      // a new published version marks the insight outdated, with an Update banner
      await trpc(page, 'insightTemplates.sections.create', {
        templateId,
        sectionId: crypto.randomUUID(),
        type: 'plaintext',
        title: 'Extra',
        prompt: 'Anything else?',
      });
      await trpc(page, 'insightTemplates.publish', { templateId });
      await expect(page.getByTestId('insight-outdated')).toContainText('A new version of this template is available', {
        timeout: 15_000,
      });
      await page.getByTestId('insight-outdated-update').click();
      await expect(sections).toHaveCount(preset.sections.length + 1, { timeout: 60_000 });
      await expect(page.getByTestId('insight-outdated')).toHaveCount(0);
    } finally {
      await removeTemplatesLike(page, 'E2E insights');
      await context.close();
    }
  });

  test('Settings → Call intelligence: the default insights template pre-selects on calls', async ({ browser }) => {
    test.setTimeout(150_000);
    const { context, page } = await signedInPage(browser, ws('settings/call-intelligence'));
    try {
      await removeTemplatesLike(page, 'E2E default');
      await publishedTemplate(page, 'E2E default template', 'bant');
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Call intelligence' })).toBeVisible();
      await expect(page.getByTestId('default-template')).toHaveText('None');
      await page.getByTestId('default-template').click();
      await page.getByTestId('default-template-option').filter({ hasText: 'E2E default template' }).click();
      await expect(page.getByTestId('default-template')).toContainText('E2E default template');
      await page.reload();
      await expect(page.getByTestId('default-template')).toContainText('E2E default template');
      // a call opened without a stored choice pre-selects it and generates the insight
      await page.goto(callUrl(northwind));
      await page.evaluate(
        ([m, r]) => localStorage.removeItem(`ar:active-template:${m}:${r}`),
        [northwind.meetingId, northwind.recordingId],
      );
      await page.reload();
      await expect(page.getByTestId('template-picker')).toContainText('E2E default template');
      await expect(page.getByTestId('insight-section')).toHaveCount(4, { timeout: 60_000 });
      // clear it again; the legacy path redirects
      await page.goto(ws('settings/call-intelligence'));
      await page.getByTestId('default-template').click();
      await page.getByTestId('default-template-none').click();
      await expect(page.getByTestId('default-template')).toHaveText('None');
      await page.goto(ws('settings/call-recording'));
      await expect(page).toHaveURL(/\/settings\/call-intelligence$/);
    } finally {
      await removeTemplatesLike(page, 'E2E default');
      await context.close();
    }
  });
});

test.describe('AI not configured', () => {
  test('summaries and insights show a graceful "not configured" state', async ({ browser }) => {
    test.setTimeout(90_000);
    const { context, page } = await signedInPage(browser, ws('home'));
    try {
      await removeTemplatesLike(page, 'E2E unconfigured');
      await publishedTemplate(page, 'E2E unconfigured template');
      // A server without ANTHROPIC_API_KEY answers 503 AI_NOT_CONFIGURED to insights and leaves summaries failed.
      await page.route(/\/trpc\/.*calls\.get/, async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { result?: { data?: Record<string, unknown> } }[];
        for (const entry of body) {
          const data = entry.result?.data;
          if (data && 'processingError' in data) {
            data.summary = null;
            data.summaryStatus = 'failed';
            data.processingError = 'AI_NOT_CONFIGURED';
          }
        }
        await route.fulfill({ response, json: body });
      });
      await page.route(/\/trpc\/calls\.insights\.generate/, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          json: [
            {
              error: {
                message: 'AI is not configured: set ANTHROPIC_API_KEY to enable AI features',
                code: -32603,
                data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 503 },
                statusCode: 503,
                additional_information: { code: 'AI_NOT_CONFIGURED' },
              },
            },
          ],
        }),
      );
      await page.goto(callUrl(northwind));
      await page.evaluate(
        ([m, r]) => localStorage.removeItem(`ar:active-template:${m}:${r}`),
        [northwind.meetingId, northwind.recordingId],
      );
      await page.reload();
      await expect(page.getByTestId('summary-column').getByTestId('ai-not-configured')).toContainText(
        'Summaries are not available: AI is not configured for this workspace.',
      );
      await page.getByTestId('template-picker').click();
      await page.getByTestId('template-option').filter({ hasText: 'E2E unconfigured template' }).click();
      await expect(page.getByTestId('insights').getByTestId('ai-not-configured')).toContainText(
        'Insights are not available: AI is not configured for this workspace.',
      );
      // the rest of the page keeps working
      await expect(page.getByTestId('transcript-block').first()).toBeVisible();
    } finally {
      await removeTemplatesLike(page, 'E2E unconfigured');
      await context.close();
    }
  });
});

test.describe('Calls on record pages', () => {
  test('the Calls tab of a company and a person lists the call card; the activity feed shows the meeting card', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    try {
      const company = await findRecord(page, '[seed] Northwind Robotics');
      await page.goto(recordPath('company', company.entityInstanceId, 'calls'));
      const card = page.getByTestId('call-card').filter({ hasText: NORTHWIND_TITLE });
      await expect(card).toBeVisible();
      await expect(card.getByTestId('call-card-summary')).not.toBeEmpty();
      await expect(card.getByTestId('call-card-date')).toContainText('Friday, October 9 5:00 PM - 5:30 PM');
      await expect(card).toContainText('30min');
      // a card opens the call
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/calls/${northwind.meetingId}/${northwind.recordingId}/transcript`));

      // the person Jane Cooper takes part in the call
      const jane = await findRecord(page, '[seed] Jane Cooper');
      await page.goto(recordPath('person', jane.entityInstanceId, 'calls'));
      await expect(page.getByTestId('call-card').filter({ hasText: NORTHWIND_TITLE })).toBeVisible();

      // the activity feed: the meeting card with the concise summary
      await page.goto(recordPath('company', company.entityInstanceId, 'activity'));
      const activity = page.getByTestId('event-call-card').filter({ hasText: NORTHWIND_TITLE });
      await expect(activity).toBeVisible();
      await expect(activity.getByTestId('event-call-summary')).not.toBeEmpty();
      await expect(activity.getByTestId('event-call-time')).toContainText('5:00 PM - 5:30 PM');
      await activity.click();
      await expect(page).toHaveURL(new RegExp(`/calls/${northwind.meetingId}/${northwind.recordingId}`));
    } finally {
      await context.close();
    }
  });

  test('a call imported while the Calls tab is open appears without a reload, summary included (X-27)', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const title = '[e2e] Tab live import';
    const { context, page } = await signedInPage(browser, ws('home'));
    try {
      await deleteCallsLike(page, title);
      const company = await findRecord(page, '[seed] Northwind Robotics');
      await page.goto(recordPath('company', company.entityInstanceId, 'calls'));
      await expect(page.getByTestId('call-card').filter({ hasText: NORTHWIND_TITLE })).toBeVisible();
      await expect(page.getByTestId('call-card').filter({ hasText: title })).toHaveCount(0);
      await importCall({ title, wait: false });
      const live = page.getByTestId('call-card').filter({ hasText: title });
      await expect(live).toBeVisible({ timeout: 30_000 });
      // processing completes in the worker and the concise summary arrives live
      await expect(live.getByTestId('call-card-summary')).toContainText('Northwind', { timeout: 60_000 });
    } finally {
      await deleteCallsLike(page, title);
      await context.close();
    }
  });

  test('the meeting modal links to its call', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, `${ws('home')}?modal=meeting&id=${northwind.meetingId}`);
    try {
      await expect(page.getByTestId('meeting-recording-link')).toBeVisible();
      await page.getByTestId('meeting-recording-link').click();
      await expect(page).toHaveURL(new RegExp(`/calls/${northwind.meetingId}/${northwind.recordingId}/transcript`));
    } finally {
      await context.close();
    }
  });
});
