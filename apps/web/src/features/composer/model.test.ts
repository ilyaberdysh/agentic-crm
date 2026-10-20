import { type Block, textBlock } from '@agentic-crm/editor';
import { describe, expect, it } from 'vitest';
import {
  addRecipients,
  fileTypeTile,
  isDraftEmpty,
  massSendLabel,
  parseAddresses,
  previewSubject,
  primaryLabel,
  signatureStart,
  stripSignature,
  withSignature,
} from './model';

const p = (text: string): Block => textBlock('unstyled', text);
const sig = [p('Best,'), p('Ada')];

describe('signature in the body', () => {
  it('appends the signature after a blank paragraph and strips it again', () => {
    const body = withSignature([p('Hello')], null, sig);
    expect(body.map((b) => b.text)).toEqual(['Hello', '', 'Best,', 'Ada']);
    expect(signatureStart(body, sig)).toBe(2);
    expect(stripSignature(body, sig).map((b) => b.text)).toEqual(['Hello']);
  });

  it('replaces the previous signature', () => {
    const first = withSignature([p('Hi')], null, sig);
    const other = [p('Cheers')];
    expect(withSignature(first, sig, other).map((b) => b.text)).toEqual(['Hi', '', 'Cheers']);
    expect(withSignature(first, sig, null).map((b) => b.text)).toEqual(['Hi']);
  });

  it('keeps a paragraph for the caret above a signature in an empty body', () => {
    expect(withSignature([p('')], null, sig).map((b) => b.text)).toEqual(['', '', 'Best,', 'Ada']);
  });
});

describe('isDraftEmpty', () => {
  const empty = { subject: { text: '' }, body: [p('')], to: [], cc: [], bcc: [], attachments: [] };
  it('is empty without subject, text, recipients or attachments', () => {
    expect(isDraftEmpty(empty)).toBe(true);
    expect(isDraftEmpty({ ...empty, subject: { text: ' ' } })).toBe(true);
  });
  it('ignores the signature', () => {
    const body = withSignature([p('')], null, sig);
    expect(isDraftEmpty({ ...empty, body }, sig)).toBe(true);
    expect(isDraftEmpty({ ...empty, body })).toBe(false);
  });
  it('is not empty with any content', () => {
    expect(isDraftEmpty({ ...empty, subject: { text: 'x' } })).toBe(false);
    expect(isDraftEmpty({ ...empty, body: [p('x')] })).toBe(false);
    expect(isDraftEmpty({ ...empty, to: [{}] })).toBe(false);
    expect(isDraftEmpty({ ...empty, bcc: [{}] })).toBe(false);
    expect(isDraftEmpty({ ...empty, attachments: [{}] })).toBe(false);
  });
});

describe('recipients', () => {
  it('parses addresses separated by commas, spaces and Name <a@b.c>', () => {
    const out = parseAddresses('a@x.com, B@Y.org; Jane Cooper <jane@z.io> nope');
    expect(out.valid.map((r) => [r.emailAddress, r.name])).toEqual([
      ['jane@z.io', 'Jane Cooper'],
      ['a@x.com', null],
      ['b@y.org', null],
    ]);
    expect(out.invalid).toEqual(['nope']);
  });
  it('adds without duplicates', () => {
    const list = [{ emailAddress: 'a@x.com' }];
    expect(addRecipients(list, [{ emailAddress: 'A@x.com' }, { emailAddress: 'b@x.com' }])).toHaveLength(2);
  });
});

describe('copy', () => {
  it('names the mass-send row and the primary button', () => {
    expect(massSendLabel(1)).toBe('Sending email to 1 recipient');
    expect(massSendLabel(3)).toBe('Sending individual emails to 3 recipients');
    expect(primaryLabel({ hasVariables: false, isMassSend: false, recipients: 1 })).toBe('Send email');
    expect(primaryLabel({ hasVariables: true, isMassSend: false, recipients: 1 })).toBe('Review');
    expect(primaryLabel({ hasVariables: false, isMassSend: true, recipients: 1 })).toBe('Review Email (1)');
    expect(primaryLabel({ hasVariables: false, isMassSend: true, recipients: 2 })).toBe('Review Emails (2)');
  });
  it('shows the extension on the attachment tile', () => {
    expect(fileTypeTile('seed-attachment.txt')).toBe('TXT');
    expect(fileTypeTile('archive.tar.gz')).toBe('GZ');
    expect(fileTypeTile('README')).toBe('FILE');
  });
});

describe('previews', () => {
  it('shows variables of a subject as {{tokens}}', () => {
    const variables = [
      { start: 24, path: [{ attributeDefinitionId: 'name' }], field: 'first_name', label: 'Name › First' },
    ];
    expect(previewSubject('[seed] Test subject for _', variables)).toBe('[seed] Test subject for {{first_name}}');
    expect(previewSubject('Plain', [])).toBe('Plain');
    const labelOnly = [{ start: 0, path: [{ attributeDefinitionId: 'job-title' }], label: 'Job title' }];
    expect(previewSubject('_', labelOnly)).toBe('{{job_title}}');
  });
});
