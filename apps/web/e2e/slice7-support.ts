//  e2e helpers (email and calendar): test mailboxes, injected mail and meetings, a second member whose mailbox
// shares at a given visibility level. Everything goes through the public tRPC procedures of the test connector
// (`connectors.test.*`), exactly like the dev tools; nothing is delivered anywhere.
import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { trpc } from './slice3-support.ts';
import { ada, type Member, secondMember, signedInAs } from './slice5-support.ts';

export interface TestMailbox {
  id: string;
  emailAddress: string;
  defaultVisibility: 'full-access' | 'subject-line' | 'metadata-only';
}

/** Connects (idempotently, by address) a test mailbox of the signed-in member. */
export async function ensureMailbox(
  page: Page,
  emailAddress: string,
  visibility: TestMailbox['defaultVisibility'] = 'subject-line',
): Promise<TestMailbox> {
  const existing = await trpc<TestMailbox[]>(page, 'mailboxes.list', {});
  const found = existing.find((m) => m.emailAddress === emailAddress);
  if (found) {
    if (found.defaultVisibility !== visibility) {
      await trpc(page, 'mailboxes.update', { mailboxId: found.id, defaultVisibility: visibility });
      found.defaultVisibility = visibility;
    }
    return found;
  }
  const out = await trpc<{ mailbox: TestMailbox }>(page, 'mailboxes.connect', {
    id: randomUUID(),
    provider: 'test',
    emailAddress,
    syncCalendar: true,
  });
  if (out.mailbox.defaultVisibility !== visibility) {
    await trpc(page, 'mailboxes.update', { mailboxId: out.mailbox.id, defaultVisibility: visibility });
  }
  return { ...out.mailbox, defaultVisibility: visibility };
}

export interface Address {
  emailAddress: string;
  name?: string | null;
}

export interface InjectedMessage {
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  from: Address;
  to: Address[];
  cc?: Address[];
  sentAt?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  attachments?: { name: string; contentType: string; size: number }[];
}

/** Injects one message into a test mailbox and syncs it (unknown addresses create records per the workspace mode). */
export async function injectMessage(page: Page, mailboxId: string, message: InjectedMessage): Promise<void> {
  const id = randomUUID();
  await trpc(page, 'connectors.test.injectMessage', {
    mailboxId,
    message: { providerMessageId: id, providerThreadId: `thread-${id}`, ...message },
    syncNow: true,
  });
}

export interface InjectedEvent {
  title: string;
  description?: string;
  start: string;
  end: string;
  attendees: { emailAddress: string; name?: string | null; status?: string; isOrganizer?: boolean }[];
  conferenceUrl?: string | null;
}

export async function injectEvent(page: Page, mailboxId: string, event: InjectedEvent): Promise<void> {
  const id = randomUUID();
  await trpc(page, 'connectors.test.injectEvent', {
    mailboxId,
    event: {
      providerEventId: id,
      icalUid: `${id}@e2e.test`,
      title: event.title,
      description: event.description ?? '',
      start: { dateTime: event.start, timeZone: 'UTC' },
      end: { dateTime: event.end, timeZone: 'UTC' },
      conferenceUrl: event.conferenceUrl ?? null,
      attendees: event.attendees,
    },
    syncNow: true,
  });
}

export const JANE = { emailAddress: 'jane.cooper@northwind.example.com', name: 'Jane Cooper' };
export const WADE = { emailAddress: 'wade.warren@northwind.example.com', name: 'Wade Warren' };

export const ADA_MAILBOX = 'ada@mymeet.ai';
export const GRACE_MAILBOX = 'grace@mymeet.ai';

export interface Slice7Seed {
  ada: Member;
  grace: Member;
  adaMailbox: TestMailbox;
  graceMailbox: TestMailbox;
}

let seeded: Promise<Slice7Seed> | null = null;

/**
 * Ada owns a full-access mailbox with a customer thread; Grace owns a subject-line mailbox with a thread about
 * "Secret pricing". Idempotent per run (the injected messages carry fixed subjects and are only added once).
 */
export function seedSlice7(browser: Browser, path = '/mymeet/home'): Promise<Slice7Seed> {
  seeded ??= (async () => {
    const adaMember = ada();
    const graceMember = secondMember();
    const adaSession = await signedInAs(browser, adaMember, path);
    const graceSession = await signedInAs(browser, graceMember, path);
    try {
      const adaMailbox = await ensureMailbox(adaSession.page, ADA_MAILBOX, 'full-access');
      const graceMailbox = await ensureMailbox(graceSession.page, GRACE_MAILBOX, 'subject-line');
      const threads = await trpc<{ threads: { subject: string | null }[] }>(adaSession.page, 'email.threads', {
        record: { entityDefinitionId: 'people', entityInstanceId: await janeId(adaSession.page) },
      });
      const has = (subject: string) => threads.threads.some((t) => t.subject === subject);
      if (!has('Pilot for Northwind')) {
        await injectMessage(adaSession.page, adaMailbox.id, {
          subject: 'Pilot for Northwind',
          bodyText: 'Hi! We would like to start a pilot next month. Could you send the proposal?',
          bodyHtml: '<p>Hi! We would like to start a pilot next month. Could you send the proposal?</p>',
          from: JANE,
          to: [{ emailAddress: ADA_MAILBOX, name: 'Ada Tester' }],
          sentAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
        });
      }
      // The owner sees her own threads in full whatever her sharing level is now: dedupe on that view.
      const graceThreads = await trpc<{ threads: { subject: string | null }[] }>(graceSession.page, 'email.threads', {
        record: { entityDefinitionId: 'people', entityInstanceId: await janeId(graceSession.page) },
      });
      if (!graceThreads.threads.some((t) => t.subject === 'Secret pricing')) {
        await injectSecretPricing(graceSession.page, graceMailbox.id);
      }
      return { ada: adaMember, grace: graceMember, adaMailbox, graceMailbox };
    } finally {
      await adaSession.context.close();
      await graceSession.context.close();
    }
  })();
  return seeded;
}

async function injectSecretPricing(page: Page, mailboxId: string): Promise<void> {
  await injectMessage(page, mailboxId, {
    subject: 'Secret pricing',
    bodyText: 'Our best price for the Northwind pilot is 12 000 EUR.',
    bodyHtml: '<p>Our best price for the Northwind pilot is <b>12 000 EUR</b>.</p>',
    from: { emailAddress: GRACE_MAILBOX, name: 'Grace Hopper' },
    to: [JANE],
    sentAt: new Date(Date.now() - 24 * 3_600_000).toISOString(),
  });
}

/** The seeded person "[seed] Jane Cooper". */
export async function janeId(page: Page): Promise<string> {
  const out = await trpc<{ hits: { entityInstanceId: string; title: string | null }[] }>(page, 'search.records', {
    query: 'Jane Cooper',
    limit: 10,
  });
  const hit = out.hits.find((h) => h.title === '[seed] Jane Cooper');
  if (!hit) throw new Error('no [seed] Jane Cooper');
  return hit.entityInstanceId;
}

/** The same RFC message synced by several mailboxes (one logical message, one copy each: "via N mailboxes"). */
export async function injectSharedMessage(
  copies: { page: Page; mailboxId: string }[],
  message: InjectedMessage,
  rfcMessageId = `<${randomUUID()}@e2e.test>`,
): Promise<void> {
  for (const copy of copies) {
    await trpc(copy.page, 'connectors.test.injectMessage', {
      mailboxId: copy.mailboxId,
      message: {
        ...message,
        providerMessageId: randomUUID(),
        providerThreadId: `thread-${rfcMessageId}`,
        rfcMessageId,
      },
      syncNow: true,
    });
  }
}

/** The app path of a person record at `tab` (default Emails). */
export function personTab(personId: string, tab = 'emails'): string {
  return `/mymeet/person/${personId}/${tab}`;
}

/** Removes every signature of the member's mailboxes (a default signature starts every new draft). */
export async function clearSignatures(page: Page): Promise<void> {
  for (const mailbox of await trpc<{ id: string }[]>(page, 'mailboxes.list', {})) {
    for (const sig of await trpc<{ id: string }[]>(page, 'email.signatures.list', { mailboxId: mailbox.id })) {
      await trpc(page, 'email.signatures.delete', { signatureId: sig.id });
    }
  }
}
