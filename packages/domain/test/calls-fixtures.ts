// Shared fixtures of the slice-10 calls tests: domains with the deterministic fake LLM (inline processing, and a
// job-queue variant that only records jobs), a workspace with a meeting (member organizer, an external person whose
// company is auto-created, an explicitly linked company) and a transcript in the shape mymeet imports.
import { createDomain, fakeCallsLlm, RecordingJobQueue } from '../src/index.ts';
import { createRecord } from './collab-fixtures.ts';
import { type EmailFixture, emailFixture, iso, recordsByValue } from './email-fixtures.ts';
import { database, newId, storage } from './support/harness.ts';

export const llm = fakeCallsLlm();
/** No job queue: processing and generation run inline after the write (as in tests and single-process setups). */
export const calls = createDomain({ database, storage, llm });
export const jobs = new RecordingJobQueue();
/** With a job queue: writes only enqueue; tests run `calls.process` / `calls.generate` like the worker. */
export const queued = createDomain({ database, storage, llm, jobs });

export interface CallFixture extends EmailFixture {
  meetingId: string;
  jane: string;
  janePersonId: string;
  northwind: string;
  initech: string;
  adaEmail: string;
}

export async function callFixture(title = 'Discovery call — Northwind'): Promise<CallFixture> {
  const f = await emailFixture({ recordCreation: 'all' });
  const initech = await createRecord(f, 'companies', { name: [{ value: `Initech ${f.tag}` }] });
  const jane = `jane.cooper@northwind-${f.tag}.com`;
  const meetingId = newId();
  await calls.meetings.create(f.ctx, {
    id: meetingId,
    title,
    start: { datetime: iso(-3) },
    end: { datetime: iso(-2.5) },
    participants: [
      { memberId: f.memberId, isOrganizer: true },
      { emailAddress: jane, name: 'Jane Cooper' },
    ],
    linkedRecords: [{ entityDefinitionId: 'companies', entityInstanceId: initech }],
  });
  const [janePersonId] = await recordsByValue(f, 'people', jane);
  const [northwind] = await recordsByValue(f, 'companies', `northwind-${f.tag}.com`);
  return {
    ...f,
    meetingId,
    jane,
    janePersonId: janePersonId as string,
    northwind: northwind as string,
    initech,
    adaEmail: f.user.emailAddress,
  };
}

/**
 * A mymeet-shaped transcript: Ada (member) and Jane (external person) by email, Wade without an address.
 * Jane's first two segments are 0.84 s apart (one paragraph), her third follows a 3 s pause (new paragraph, same
 * block); Ada's last segment follows 25 s of silence (new block although the same speaker).
 */
export function transcript(f: CallFixture) {
  const ada = { name: 'ada', emailAddress: f.adaEmail };
  const jane = { name: 'Jane C.', emailAddress: f.jane.toUpperCase() };
  return [
    { speech: 'Hi Jane, thanks for joining.', startTime: 0, endTime: 3, speaker: ada },
    { speech: 'Happy to be here.', startTime: 3.5, endTime: 5, speaker: jane },
    { speech: 'We spend hours writing meeting notes by hand.', startTime: 5.84, endTime: 9, speaker: jane },
    { speech: 'Our budget for this is approved for Q4.', startTime: 12, endTime: 15, speaker: jane },
    { speech: 'Great, let us plan a two-week pilot.', startTime: 16, endTime: 20, speaker: ada },
    { speech: 'I will send the proposal tomorrow.', startTime: 45, endTime: 48, speaker: ada },
    { speech: 'Sounds good to me.', startTime: 49, endTime: 50, speaker: { name: 'Wade' } },
  ];
}
