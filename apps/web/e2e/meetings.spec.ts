// Slice 7 — meetings (BACKLOG 7.04): meeting events in the Activity tab (past and upcoming), the meeting modal with
// linked records and "Create note", the "New meeting" dialog (two participants needed), the Home Meetings widget and
// the visibility levels of synced calendars. Events come in through the test connector (`connectors.test.injectEvent`).
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { findRecord } from './record-support.ts';
import { trpc } from './slice3-support.ts';
import { memberId, signedInAs } from './slice5-support.ts';
import {
  ADA_MAILBOX,
  ensureMailbox,
  GRACE_MAILBOX,
  injectEvent,
  JANE,
  janeId,
  personTab,
  type Slice7Seed,
  seedSlice7,
} from './slice7-support.ts';

test.describe.configure({ mode: 'serial' });

let seed: Slice7Seed;
let jane = '';
const tag = randomUUID().slice(0, 6);
const HOUR = 3_600_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const ADA = { emailAddress: ADA_MAILBOX, name: 'Ada Tester' };
const attendees = (adaStatus = 'accepted') => [
  { ...ADA, status: adaStatus, isOrganizer: true },
  { ...JANE, status: 'accepted' },
];

test.beforeAll(async ({ browser }) => {
  seed = await seedSlice7(browser);
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  jane = await janeId(page);
  // A past meeting (yesterday), an upcoming one (tomorrow) with a conference link.
  await injectEvent(page, seed.adaMailbox.id, {
    title: `Kickoff yesterday ${tag}`,
    description: 'Walk through the pilot plan.',
    start: iso(-26 * HOUR),
    end: iso(-25 * HOUR),
    attendees: attendees(),
  });
  await injectEvent(page, seed.adaMailbox.id, {
    title: `Review tomorrow ${tag}`,
    description: 'Review the proposal.',
    start: iso(24 * HOUR),
    end: iso(25 * HOUR),
    attendees: attendees(),
    conferenceUrl: 'https://meet.example.com/review',
  });
  await context.close();
});

test.beforeEach(({}, testInfo) => testInfo.setTimeout(90_000));

const modal = (page: Page) => page.getByTestId('meeting-modal');
const eventCard = (page: Page, title: string) => page.getByTestId('event-meeting-card').filter({ hasText: title });

async function activity(browser: Parameters<typeof signedInAs>[0]) {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  await page.goto(personTab(jane, 'activity'));
  await expect(page.getByTestId('activity-feed')).toBeVisible();
  return { context, page };
}

test('Activity: a past meeting "attended", an upcoming one under "Upcoming"; the card opens the modal', async ({
  browser,
}) => {
  const { context, page } = await activity(browser);
  const past = eventCard(page, `Kickoff yesterday ${tag}`);
  await expect(past).toBeVisible();
  await expect(past.getByTestId('event-meeting-participants')).toHaveText('2 participants');
  await expect(past.getByTestId('event-meeting-time')).toContainText(
    /\d{1,2}:\d{2} (AM|PM) → \d{1,2}:\d{2} (AM|PM) \(1h\)/,
  );
  const pastRow = page.getByTestId('activity-event').filter({ has: past });
  await expect(pastRow).toContainText(/Ada Tester\s*attended a meeting/);
  // Past events sit in a period group, not under "Upcoming".
  await expect(page.locator('[data-upcoming]').filter({ has: past })).toHaveCount(0);

  const upcoming = page.locator('[data-upcoming]').filter({ has: eventCard(page, `Review tomorrow ${tag}`) });
  await expect(upcoming.first()).toContainText('Upcoming');
  await expect(upcoming.first()).toContainText(/Ada Tester\s*is attending a meeting/);

  await past.click();
  await expect(page).toHaveURL(/modal=meeting&id=/);
  await expect(modal(page)).toBeVisible();
  await context.close();
});

test('the meeting modal: tile, title, RSVP, time, participants, call intelligence (synced = read-only)', async ({
  browser,
}) => {
  const { context, page } = await activity(browser);
  await eventCard(page, `Kickoff yesterday ${tag}`).click();
  const m = modal(page);
  await expect(m.getByTestId('meeting-title')).toHaveText(`Kickoff yesterday ${tag}`);
  await expect(m.getByTestId('meeting-title-input')).toHaveCount(0);
  await expect(m.getByRole('heading', { name: 'Meeting', exact: true })).toBeVisible();
  await expect(m.getByTestId('meeting-tile')).toContainText(/[A-Z]{3}\d{2}/);
  await expect(m.getByTestId('meeting-time')).toContainText(
    /(Yesterday|\d{1,2} [A-Z][a-z]{2}) \| \d{1,2}:\d{2} (AM|PM) → \d{1,2}:\d{2} (AM|PM) \(1h\)/,
  );
  await expect(m.getByTestId('meeting-description')).toContainText('Walk through the pilot plan.');
  // The viewer attended: the pill reads "Attended" in the title row and on their participant row.
  await expect(m.getByTestId('meeting-rsvp').first()).toHaveText('Attended');
  await expect(m.getByTestId('meeting-call-intelligence')).toContainText('Meeting not recorded (No conference set up)');
  const people = m.getByTestId('meeting-participants');
  await expect(people).toContainText('Participants');
  await expect(people.getByTestId('meeting-participant')).toHaveCount(2);
  await expect(people.getByTestId('meeting-participant').first()).toContainText('Host');
  await expect(
    people.getByTestId('meeting-participant').filter({ hasText: 'Jane Cooper' }).getByRole('link'),
  ).toHaveAttribute('href', new RegExp(`/person/${jane}`));
  await expect(m.getByRole('button', { name: 'Ask AI' })).toBeVisible();
  await m.getByRole('button', { name: 'Ask AI' }).click();
  // Ask AI (slice 10): the side panel opens with the meeting as its context.
  await expect(page.getByTestId('ask-panel')).toBeVisible();
  await expect(page.getByTestId('ask-context-chip')).toBeVisible();
  await context.close();
});

test('a meeting with a conference link says "No recording"', async ({ browser }) => {
  const { context, page } = await activity(browser);
  await eventCard(page, `Review tomorrow ${tag}`).click();
  await expect(modal(page).getByTestId('meeting-recording-state')).toContainText('No recording');
  await expect(modal(page).getByTestId('meeting-rsvp').first()).toHaveText('Attending');
  await context.close();
});

test('linked records: link, "Create note" on the meeting, unlink', async ({ browser }) => {
  const { context, page } = await activity(browser);
  const northwind = await findRecord(page, '[seed] Northwind Robotics');
  await eventCard(page, `Kickoff yesterday ${tag}`).click();
  const m = modal(page);
  const linked = m.getByTestId('meeting-linked-records');
  await expect(linked).toContainText('Linked records');
  await linked.getByTestId('meeting-link-records').click();
  await page.getByRole('combobox', { name: 'Linked records' }).fill('Northwind Robotics');
  await page
    .getByRole('option', { name: /Northwind Robotics/ })
    .first()
    .click();
  await expect(linked.getByTestId('meeting-linked-record')).toHaveCount(1);
  await expect(linked.getByTestId('meeting-linked-record')).toContainText('Northwind Robotics');
  const meetingId = (await m.getAttribute('data-meeting-id')) as string;
  const afterLink = await trpc<{ linkedRecords: { entityInstanceId: string }[] }>(page, 'meetings.get', { meetingId });
  expect(afterLink.linkedRecords.map((r) => r.entityInstanceId)).toEqual([northwind.entityInstanceId]);

  await m.getByTestId('meeting-create-note').click();
  await expect(page).toHaveURL(/modal=note&id=/);
  const noteId = new URL(page.url()).searchParams.get('id') as string;
  const note = await trpc<{ meetingId: string | null; parentRecords: { entityInstanceId: string }[] }>(
    page,
    'notes.get',
    {
      noteId,
    },
  );
  expect(note.meetingId).toBe(meetingId);
  expect(note.parentRecords.map((r) => r.entityInstanceId)).toEqual([northwind.entityInstanceId]);
  await trpc(page, 'notes.delete', { noteId });

  // Back on the meeting: remove the link again.
  await page.goto(`/mymeet/home?modal=meeting&id=${meetingId}`);
  await modal(page).getByRole('button', { name: 'Remove linked record' }).click();
  await expect(modal(page).getByTestId('meeting-link-records')).toBeVisible();
  await context.close();
});

test('a meeting with only members and no linked record cannot start a note (toast, no note)', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const adaId = await memberId(page, seed.ada.email);
  const graceId = await memberId(page, seed.grace.email);
  const id = randomUUID();
  await trpc(page, 'meetings.create', {
    id,
    title: `Members only ${tag}`,
    start: { datetime: iso(5 * HOUR) },
    end: { datetime: iso(6 * HOUR) },
    participants: [{ memberId: adaId, isOrganizer: true }, { memberId: graceId }],
  });
  await page.goto(`/mymeet/home?modal=meeting&id=${id}`);
  await modal(page).getByTestId('meeting-create-note').click();
  await expect(page.getByText('Link a record first')).toBeVisible();
  expect(page.url()).not.toContain('modal=note');
  await trpc(page, 'meetings.delete', { meetingId: id });
  await context.close();
});

test('New meeting dialog: two participants are required, then the meeting shows up in Activity', async ({
  browser,
}) => {
  const { context, page } = await activity(browser);
  await page.getByTestId('add-meeting').click();
  const dialog = page.getByTestId('new-meeting-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'New meeting' })).toBeVisible();
  // Defaults: today, a 30-minute slot, the current member as Host, the record pre-linked.
  await expect(dialog.getByTestId('new-meeting-date')).toHaveText('Today');
  await expect(dialog.getByTestId('new-meeting-duration')).toHaveText('(30m)');
  await expect(dialog.getByTestId('new-meeting-start')).toHaveValue(/^\d{1,2}:(00|30) (AM|PM)$/);
  const host = dialog.getByTestId('new-meeting-participant');
  await expect(host).toHaveCount(1);
  await expect(host).toContainText('Ada Tester');
  await expect(host).toContainText('Host');
  await expect(host).toContainText(seed.ada.email);
  await expect(dialog.getByTestId('new-meeting-linked')).toContainText('Jane Cooper');
  await expect(dialog.getByRole('button', { name: /Cancel/ })).toContainText('ESC');

  await dialog.getByTestId('new-meeting-title').fill(`E2E sync ${tag}`);
  await dialog.getByTestId('new-meeting-description').fill('Agenda: roadmap');
  await dialog.getByTestId('new-meeting-create').click();
  await expect(dialog.getByTestId('new-meeting-error')).toHaveText('At least two participants are required');

  // Tomorrow morning (always upcoming), typed times: the duration follows.
  await dialog.getByTestId('new-meeting-date').click();
  await page.getByTestId('deadline-picker').getByRole('button', { name: 'Tomorrow' }).click();
  await expect(dialog.getByTestId('new-meeting-date')).toHaveText('Tomorrow');
  await dialog.getByTestId('new-meeting-start').fill('9:00 AM');
  await dialog.getByTestId('new-meeting-start').press('Enter');
  await dialog.getByTestId('new-meeting-end').fill('10:15 AM');
  await dialog.getByTestId('new-meeting-end').press('Enter');
  await expect(dialog.getByTestId('new-meeting-start')).toHaveValue('9:00 AM');
  await expect(dialog.getByTestId('new-meeting-duration')).toHaveText('(1h 15m)');

  // Add a member and a typed address; "Make host" moves the Host tag.
  await dialog.getByTestId('new-meeting-add-participant').click();
  await page.getByRole('combobox', { name: 'Participants' }).fill('Grace');
  await page.getByRole('option', { name: /Grace Hopper/ }).click();
  await expect(host).toHaveCount(2);
  await expect(dialog.getByTestId('new-meeting-error')).toHaveCount(0);
  await dialog.getByTestId('new-meeting-add-participant').click();
  await page.getByRole('combobox', { name: 'Participants' }).fill(`guest.${tag}@example.com`);
  await page.getByRole('option', { name: new RegExp(`Add guest.${tag}@example.com`) }).click();
  await expect(host).toHaveCount(3);
  await host.filter({ hasText: 'Grace Hopper' }).hover();
  await host.filter({ hasText: 'Grace Hopper' }).getByRole('button', { name: 'Make host' }).click();
  await expect(host.filter({ hasText: 'Grace Hopper' })).toContainText('Host');
  await expect(host.filter({ hasText: 'Ada Tester' })).not.toContainText('Host');
  await host.filter({ hasText: 'Ada Tester' }).hover();
  await host.filter({ hasText: 'Ada Tester' }).getByRole('button', { name: 'Make host' }).click();

  await dialog.getByTestId('new-meeting-title').press('Meta+Enter');
  await expect(page.getByText('Meeting created')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  const card = eventCard(page, `E2E sync ${tag}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId('event-meeting-participants')).toHaveText('3 participants');
  await expect(page.getByTestId('activity-event').filter({ has: card })).toContainText(
    /Ada Tester\s*is attending a meeting/,
  );
  await expect(page.locator('[data-upcoming]').filter({ has: card }).first()).toContainText('Upcoming');

  // The manual meeting edits its title in place.
  await card.click();
  const m = modal(page);
  await expect(m.getByTestId('meeting-title-input')).toHaveValue(`E2E sync ${tag}`);
  await expect(m.getByTestId('meeting-description')).toContainText('Agenda: roadmap');
  await expect(m.getByTestId('meeting-linked-records')).toContainText('Jane Cooper');
  await expect(m.getByTestId('meeting-participants').getByTestId('meeting-participant').first()).toContainText('Host');
  await m.getByTestId('meeting-title-input').fill(`E2E renamed ${tag}`);
  await m.getByTestId('meeting-title-input').press('Enter');
  const id = (await m.getAttribute('data-meeting-id')) as string;
  await expect
    .poll(async () => (await trpc<{ title: string }>(page, 'meetings.get', { meetingId: id })).title)
    .toBe(`E2E renamed ${tag}`);
  await page.keyboard.press('Escape');
  await expect(eventCard(page, `E2E renamed ${tag}`)).toBeVisible();
  await context.close();
});

test('New meeting dialog: Esc cancels without creating', async ({ browser }) => {
  const { context, page } = await activity(browser);
  await page.getByTestId('add-meeting').click();
  await page.getByTestId('new-meeting-title').fill(`Cancelled ${tag}`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('new-meeting-dialog')).toHaveCount(0);
  await expect(eventCard(page, `Cancelled ${tag}`)).toHaveCount(0);
  await context.close();
});

test('Home: the Meetings widget shows today and tomorrow, expands a meeting and opens it', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  await injectEvent(page, seed.adaMailbox.id, {
    title: `Home today ${tag}`,
    description: 'A <b>bold</b> description for the card.',
    start: iso(-5 * 60_000),
    end: iso(25 * 60_000),
    attendees: attendees(),
    conferenceUrl: null,
  });
  await page.goto('/mymeet/home');
  const widget = page.getByTestId('home-meetings');
  await expect(widget).toContainText('Meetings');
  await expect(widget.getByTestId('home-meetings-date')).toHaveText(/^Today, [A-Z][a-z]{2} \d{1,2}$/);
  // Today: the current meeting is expanded (details, participants, "Open meeting").
  await expect(widget.getByTestId('home-meeting-card')).toHaveCount(1);
  const card = widget.getByTestId('home-meeting-card').filter({ hasText: `Home today ${tag}` });
  await expect(card).toBeVisible();
  await expect(card).toContainText('A bold description for the card.');
  await expect(card).toContainText('Participants');
  await expect(card).toContainText('Host');
  await card.getByRole('button', { name: 'Open meeting' }).click();
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId('meeting-title')).toHaveText(`Home today ${tag}`);
  await page.keyboard.press('Escape');

  // Next day: the upcoming meeting with a conference link.
  await widget.getByRole('button', { name: 'Next day' }).click();
  await expect(widget.getByTestId('home-meetings-date')).toHaveText(/^Tomorrow, /);
  const row = widget.getByTestId('home-meeting').filter({ hasText: `Review tomorrow ${tag}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d{1,2}:\d{2} (AM|PM) - \d{1,2}:\d{2} (AM|PM)/);
  await row.click();
  const expanded = widget.getByTestId('home-meeting-card').filter({ hasText: `Review tomorrow ${tag}` });
  await expect(expanded).toContainText('https://meet.example.com/review');
  await expect(expanded.getByRole('button', { name: 'Join meeting' })).toBeVisible();
  await context.close();
});

test('Home: meeting filters, "No matching meetings" and "Next day with meetings"', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  const widget = page.getByTestId('home-meetings');
  // Today's meeting is the current one, so it shows expanded (a card) rather than as a row.
  const today = widget
    .locator('[data-testid="home-meeting"], [data-testid="home-meeting-card"]')
    .filter({ hasText: `Home today ${tag}` });
  await expect(today).toBeVisible();
  // "Events without conferencing" off: today's only meeting has no link and disappears.
  await widget.getByTestId('home-meetings-filters').click();
  const menu = page.getByTestId('home-meetings-filter-menu');
  await expect(menu).toContainText('Show');
  await menu.getByText('Events without conferencing').click();
  await page.keyboard.press('Escape');
  await expect(widget.getByTestId('home-meetings-empty')).toContainText('No matching meetings');
  await widget.getByRole('button', { name: 'Clear filters' }).click();
  await expect(today).toBeVisible();

  // Three days back there is nothing; "Next day with meetings" jumps to the first day with one.
  for (let i = 0; i < 3; i++) await widget.getByRole('button', { name: 'Previous day' }).click();
  await expect(widget.getByTestId('home-meetings-empty')).toContainText('No meetings');
  await widget.getByRole('button', { name: 'Next day with meetings' }).click();
  await expect(widget.getByTestId('home-meetings-date')).toHaveText(/^(Yesterday, |[A-Z][a-z]+day, )/);
  await expect(widget.getByTestId('home-meeting').filter({ hasText: `Kickoff yesterday ${tag}` })).toBeVisible();
  await context.close();
});

test('visibility: a metadata-only calendar shows "Private meeting"; participants stay visible', async ({ browser }) => {
  const grace = await signedInAs(browser, seed.grace, '/mymeet/home');
  await ensureMailbox(grace.page, GRACE_MAILBOX, 'metadata-only');
  try {
    await injectEvent(grace.page, seed.graceMailbox.id, {
      title: `Secret meeting ${tag}`,
      description: 'Confidential agenda',
      start: iso(48 * HOUR),
      end: iso(49 * HOUR),
      attendees: [
        { emailAddress: GRACE_MAILBOX, name: 'Grace Hopper', status: 'accepted', isOrganizer: true },
        { ...JANE, status: 'accepted' },
      ],
    });
    const { context, page } = await activity(browser);
    const more = page.getByRole('button', { name: 'Show more upcoming events' });
    if (await more.count()) await more.click();
    const card = page.getByTestId('event-meeting-card').filter({ hasText: 'Private meeting' });
    await expect(card.first()).toBeVisible();
    await expect(page.getByText(`Secret meeting ${tag}`)).toHaveCount(0);
    await card.first().click();
    const m = modal(page);
    await expect(m.getByTestId('meeting-title')).toHaveText('Private meeting');
    await expect(m).not.toContainText('Confidential agenda');
    await expect(m.getByTestId('meeting-call-intelligence')).toHaveCount(0);
    await expect(m.getByTestId('meeting-participant')).toHaveCount(2);
    await context.close();
  } finally {
    await ensureMailbox(grace.page, GRACE_MAILBOX, 'subject-line');
    await grace.context.close();
  }
});

test('a meeting URL opens directly; an unknown meeting is "Meeting unavailable"', async ({ browser }) => {
  const { context, page } = await signedInAs(browser, seed.ada, '/mymeet/home');
  await page.goto(`/mymeet/home?modal=meeting&id=${randomUUID()}`);
  await expect(page.getByTestId('meeting-unavailable')).toContainText('Meeting unavailable');
  await context.close();
});
