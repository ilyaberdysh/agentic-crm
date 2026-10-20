// Imports a mymeet call into a workspace through the public REST API (/v2).
// Request sequence:
//   1. POST /v2/meetings                              title, times, participants (emails → people / companies)
//   2. POST /v2/meetings/{meeting_id}/call_recordings  transcript segments (≤ 4,000; speaker name + email, seconds)
//   3. (optional) poll GET …/call_recordings/{id} until `completed` (speakers mapped, summaries written; the
//      `call-recording.created` webhook fires at that moment)
//
//   pnpm --filter @agentic-crm/api calls:import-sample -- --token <api token> [--url http://localhost:4100]
//     [--file fixture.json] [--organizer-email you@company.com] [--wait]
//
// The token needs `meeting:read-write` and `call_recording:read-write` (create one with `token:create <slug> mymeet
// meeting:read-write call_recording:read-write`). `--organizer-email` replaces the fixture organizer's address so the
// organizer maps to your workspace member (members render with their member name, X-28).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

/** mymeet's export of one call (the fixture format; fields named as in mymeet's API). */
export const mymeetCallSchema = z.object({
  meeting: z.object({
    title: z.string(),
    description: z.string().default(''),
    start: z.string(),
    end: z.string(),
    timezone: z.string().nullable().default(null),
    participants: z.array(z.object({ name: z.string(), email: z.string(), is_organizer: z.boolean().default(false) })),
  }),
  transcript: z.array(
    z.object({
      speaker: z.string(),
      email: z.string().optional(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
    }),
  ),
});
export type MymeetCall = z.infer<typeof mymeetCallSchema>;

export const SAMPLE_PATH = new URL('./fixtures/mymeet-sample.json', import.meta.url);

/** Segment limit for POST /v2/meetings/{id}/call_recordings. */
export const MAX_SEGMENTS = 4000;

export function loadSample(path: string | URL = SAMPLE_PATH): MymeetCall {
  return mymeetCallSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Merges consecutive segments of the same speaker until the transcript fits in `max` segments (word-level exports
 * can exceed 4,000 segments; utterance-level exports rarely need it).
 */
export function fitSegments(segments: MymeetCall['transcript'], max = MAX_SEGMENTS): MymeetCall['transcript'] {
  let out = segments;
  let gap = 0.5;
  while (out.length > max && gap < 3600) {
    const merged: MymeetCall['transcript'] = [];
    for (const s of out) {
      const last = merged.at(-1);
      if (last && last.speaker === s.speaker && last.email === s.email && s.start - last.end <= gap) {
        last.end = Math.max(last.end, s.end);
        last.text = `${last.text} ${s.text}`;
      } else merged.push({ ...s });
    }
    out = merged;
    gap *= 2;
  }
  return out;
}

/** The two /v2 request bodies for a mymeet call. */
export function toApiPayloads(call: MymeetCall, options: { organizerEmail?: string } = {}) {
  const organizer = call.meeting.participants.find((p) => p.is_organizer)?.email;
  const remap = (email: string | undefined) =>
    email && options.organizerEmail && organizer && email.toLowerCase() === organizer.toLowerCase()
      ? options.organizerEmail
      : email;
  const meeting = {
    data: {
      title: call.meeting.title,
      description: call.meeting.description,
      start: { datetime: call.meeting.start, timezone: call.meeting.timezone },
      end: { datetime: call.meeting.end, timezone: call.meeting.timezone },
      is_all_day: false,
      participants: call.meeting.participants.map((p) => ({
        email_address: remap(p.email),
        is_organizer: p.is_organizer,
        status: 'accepted' as const,
      })),
    },
  };
  const recording = {
    data: {
      transcript: fitSegments(call.transcript).map((s) => ({
        speech: s.text,
        start_time: s.start,
        end_time: s.end,
        speaker: { name: s.speaker, ...(s.email ? { email_address: remap(s.email) } : {}) },
      })),
    },
  };
  return { meeting, recording };
}

export interface ImportOptions {
  baseUrl: string;
  token: string;
  call?: MymeetCall;
  organizerEmail?: string;
  /** Poll until the recording is `completed` (default false). */
  wait?: boolean;
  waitTimeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ImportResult {
  meetingId: string;
  recordingId: string;
  status: 'processing' | 'completed' | 'failed';
  webUrl: string;
}

export async function importMymeetCall(options: ImportOptions): Promise<ImportResult> {
  const call = options.call ?? loadSample();
  const http = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const request = async (method: string, path: string, body?: unknown) => {
    const response = await http(`${base}/v2${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await response.json()) as Record<string, any>;
    if (!response.ok) throw new Error(`${method} /v2${path} → ${response.status}: ${JSON.stringify(json)}`);
    return json;
  };
  const payloads = toApiPayloads(call, options.organizerEmail ? { organizerEmail: options.organizerEmail } : {});
  const meeting = await request('POST', '/meetings', payloads.meeting);
  const meetingId = meeting.data.id.meeting_id as string;
  const created = await request('POST', `/meetings/${meetingId}/call_recordings`, payloads.recording);
  let status = created.data.status as ImportResult['status'];
  const recordingId = created.data.id.call_recording_id as string;
  if (options.wait) {
    const deadline = Date.now() + (options.waitTimeoutMs ?? 120_000);
    while (status === 'processing' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      status = (await request('GET', `/meetings/${meetingId}/call_recordings/${recordingId}`)).data.status;
    }
  }
  return { meetingId, recordingId, status, webUrl: created.data.web_url as string };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const token = arg(argv, 'token') ?? process.env.AGENTIC_CRM_API_TOKEN;
  if (!token) {
    console.error('usage: pnpm --filter @agentic-crm/api calls:import-sample -- --token <api token> [--url <api url>]');
    console.error('       [--file <mymeet call json>] [--organizer-email <your member email>] [--wait]');
    process.exitCode = 1;
    return;
  }
  try {
    const file = arg(argv, 'file');
    const organizerEmail = arg(argv, 'organizer-email');
    const result = await importMymeetCall({
      baseUrl: arg(argv, 'url') ?? 'http://localhost:4100',
      token,
      call: loadSample(file ?? SAMPLE_PATH),
      ...(organizerEmail ? { organizerEmail } : {}),
      wait: argv.includes('--wait'),
    });
    console.log(`Meeting ${result.meetingId}, call recording ${result.recordingId}: ${result.status}`);
    console.log(result.webUrl);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
