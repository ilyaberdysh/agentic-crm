// Ask AI e2e (BACKLOG 10.01, 10.03, 10.04, 10.07, 10.16; slice 10 acceptance 4): the full-page chat and the side panel
// (⌘J, page context), streamed answers with tool rows, record chips and embeds, approval cards, web search permission,
// reply suggestions, try again, feedback, history, prompts, settings, the record summary and the Home block — against
// the scripted fake LLM (AGENTIC_CRM_LLM=fake, packages/domain src/ai/fixtures/e2e).
import { expect, test } from '@playwright/test';
import {
  answered,
  findRecord,
  importedCall,
  input,
  mod,
  openPanel,
  panel,
  patchTrpc,
  recordPath,
  signedInPage,
  taskTitles,
  threadDetail,
  threadIdOf,
  threadList,
  trpc,
  typeAndSend,
  ws,
} from './ask-support.ts';

const lastAssistant = (page: import('@playwright/test').Page) => page.getByTestId('ask-assistant-turn').last();

test.describe('Ask AI chat', () => {
  test('a new chat streams a plain answer, titles the thread and shows the icon row', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await expect(page.getByRole('heading', { name: 'What can I help with?' })).toBeVisible();
    await expect(page.getByTestId('ask-not-configured')).toHaveCount(0);

    await typeAndSend(page, '[e2e:plain] say something');
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('ask-user-turn')).toContainText('[e2e:plain] say something');
    await answered(page);
    await expect(page.getByTestId('ask-markdown').last()).toContainText('short answer');
    await expect(page.getByTestId('ask-turn-actions')).toBeVisible();
    // The AI title replaces "Untitled chat" and the sidebar lists the thread.
    await expect(page.getByTestId('ask-title')).toHaveText('E2E chat');
    await expect(page.getByRole('link', { name: 'E2E chat' })).toBeVisible();
    // Markdown: bold, a link that opens in a new tab and a bullet list.
    const answer = page.getByTestId('ask-markdown').last();
    await expect(answer.locator('strong')).toHaveText('short');
    await expect(answer.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.com');
    await expect(answer.locator('li')).toHaveCount(2);
    await context.close();
  });

  test('read tools stream as rows, collapse into "N tools used"; records are chips and embeds; suggestions reply', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:summary] summarize Northwind');
    // While running: the Thinking label and the tool rows of the step.
    await expect(page.getByTestId('ask-thinking')).toBeVisible();
    await expect(page.getByTestId('ask-tool-row').first()).toBeVisible({ timeout: 15_000 });
    await answered(page);

    const turn = lastAssistant(page);
    await expect(page.getByTestId('ask-thinking')).toHaveCount(0);
    await expect(turn.getByTestId('ask-tools-disclosure')).toHaveText(/2 tools used/);
    await expect(turn.getByTestId('ask-tool-row')).toHaveCount(0);
    await turn.getByTestId('ask-tools-disclosure').click();
    await expect(turn.getByTestId('ask-tool-row')).toHaveCount(2);
    await expect(turn.getByTestId('ask-tool-row').first()).toContainText('Records searched');
    await turn.getByTestId('ask-tools-disclosure').click();

    // Generative embed: a record card; the table cells are record chips.
    await expect(turn.getByTestId('ask-entity-embed')).toContainText('Northwind Robotics');
    const table = turn.getByTestId('ask-table');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.getByTestId('ask-record-chip')).toHaveCount(2);
    await expect(page.getByTestId('ask-title')).toHaveText('Summary of Northwind Robotics');

    // Reply suggestions send as a reply (a second turn).
    const suggestions = page.getByTestId('ask-reply-suggestion');
    await expect(suggestions).toHaveCount(3);
    await expect(suggestions.first()).toHaveText('Draft follow-up email to Jane Cooper');
    await suggestions.first().click();
    await expect(page.getByTestId('ask-user-turn')).toHaveCount(2);
    await expect(page.getByTestId('ask-user-turn').last()).toContainText('Draft follow-up email to Jane Cooper');
    await answered(page);
    const detail = await threadDetail(page, threadIdOf(page));
    expect(detail.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    // A record chip opens the record.
    await page.goto(ws(`chats/${threadIdOf(page)}`));
    await page.getByTestId('ask-table').getByTestId('ask-record-chip').first().click();
    await expect(page).toHaveURL(/\/person\//);
    await context.close();
  });

  test('a write tool waits for approval: editable card, nothing runs before ⌘↵, then the task embed (acceptance 4)', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:task] create a task');
    const card = page.getByTestId('ask-approval-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The composer is replaced by the card; the row reads "Create task: <title>"; nothing was created yet.
    await expect(page.getByTestId('ask-composer')).toHaveCount(0);
    await expect(page.getByTestId('ask-tool-row').last()).toContainText('Create task');
    expect(await taskTitles(page)).not.toContain('[e2e] Plain follow-up');
    await expect(page.getByTestId('ask-approval-title')).toHaveValue('[e2e] Plain follow-up');

    // Edit the title and approve with ⌘↵.
    await page.getByTestId('ask-approval-title').fill('[e2e] Edited by hand');
    await page.keyboard.press(`${mod}+Enter`);
    await expect(card).toHaveCount(0);
    await answered(page);
    const embed = page.getByTestId('ask-task-embed');
    await expect(embed).toContainText('[e2e] Edited by hand');
    expect(await taskTitles(page)).toContain('[e2e] Edited by hand');
    // The embed's checkbox completes the task in place.
    await embed.getByTestId('task-checkbox').click();
    await expect(embed.getByTestId('task-checkbox')).toHaveAttribute('aria-checked', 'true');
    // The thread keeps what ran: the approved (edited) input.
    const tool = (await threadDetail(page, threadIdOf(page))).turns
      .flatMap((t) => t.steps)
      .flatMap((s) => s.parts)
      .find((p) => p.type === 'tool');
    expect(tool).toMatchObject({
      tool: 'create-task',
      toolStatus: 'completed',
      inputAmendment: { body: '[e2e] Edited by hand' },
    });
    await context.close();
  });

  test('Discard ends the turn without running the write and brings the composer back', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:task] create a task to discard');
    await expect(page.getByTestId('ask-approval-card')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('ask-approval-discard').click();
    await expect(page.getByTestId('ask-approval-card')).toHaveCount(0);
    await answered(page);
    await expect(page.getByTestId('ask-composer')).toBeVisible();
    await expect(page.getByTestId('ask-tool-row')).toHaveCount(0);
    await page.getByTestId('ask-tools-disclosure').click();
    await expect(page.getByTestId('ask-tool-row')).toContainText('Task suggestion discarded');
    expect((await taskTitles(page)).filter((t) => t === '[e2e] Plain follow-up')).toHaveLength(0);
    await context.close();
  });

  test('the approval card edits assignee and due date, and a linked record can be removed', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const company = await findRecord(page, '[seed] Northwind Robotics');
    await page.goto(recordPath('company', company.entityInstanceId));
    await openPanel(page);
    await typeAndSend(page, '[e2e:task-linked] create the follow-up');
    const card = page.getByTestId('ask-approval-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    // The model proposed the page record and the asking member; both show as chips.
    await expect(card.getByTestId('ask-record-chip')).toContainText('Northwind Robotics');
    await expect(page.getByTestId('ask-approval-assignees')).toContainText('You');
    await expect(page.getByTestId('ask-approval-due')).toContainText('Jan 15, 2030');
    await card.getByRole('button', { name: 'Remove linked record' }).click();
    await expect(card.getByTestId('ask-record-chip')).toHaveCount(0);
    await page.getByTestId('ask-approval-approve').click();
    const embed = page.getByTestId('ask-task-embed');
    await expect(embed).toContainText('[e2e] AI follow-up call');
    // ask-parity runs the same scenario (and keeps the link): pick this run's task by the embed's id.
    const taskId = await embed.getAttribute('data-task-id');
    const tasks = await trpc<{
      groups: {
        tasks: { id: string; content: { text: string }; linkedRecords: unknown[]; deadlineAt: string | null }[];
      }[];
    }>(page, 'tasks.list', { groupBy: 'none' });
    const task = tasks.groups.flatMap((g) => g.tasks).find((t) => t.id === taskId);
    expect(task?.linkedRecords).toHaveLength(0);
    expect(task?.deadlineAt).toContain('2030-01-15');
    await context.close();
  });

  test('web search asks permission: Deny ends the turn, Allow runs it, Always allow changes the setting', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:web] search the web (deny)');
    await expect(page.getByTestId('ask-approval-allow')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('ask-approval-card')).toContainText('Do you want to allow Ask AI to search the web');
    await page.getByTestId('ask-approval-deny').click();
    await answered(page);
    await page.getByTestId('ask-tools-disclosure').click();
    await expect(page.getByTestId('ask-tool-row').last()).toContainText('Web search denied');
    // A denied turn offers no reply suggestions.
    await expect(page.getByTestId('ask-reply-suggestions')).toHaveCount(0);

    await page.goto(ws('chats/new'));
    await typeAndSend(page, '[e2e:web] search the web (allow)');
    await page.getByTestId('ask-approval-allow').click();
    await answered(page);
    await expect(page.getByTestId('ask-markdown').last()).toContainText('maker of warehouse robots');
    expect((await threadDetail(page, threadIdOf(page))).thread.webSearchAllowed).toBe(true);

    await page.goto(ws('chats/new'));
    await typeAndSend(page, '[e2e:web] search the web (always)');
    await page.getByTestId('ask-approval-always').click();
    await answered(page);
    expect((await trpc<{ allowWebSearch: string }>(page, 'ai.settings.get', {})).allowWebSearch).toBe('auto-approve');
    // Auto-approve: the next search runs without a card.
    await page.goto(ws('chats/new'));
    await typeAndSend(page, '[e2e:web] search the web (no card)');
    await answered(page);
    await expect(page.getByTestId('ask-approval-card')).toHaveCount(0);
    await trpc(page, 'ai.settings.update', { allowWebSearch: 'always-ask' });
    await context.close();
  });

  test('the side panel opens with ⌘J, carries the record as context and moves to the full page', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const company = await findRecord(page, '[seed] Northwind Robotics');
    await page.goto(recordPath('company', company.entityInstanceId));
    await page.getByTestId('page-header').waitFor();
    await expect(panel(page)).toHaveCount(0);
    await openPanel(page);
    await expect(panel(page).getByTestId('ask-context-chip')).toContainText('[seed] Northwind Robotics');
    expect((await panel(page).boundingBox())?.width).toBeCloseTo(359, 0);

    await typeAndSend(page, '[e2e:plain] what do you see?');
    await answered(page);
    // The page context travelled with the message.
    const detail = await threadDetail(page, (await threadList(page))[0]?.id as string);
    expect(detail.turns[0]?.parts.some((p) => p.type === 'interest' && p.interestType === 'entity-instance')).toBe(
      true,
    );

    // ⌘J again closes; the Ask AI button of the page header opens it with the same context.
    await page.mouse.click(900, 24);
    await page.keyboard.press(`${mod}+j`);
    await expect(panel(page)).toHaveCount(0);
    await page.getByTestId('ask-button').click();
    await expect(panel(page).getByTestId('ask-context-chip')).toContainText('[seed] Northwind Robotics');

    // More actions → Open in full page.
    await panel(page).getByTestId('ask-more').click();
    await page.getByRole('menuitem', { name: 'Open in full page' }).click();
    await expect(page).toHaveURL(/\/chats\/new\?i=/);
    await expect(page.getByTestId('ask-context-chip')).toContainText('[seed] Northwind Robotics');
    // …and Minimize to side panel goes back to the page it was opened from.
    await page.getByTestId('ask-minimize').click();
    await expect(page).toHaveURL(/\/company\//);
    await expect(panel(page)).toBeVisible();
    await panel(page).getByTestId('ask-close').click();
    await expect(panel(page)).toHaveCount(0);
    await context.close();
  });

  test('@-mentions become annotations and chips; Insert prompt adds a prompt chip; the model picker chooses the model', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    const box = input(page);
    await box.click();
    await box.pressSequentially('[e2e:prompt] about @Northwind');
    const menu = page.getByTestId('ask-typeahead');
    await expect(menu).toBeVisible();
    await expect(menu.getByTestId('ask-option').first()).toContainText('Northwind Robotics');
    await box.press('Enter');
    await expect(box).toHaveValue(/@\[seed\] Northwind Robotics $/);

    // Insert prompt → Daily brief becomes "/Daily brief".
    await page.getByTestId('ask-insert-prompt').click();
    await expect(page.getByTestId('ask-prompt-menu')).toBeVisible();
    await page.getByTestId('ask-prompt-item').filter({ hasText: 'Daily brief' }).click();
    await expect(box).toHaveValue(/\/Daily brief $/);

    // Pick a model, then send.
    await page.getByTestId('ask-model-picker').click();
    await page.getByRole('menuitemradio', { name: 'Sonnet 5.5' }).click();
    await expect(page.getByTestId('ask-model-picker')).toHaveText('Sonnet 5.5');
    await box.press('Enter');
    await answered(page);
    await expect(page.getByTestId('ask-user-turn').getByTestId('ask-record-chip')).toContainText('Northwind Robotics');

    const detail = await threadDetail(page, threadIdOf(page));
    const text = detail.turns[0]?.parts.find((p) => p.type === 'text');
    expect(text?.annotations?.map((a) => a.type)).toEqual(['entity-instance', 'prompt']);
    expect(detail.turns[1]).toMatchObject({ model: 'claude-sonnet-5-5', modelMode: 'manual' });
    await context.close();
  });

  test('Try again makes a sibling answer; thumbs rate it; Not helpful opens the feedback dialog', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:plain] answer twice');
    await answered(page);
    const id = threadIdOf(page);

    await page.getByTestId('ask-retry').click();
    await expect(page.getByTestId('ask-retry-menu')).toContainText('Add more detail');
    await page.getByTestId('ask-retry-menu').getByRole('button', { name: 'Make more concise' }).click();
    await expect
      .poll(async () => (await threadDetail(page, id)).turns.filter((t) => t.role === 'assistant').length)
      .toBe(2);
    await answered(page);
    // Only the newest branch is shown.
    await expect(page.getByTestId('ask-assistant-turn')).toHaveCount(1);
    const turns = (await threadDetail(page, id)).turns;
    expect(turns[1]?.parentTurnId).toBe(turns[0]?.id);
    expect(turns[2]?.parentTurnId).toBe(turns[0]?.id);

    await page.getByTestId('ask-feedback-up').click();
    await expect.poll(async () => (await threadDetail(page, id)).turns.at(-1)?.feedback?.type).toBe('positive');
    await page.getByTestId('ask-feedback-up').click();
    await expect.poll(async () => (await threadDetail(page, id)).turns.at(-1)?.feedback).toBeNull();
    await page.getByTestId('ask-feedback-down').click();
    const dialog = page.getByRole('dialog', { name: 'Additional feedback' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Details').fill('Too vague');
    await dialog.getByRole('button', { name: 'Share feedback' }).click();
    await expect
      .poll(async () => (await threadDetail(page, id)).turns.at(-1)?.feedback)
      .toMatchObject({
        type: 'negative',
        reason: 'Too vague',
      });
    await context.close();
  });

  test('history lists chats; rename from the title; delete from the menu; unknown chats say so', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:plain] history one');
    await answered(page);
    const id = threadIdOf(page);

    // Rename by clicking the title.
    await page.getByTestId('ask-title').click();
    await page.getByTestId('ask-title-input').fill('Renamed by hand');
    await page.getByTestId('ask-title-input').press('Enter');
    await expect(page.getByTestId('ask-title')).toHaveText('Renamed by hand');
    await expect(page.getByRole('link', { name: 'Renamed by hand' })).toBeVisible();

    // View history: search, open.
    await page.getByTestId('ask-new-chat').click();
    await expect(page).toHaveURL(/\/chats\/new$/);
    await page.getByTestId('ask-history').click();
    const popover = page.getByTestId('ask-history-popover');
    await popover.getByPlaceholder('Search history...').fill('Renamed');
    await expect(popover.getByTestId('ask-history-row')).toHaveCount(1);
    await popover.getByTestId('ask-history-row').getByRole('button').first().click();
    await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));

    // Delete from More actions → confirm.
    await page.getByTestId('ask-more').click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/chats\/new$/);
    expect((await threadList(page)).some((t) => t.id === id)).toBe(false);
    await page.goto(ws(`chats/${id}`));
    await expect(page.getByTestId('ask-not-found')).toContainText('Chat not found');
    await context.close();
  });

  test('another tab on the same thread follows the streamed answer live', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:plain] start the thread');
    await answered(page);
    const id = threadIdOf(page);

    const other = await context.newPage();
    await other.goto(ws(`chats/${id}`));
    await expect(other.getByTestId('ask-user-turn')).toHaveCount(1);

    await typeAndSend(page, '[e2e:slow] stream slowly');
    // The second tab shows the new turn and sees text arrive before the answer is complete…
    await expect(other.getByTestId('ask-user-turn')).toHaveCount(2, { timeout: 15_000 });
    await expect(lastAssistant(other).getByTestId('ask-markdown')).toContainText('streamed slowly', {
      timeout: 15_000,
    });
    // …and the finished, persisted turn after it ends, without a reload.
    await answered(other);
    await expect(lastAssistant(other).getByTestId('ask-markdown')).toContainText('short conclusion for the reader');
    await context.close();
  });

  test('Stop cancels a running answer: "Interrupted" and the composer is back', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:slow] stream slowly then stop');
    await expect(page.getByTestId('ask-stop')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('ask-stop').click();
    await expect(page.getByTestId('ask-turn-interrupted')).toContainText('Interrupted');
    await expect(lastAssistant(page)).toHaveAttribute('data-status', 'canceled');
    await expect(page.getByTestId('ask-send')).toBeVisible();
    await context.close();
  });

  test('a provider refusal shows the failure banner', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await typeAndSend(page, '[e2e:refuse] please refuse');
    await expect(page.getByTestId('ask-turn-failed')).toContainText('Provider declined', { timeout: 15_000 });
    await context.close();
  });

  test('without an AI key the composer says so; out of credits it shows the limit notice', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    await patchTrpc(page, 'ai.models.list', (data) => ({ ...data, configured: false, models: [] }));
    await page.goto(ws('chats/new'));
    await expect(page.getByTestId('ask-not-configured')).toContainText("Ask AI isn't set up yet");
    await expect(page.getByTestId('ask-input')).toHaveCount(0);
    await page.goto(ws('home'));
    await expect(page.getByTestId('home-ask').getByTestId('ask-not-configured')).toBeVisible();
    await page.unroute('**/trpc/**');

    await patchTrpc(page, 'credits.usage', (data) => ({ ...data, outOfCredits: true }));
    await page.goto(ws('chats/new'));
    await expect(page.getByTestId('ask-credit-limit')).toContainText("You've reached your credit limit");
    await expect(page.getByTestId('ask-input')).toHaveCount(0);
    await context.close();
  });

  test('a call as page context: chip with the call title; snippets link to transcript ranges (10.16)', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const call = await importedCall(page);
    // The call page's "Ask AI" opens the chat with the call as context (openAsk); the full page reads it from ?i=.
    const i = Buffer.from(
      JSON.stringify({ call: { meetingId: call.meetingId, callRecordingId: call.recordingId } }),
    ).toString('base64url');
    await page.goto(ws(`chats/new?i=${i}`));
    await expect(page.getByTestId('ask-context-chip')).toContainText(call.title);

    await typeAndSend(page, '[e2e:snippets] what were the key moments?');
    await answered(page);
    const card = page.getByTestId('ask-call-snippets');
    await expect(card).toContainText(call.title);
    const rows = card.getByTestId('ask-call-snippet');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute(
      'href',
      `/mymeet/calls/${call.meetingId}/${call.recordingId}/transcript?start=18&end=44`,
    );
    await expect(rows.nth(1)).toHaveAttribute(
      'href',
      `/mymeet/calls/${call.meetingId}/${call.recordingId}/transcript?start=60&end=92`,
    );
    // The call travelled as an interest part of the message.
    const detail = await threadDetail(page, threadIdOf(page));
    expect(detail.turns[0]?.parts.some((p) => p.type === 'interest' && p.interestType === 'call-recording')).toBe(true);
    await context.close();
  });
});

test.describe('Ask AI around the app', () => {
  test('Home: the composer starts a chat, the recent chat row and the suggestion chip work', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const block = page.getByTestId('home-ask');
    await expect(block).toBeVisible();
    await block.getByTestId('ask-input').click();
    await block.getByTestId('ask-input').fill('[e2e:plain] from home');
    await block.getByTestId('ask-input').press('Enter');
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await answered(page);
    const id = threadIdOf(page);

    await page.goto(ws('home'));
    await expect(page.getByTestId('home-recent-chat')).toContainText('Recent chat ·');
    await page.getByTestId('home-recent-chat').click();
    await expect(page).toHaveURL(new RegExp(`/chats/${id}$`));

    await page.goto(ws('home'));
    await page.getByTestId('home-ask-suggestion').first().click();
    await expect(page).toHaveURL(/\/chats\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('ask-user-turn')).toContainText('prepare for my next meeting');
    await context.close();
  });

  test('the record Overview has an AI summary card: generate, regenerate, out of date after a change', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('home'));
    const company = await findRecord(page, '[seed] Northwind Robotics');
    await page.goto(recordPath('company', company.entityInstanceId));
    const card = page.getByTestId('overview-summary');
    await expect(card).toContainText('Company summary');
    await card.getByTestId('summary-generate').click();
    await expect(card.getByTestId('summary-text')).toContainText('industrial-robotics company');
    await expect(card).toContainText('Generated at');
    await expect(card.getByTestId('summary-stale')).toHaveCount(0);

    // A value changes after the summary was written: the card says it is out of date, Regenerate clears that.
    const attrs = await trpc<{ id: string; apiSlug: string }[]>(page, 'schema.attributes.list', {
      entityDefinitionId: company.entityDefinitionId,
      includeArchived: false,
    });
    const description = attrs.find((a) => a.apiSlug === 'description');
    if (!description) throw new Error('no description attribute');
    await trpc(page, 'records.patch', {
      ...company,
      values: { [description.id]: [{ value: `Updated ${Date.now()}` }] },
    });
    await expect(card.getByTestId('summary-stale')).toBeVisible();
    await card.getByTestId('summary-regenerate').click();
    await expect(card.getByTestId('summary-stale')).toHaveCount(0);
    await context.close();
  });
});

test.describe('Ask AI prompts and settings', () => {
  test('Browse prompts: categories filter, the detail view, Add to my prompts and Customize', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('chats/new'));
    await page.getByTestId('ask-insert-prompt').click();
    await page.getByTestId('ask-prompt-browse').click();
    const gallery = page.getByTestId('prompts-gallery');
    await expect(gallery).toBeVisible();
    await expect(gallery.getByTestId('prompt-card').first()).toBeVisible();
    const total = await gallery.getByTestId('prompt-card').count();
    expect(total).toBeGreaterThanOrEqual(12);
    await gallery.getByRole('checkbox', { name: 'Marketing' }).check({ force: true });
    await expect.poll(async () => gallery.getByTestId('prompt-card').count()).toBeLessThan(total);
    await gallery.getByRole('checkbox', { name: 'Marketing' }).uncheck({ force: true });
    await gallery.getByPlaceholder('Search').fill('QBR');
    await expect(gallery.getByTestId('prompt-card')).toHaveCount(1);
    await gallery.getByTestId('prompt-card').click();
    await expect(page.getByTestId('prompt-guidance')).toContainText('Context');
    await expect(page.getByTestId('prompt-add')).toHaveText('Add to my prompts');
    await page.getByTestId('prompt-add').click();
    await expect(page.getByTestId('prompt-add')).toHaveText('Remove from my prompts');
    // Customize copies it into a custom prompt and opens the editor.
    await page.getByTestId('prompt-customize').click();
    const editor = page.getByTestId('edit-prompt-modal');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('prompt-title')).toHaveValue('QBR Prep');
    await editor.getByTestId('prompt-title').fill('My QBR prep');
    await page.keyboard.press(`${mod}+Enter`);
    await expect(editor).toHaveCount(0);
    expect(
      (await trpc<{ prompts: { title: string | null }[] }>(page, 'prompts.list', { scope: 'mine' })).prompts.map(
        (p) => p.title,
      ),
    ).toContain('My QBR prep');
    await context.close();
  });

  test('Create prompt: Generate (the AI writes it), Advanced (by hand), edit, share and remove', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('settings/ask-agentic/prompts'));
    await expect(page.getByTestId('prompts-saved')).toContainText('Daily brief');
    // Generate: description → draft in the editor → Create.
    await page.getByTestId('prompts-create').click();
    const modal = page.getByTestId('create-prompt-modal');
    await modal.getByTestId('prompt-description').fill('Summarize the status of a project');
    await modal.getByTestId('prompt-generate').click();
    await expect(modal.getByTestId('prompt-title')).toHaveValue('Project status digest');
    await expect(modal.getByTestId('prompt-body')).toContainText('Context');
    await modal.getByTestId('prompt-create').click();
    await expect(modal).toHaveCount(0);
    const own = page.getByTestId('prompts-own');
    await expect(
      own.getByTestId('prompt-card').filter({ hasText: /Project status digest|Summarize project phases/ }),
    ).toBeVisible();

    // Advanced: by hand.
    await page.getByTestId('prompts-create').click();
    await page.getByTestId('prompt-advanced').click();
    await page.getByTestId('prompt-title').fill('Hand written prompt');
    await page.getByTestId('prompt-body').fill('Summarize my open deals.');
    await page.getByTestId('prompt-create').click();
    await expect(own.getByTestId('prompt-card').filter({ hasText: 'Hand written prompt' })).toBeVisible();

    // Edit: open the card, change the title, share the workspace read-write.
    await own.getByTestId('prompt-card').filter({ hasText: 'Hand written prompt' }).click();
    const edit = page.getByTestId('edit-prompt-modal');
    await edit.getByTestId('prompt-share-button').click();
    await expect(page.getByTestId('prompt-share')).toContainText('Workspace access');
    await page
      .getByTestId('prompt-share')
      .getByRole('button', { name: /Read only/ })
      .first()
      .click();
    await page.getByRole('option', { name: /Read and write/ }).click();
    // The Select trigger keeps Escape for itself (react-aria); close the share dialog from its search field.
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.getByTestId('prompt-share').getByLabel('Search members').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('prompt-share')).toBeHidden();
    await edit.getByTestId('prompt-title').fill('Renamed prompt');
    await edit.getByTestId('prompt-save').click();
    await expect(own.getByTestId('prompt-card').filter({ hasText: 'Renamed prompt' })).toBeVisible();
    const mine = await trpc<{ prompts: { id: string; title: string | null }[] }>(page, 'prompts.list', {
      scope: 'mine',
    });
    const renamed = mine.prompts.find((p) => p.title === 'Renamed prompt');
    expect(
      (await trpc<{ workspaceAccess: string }>(page, 'prompts.sharing', { promptId: renamed?.id })).workspaceAccess,
    ).toBe('read-write');

    // The Actions menu removes a prompt.
    const card = own.getByTestId('prompt-card').filter({ hasText: 'Renamed prompt' });
    await card.hover();
    await card.getByTestId('prompt-actions').click();
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    await expect(own.getByTestId('prompt-card').filter({ hasText: 'Renamed prompt' })).toHaveCount(0);
    await context.close();
  });

  test('Settings › Ask AI › General saves the privacy and model choices and shows this period’s credits', async ({
    browser,
  }) => {
    const { context, page } = await signedInPage(browser, ws('settings/ask-agentic'));
    await expect(page).toHaveURL(/\/settings\/ask-agentic\/general$/);
    const rows = page.getByTestId('ask-setting-row');
    await expect(rows.first()).toContainText('Web search');
    await expect(page.getByTestId('ask-credits-table')).toContainText('Personal credits used');
    await expect(page.getByTestId('ask-credits-personal')).toContainText('/1');

    await page.getByRole('button', { name: /Web search/ }).click();
    await page.getByRole('option', { name: "Don't allow" }).click();
    await expect
      .poll(async () => (await trpc<{ allowWebSearch: string }>(page, 'ai.settings.get', {})).allowWebSearch)
      .toBe('disabled');
    await page.getByRole('button', { name: /Default model/ }).click();
    await page.getByRole('option', { name: 'Sonnet 5.5' }).click();
    await expect
      .poll(async () => (await trpc<{ defaultModel: string | null }>(page, 'ai.settings.get', {})).defaultModel)
      .toBe('claude-sonnet-5-5');
    // The default model is what a new chat starts with.
    await page.goto(ws('chats/new'));
    await expect(page.getByTestId('ask-model-picker')).toHaveText('Sonnet 5.5');
    await trpc(page, 'ai.settings.update', { allowWebSearch: 'always-ask', defaultModel: null });
    await context.close();
  });

  test('Settings › Workspace › Ask AI: usage (credits, members, limit) and the custom context', async ({ browser }) => {
    const { context, page } = await signedInPage(browser, ws('settings/workspace-ask-agentic'));
    await expect(page).toHaveURL(/\/settings\/workspace-ask-agentic\/usage$/);
    const stats = page.getByTestId('ask-usage-stats');
    await expect(stats).toContainText('Credits available per member');
    await expect(stats).toContainText('Members using Ask AI');
    await expect(page.getByTestId('ask-usage-pool')).toContainText('workspace credits');
    await expect(page.getByTestId('ask-usage-member').first()).toContainText('(You)');
    // The chats of this run spent credits: this member's usage is above zero.
    await expect(page.getByTestId('ask-usage-member').first()).not.toContainText(/\s0$/);

    // Set a limit → the pool's Ask limit.
    await page.getByTestId('ask-limit-switch').click();
    await expect
      .poll(
        async () =>
          (await trpc<{ askWorkspaceCreditsLimit: number | null }>(page, 'ai.workspaceSettings.get', {}))
            .askWorkspaceCreditsLimit,
      )
      .not.toBeNull();
    await page.getByTestId('ask-limit-input').fill('0');
    await page.getByTestId('ask-limit-input').blur();
    await expect
      .poll(
        async () =>
          (await trpc<{ askWorkspaceCreditsLimit: number | null }>(page, 'ai.workspaceSettings.get', {}))
            .askWorkspaceCreditsLimit,
      )
      .toBe(0);
    await page.getByTestId('ask-limit-switch').click();
    await expect
      .poll(
        async () =>
          (await trpc<{ askWorkspaceCreditsLimit: number | null }>(page, 'ai.workspaceSettings.get', {}))
            .askWorkspaceCreditsLimit,
      )
      .toBeNull();

    // Custom context: saved as you type, counted, and handed to the model.
    await page.getByRole('tab', { name: 'Custom context' }).click();
    await expect(page).toHaveURL(/\/custom-context$/);
    await page.getByTestId('ask-context-input').fill('We sell warehouse robots. Answer briefly.');
    await expect(page.getByTestId('ask-context-counter')).toHaveText('41 / 20,000');
    await expect
      .poll(
        async () => (await trpc<{ customContext: string | null }>(page, 'ai.workspaceSettings.get', {})).customContext,
      )
      .toBe('We sell warehouse robots. Answer briefly.');
    await trpc(page, 'ai.workspaceSettings.update', { customContext: null });
    await context.close();
  });
});
