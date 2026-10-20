import type { EmailParticipant } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildEmailSrcdoc,
  canReplyAll,
  composeTarget,
  distinctParticipants,
  formatCount,
  formatFileSize,
  formatMessageTimestamp,
  formatThreadDate,
  ordinalDay,
  participantsSummary,
  recipientsLabel,
  replySubject,
  senderOf,
  textToHtml,
  threadDisplay,
  viaLabel,
} from './model';

const TZ = 'Europe/Moscow';
// Friday 9 October 2026, 18:30 in Moscow (UTC+3).
const NOW = new Date('2026-10-09T15:30:00Z');

const ME = 'member-me';
const person = (
  role: EmailParticipant['role'],
  emailAddress: string,
  name: string | null = null,
  memberId: string | null = null,
): EmailParticipant => ({ role, emailAddress, name, memberId, personId: null, companyId: null });

describe('formatThreadDate', () => {
  it('shows the time for today and "Yesterday, time" for the day before', () => {
    expect(formatThreadDate('2026-10-09T14:07:00Z', NOW, TZ)).toBe('5:07 PM');
    expect(formatThreadDate('2026-10-08T14:07:00Z', NOW, TZ)).toBe('Yesterday, 5:07 PM');
  });

  it('shows day and month within the year, with the year for older mail', () => {
    expect(formatThreadDate('2026-10-06T10:00:00Z', NOW, TZ)).toBe('6 Oct');
    expect(formatThreadDate('2026-07-10T10:00:00Z', NOW, TZ)).toBe('10 Jul');
    expect(formatThreadDate('2025-07-10T10:00:00Z', NOW, TZ)).toBe('10 Jul 2025');
  });

  it('follows the viewer zone at the day boundary', () => {
    // 22:30 UTC on the 8th is already the 9th in Moscow.
    expect(formatThreadDate('2026-10-08T22:30:00Z', NOW, TZ)).toBe('1:30 AM');
    expect(formatThreadDate('2026-10-08T22:30:00Z', NOW, 'UTC')).toBe('Yesterday, 10:30 PM');
  });
});

describe('formatMessageTimestamp', () => {
  it('uses ordinal days: 9th Oct 2026 5:07 PM', () => {
    expect(formatMessageTimestamp('2026-10-09T14:07:00Z', TZ)).toBe('9th Oct 2026 5:07 PM');
    expect(formatMessageTimestamp('2026-10-01T00:05:00Z', 'UTC')).toBe('1st Oct 2026 12:05 AM');
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinalDay)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '30th',
      '31st',
    ]);
  });
});

describe('counts and sizes', () => {
  it('caps the tab count at 99+', () => {
    expect([0, 7, 99, 100, 2500].map(formatCount)).toEqual(['0', '7', '99', '99+', '99+']);
  });

  it('formats attachment sizes', () => {
    expect(formatFileSize(1)).toBe('1 byte');
    expect(formatFileSize(28)).toBe('28 bytes');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(52_000)).toBe('52 KB');
    expect(formatFileSize(3_200_000)).toBe('3.2 MB');
  });
});

describe('viaLabel', () => {
  it('names the owner for one mailbox and counts for several (F §2.2)', () => {
    expect(viaLabel(1, ['Grace Hopper'])).toBe('via Grace Hopper');
    expect(viaLabel(2, ['Ada Tester', 'Grace Hopper'])).toBe('via 2 mailboxes');
    expect(viaLabel(3, [])).toBe('via 3 mailboxes');
    expect(viaLabel(1, [])).toBeNull();
  });
});

describe('threadDisplay (access → what a row shows)', () => {
  it('full access shows everything', () => {
    expect(threadDisplay({ access: 'full-access', subject: 'Pilot', snippet: ' Hello there ' })).toEqual({
      subject: 'Pilot',
      isPrivateSubject: false,
      snippet: 'Hello there',
      isRestricted: false,
    });
  });

  it('subject-line shows the subject but never a snippet', () => {
    expect(threadDisplay({ access: 'subject-line', subject: 'Secret pricing', snippet: 'leaked' })).toEqual({
      subject: 'Secret pricing',
      isPrivateSubject: false,
      snippet: null,
      isRestricted: true,
    });
  });

  it('metadata-only shows the "Private subject line" label', () => {
    const d = threadDisplay({ access: 'metadata-only', subject: null, snippet: null });
    expect(d.subject).toBe('Private subject line');
    expect(d.isPrivateSubject).toBe(true);
    expect(d.snippet).toBeNull();
    // Even if a server sent a subject below the level, it is not shown.
    expect(threadDisplay({ access: 'metadata-only', subject: 'x', snippet: 'y' }).subject).toBe('Private subject line');
  });

  it('an empty subject reads "(no subject)"', () => {
    expect(threadDisplay({ access: 'full-access', subject: '  ', snippet: null }).subject).toBe('(no subject)');
  });
});

describe('participants', () => {
  const list = [
    person('from', 'jane@x.com', 'Jane Cooper'),
    person('to', 'ada@y.com', 'Ada', ME),
    person('to', 'JANE@x.com', 'Jane again'),
    person('cc', 'wade@x.com', null),
    person('cc', 'cc3@x.com'),
    person('cc', 'cc4@x.com'),
    person('reply-to', 'noreply@x.com'),
  ];

  it('dedupes by address and skips reply-to', () => {
    expect(distinctParticipants(list).map((p) => p.emailAddress)).toEqual([
      'jane@x.com',
      'ada@y.com',
      'wade@x.com',
      'cc3@x.com',
      'cc4@x.com',
    ]);
  });

  it('summarises with "+N"', () => {
    expect(participantsSummary(list)).toEqual({ names: ['Jane Cooper', 'Ada', 'wade@x.com'], extra: 2 });
    expect(participantsSummary(list, 10).extra).toBe(0);
  });

  it('picks the sender', () => {
    expect(senderOf(list)?.emailAddress).toBe('jane@x.com');
    expect(senderOf([person('to', 'a@b.c')])?.emailAddress).toBe('a@b.c');
    expect(senderOf([])).toBeNull();
  });

  it('writes "to …" with "me" for the viewer', () => {
    expect(recipientsLabel([person('from', 'a@b.c'), person('to', 'ada@y.com', 'Ada', ME)], ME)).toBe('to me');
    expect(recipientsLabel(list, null)).toBe('to Ada, wade@x.com, cc3@x.com +1');
  });
});

describe('reply, reply all and forward', () => {
  const incoming = [
    person('from', 'jane@x.com', 'Jane Cooper'),
    person('to', 'ada@y.com', 'Ada', ME),
    person('to', 'wade@x.com', 'Wade'),
    person('cc', 'grace@y.com', 'Grace', 'member-grace'),
  ];

  it('prefixes subjects without stacking', () => {
    expect(replySubject('Pilot', 'reply')).toBe('Re: Pilot');
    expect(replySubject('Re: Pilot', 'reply-all')).toBe('Re: Pilot');
    expect(replySubject('RE: Pilot', 'reply')).toBe('Re: Pilot');
    expect(replySubject('Pilot', 'forward')).toBe('Fwd: Pilot');
    expect(replySubject('Fwd: Pilot', 'forward')).toBe('Fwd: Pilot');
    expect(replySubject(null, 'forward')).toBe('Fwd:');
  });

  it('replies to the sender', () => {
    const t = composeTarget(incoming, 'Pilot', 'reply', ME);
    expect(t.to.map((p) => p.emailAddress)).toEqual(['jane@x.com']);
    expect(t.cc).toEqual([]);
    expect(t.subject).toBe('Re: Pilot');
  });

  it('replies to the reply-to address when there is one', () => {
    const t = composeTarget([...incoming, person('reply-to', 'sales@x.com')], 'Pilot', 'reply', ME);
    expect(t.to.map((p) => p.emailAddress)).toEqual(['sales@x.com']);
  });

  it('replies to the recipients of a message the viewer sent', () => {
    const sent = [person('from', 'ada@y.com', 'Ada', ME), person('to', 'jane@x.com', 'Jane'), person('cc', 'w@x.com')];
    expect(composeTarget(sent, 'Hello', 'reply', ME).to.map((p) => p.emailAddress)).toEqual(['jane@x.com']);
  });

  it('reply all takes every other participant, never the viewer', () => {
    const t = composeTarget(incoming, 'Pilot', 'reply-all', ME);
    expect(t.to.map((p) => p.emailAddress)).toEqual(['jane@x.com', 'wade@x.com']);
    expect(t.cc.map((p) => p.emailAddress)).toEqual(['grace@y.com']);
  });

  it('forward starts empty', () => {
    expect(composeTarget(incoming, 'Pilot', 'forward', ME)).toEqual({ to: [], cc: [], subject: 'Fwd: Pilot' });
  });

  it('offers Reply all only with several other participants', () => {
    expect(canReplyAll(incoming, ME)).toBe(true);
    expect(canReplyAll([person('from', 'jane@x.com'), person('to', 'ada@y.com', 'Ada', ME)], ME)).toBe(false);
  });
});

describe('buildEmailSrcdoc', () => {
  const doc = buildEmailSrcdoc('<p onclick="x()">Hello</p><script>alert(1)</script>');

  it('wraps the original markup', () => {
    expect(doc).toContain('<p onclick="x()">Hello</p>');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
  });

  it('adds a restrictive CSP that allows no scripts, frames or connections', () => {
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(doc)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src|connect-src|frame-src/);
    expect(csp).toContain("style-src 'unsafe-inline'");
  });

  it('opens links in a new tab and has neutral base styles', () => {
    expect(doc).toContain('<base target="_blank">');
    expect(doc).toContain('color-scheme:light');
  });

  it('renders plain text escaped in a pre block', () => {
    expect(textToHtml('a < b & c')).toContain('a &lt; b &amp; c');
    expect(textToHtml('x')).toMatch(/^<pre /);
  });
});
