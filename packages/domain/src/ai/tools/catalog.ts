// The Ask Agentic tools (ask-agentic-internals §4.1, our own subset): search and read records, attributes, lists, tasks,
// notes, members, meetings, call recordings and emails; create / update records, tasks and notes (approval); web
// search (permission). Identifiers match contracts AI_TOOL_LABELS. Tools never bypass the domain services: reads use
// the services' own visibility rules (email / meeting access, list access, object grants) as the asking member.

import { type Predicate, type Sort, WORKFLOW_LIMITS } from '@agentic-crm/contracts';
import { jsonb, sql } from '@agentic-crm/db';
import { z } from 'zod';
import { callNotFound, loadCall } from '../../calls/common.ts';
import { loadTranscript } from '../../calls/read.ts';
import { noteOps } from '../../collab/notes.ts';
import { taskOps } from '../../collab/tasks.ts';
import { threadOps } from '../../email/threads.ts';
import { DomainError } from '../../errors.ts';
import { newId } from '../../ids.ts';
import { listOps } from '../../lists/service.ts';
import { meetingOps } from '../../meetings/service.ts';
import { recordOps } from '../../records/service.ts';
import { type AttrDef, type DefInfo, loadDefinition } from '../../schema/model.ts';
import { searchOps } from '../../search/service.ts';
import type { Tx } from '../../tx.ts';
import { compileQuery } from '../../views/compiler.ts';
import { resolvePredicate } from '../../views/resolve.ts';
import { StepError, toWriteForm } from '../../workflows/runtime.ts';
import type { LlmTool } from '../llm.ts';
import { documentText, memberNames, recordLink, renderRecords, visibleAttributes } from '../render.ts';
import { type AiToolDef, defineTool, type ToolEnv, ToolError } from './registry.ts';

const uuid = z.string().uuid();
const recordRef = z.object({
  entity_definition_id: uuid.describe('Object or list id'),
  entity_instance_id: uuid.describe('Record or entry id'),
});
const ref = (r: z.infer<typeof recordRef>) => ({
  entityDefinitionId: r.entity_definition_id,
  entityInstanceId: r.entity_instance_id,
});
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…[truncated]` : text);

/** An object or list the member may read (by id, api slug, or singular / plural noun). */
async function readableDef(env: ToolEnv, objectRef: string): Promise<DefInfo> {
  let def: DefInfo | null = null;
  try {
    def = await loadDefinition(env.tx, objectRef);
  } catch {
    const lower = objectRef.trim().toLowerCase();
    const row = await env.tx.db
      .selectFrom('entity_definitions')
      .select('id')
      .where((eb) =>
        eb.or([
          eb(eb.fn('lower', ['singular_noun']), '=', lower),
          eb(eb.fn('lower', ['plural_noun']), '=', lower),
          eb(eb.fn('lower', ['api_slug']), '=', lower),
        ]),
      )
      .executeTakeFirst();
    if (row) def = await loadDefinition(env.tx, row.id);
  }
  if (!def || def.isArchived) throw new ToolError(`Unknown object or list "${objectRef}"`);
  const [allowed] = await env.policies.allowed(env.tx, [def], 'read_entity_instance');
  if (!allowed) throw new ToolError(`You do not have access to the records of "${def.pluralNoun}"`);
  return def;
}

function attributeOf(def: DefInfo, key: string): AttrDef {
  const lower = key.trim().toLowerCase();
  const attr =
    def.byId.get(key) ??
    def.bySlug.get(key) ??
    def.attrs.find((a) => a.title.toLowerCase() === lower || a.apiSlug.toLowerCase() === lower);
  if (!attr || attr.isArchived) throw new ToolError(`"${def.pluralNoun}" has no attribute "${key}"`);
  return attr;
}

async function writeForm(tx: Tx, attr: AttrDef, value: unknown): Promise<unknown> {
  try {
    return await toWriteForm(tx, attr, value);
  } catch (err) {
    if (err instanceof StepError) throw new ToolError(err.message);
    throw err;
  }
}

/** Model values map (attribute → value or values) → the write form of recordOps. */
async function valuesOf(tx: Tx, def: DefInfo, values: Record<string, unknown>) {
  const out: Record<string, { value: unknown }[]> = {};
  for (const [key, raw] of Object.entries(values)) {
    const attr = attributeOf(def, key);
    if (attr.isReadOnly) throw new ToolError(`"${attr.title}" is read-only`);
    const items = raw === null ? [] : Array.isArray(raw) && attr.isMultiselect ? raw : [raw];
    out[attr.id] = [];
    for (const item of items) out[attr.id]?.push({ value: await writeForm(tx, attr, item) });
  }
  return out;
}

const filterOperator = z.enum(['eq', 'contains', 'starts-with', 'gt', 'gte', 'lt', 'lte', 'empty', 'not-empty']);

async function constraintValue(tx: Tx, attr: AttrDef, value: unknown): Promise<unknown> {
  if (value === undefined || value === null) return null;
  switch (attr.type) {
    case 'select':
    case 'pipeline': {
      const form = (await writeForm(tx, attr, value)) as { selectOptionId?: string; pipelineStageId?: string };
      return form.selectOptionId ?? form.pipelineStageId;
    }
    case 'entity-reference':
      return typeof value === 'object' ? (value as { entity_instance_id?: string }).entity_instance_id : value;
    default:
      return value;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Records

const searchRecords = defineTool({
  name: 'search-records',
  kind: 'read',
  description:
    'Full-text search for records (people, companies, deals and other objects) by name, email, domain or phone. ' +
    'Call this first whenever the user names a record you do not have an id for.',
  input: z.object({
    query: z.string().max(256).describe('Name, email address, domain or phone number'),
    objects: z.array(z.string()).max(10).optional().describe('Object api slugs or ids to restrict the search'),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  async execute(env, input) {
    const result = await searchOps.records(
      env.tx,
      {
        query: input.query,
        limit: input.limit ?? 10,
        ...(input.objects?.length ? { entityDefinitionIds: input.objects } : {}),
      },
      (defs) => env.policies.allowed(env.tx, defs, 'read_entity_instance'),
    );
    const defs = new Map<string, DefInfo>();
    for (const hit of result.hits) {
      if (!defs.has(hit.entityDefinitionId))
        defs.set(hit.entityDefinitionId, await loadDefinition(env.tx, hit.entityDefinitionId));
    }
    const records = result.hits.map((h) => {
      const def = defs.get(h.entityDefinitionId) as DefInfo;
      return {
        object: def.apiSlug,
        entity_definition_id: h.entityDefinitionId,
        entity_instance_id: h.entityInstanceId,
        name: h.title,
        detail: h.subtitle,
        link: recordLink(h.entityDefinitionId, h.entityInstanceId, h.title ?? def.singularNoun),
      };
    });
    return {
      output: { records },
      digest: {
        count: records.length,
        records: records.map((r) => ({
          entityDefinitionId: r.entity_definition_id,
          entityInstanceId: r.entity_instance_id,
        })),
      },
    };
  },
});

const listRecords = defineTool({
  name: 'list-records',
  kind: 'read',
  description:
    'Query the records of an object, or the entries of a list, with optional attribute filters and a sort. Use ' +
    'list-attributes first to learn attribute names and option titles. Returns names and attribute values.',
  input: z.object({
    object: z.string().describe('Object or list: api slug, id or name'),
    filters: z
      .array(
        z.object({
          attribute: z.string().describe('Attribute api slug, id or title'),
          operator: filterOperator,
          value: z
            .unknown()
            .optional()
            .describe('Text, number, ISO date, option / status title, record id, or member id'),
        }),
      )
      .max(10)
      .optional()
      .describe('All filters must match'),
    sort: z.object({ attribute: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  async execute(env, input) {
    const def = await readableDef(env, input.object);
    if (!def.projectionTable) return { output: { total: 0, records: [] }, digest: { count: 0 } };
    const leaves: Predicate[] = [];
    for (const f of input.filters ?? []) {
      const attr = attributeOf(def, f.attribute);
      const value = await constraintValue(env.tx, attr, f.value);
      leaves.push({
        path: [{ entityDefinitionId: def.id, attributeDefinitionId: attr.id }],
        mode: 'must',
        constraints: [
          { field: 'value', operator: f.operator, ...(value !== null ? { value } : {}), valueType: 'static' },
        ],
      } as Predicate);
    }
    const sorts: Sort[] = input.sort
      ? [
          {
            path: [{ entityDefinitionId: def.id, attributeDefinitionId: attributeOf(def, input.sort.attribute).id }],
            direction: input.sort.direction,
          },
        ]
      : [];
    let ids: string[];
    let total: number;
    try {
      const predicate = await resolvePredicate(env.tx, def, leaves.length ? { and: leaves } : null, {
        now: env.tx.now,
        timeZone: env.timeZone,
        memberId: env.memberId,
      });
      const query = await compileQuery(env.tx, def, predicate, sorts);
      const limit = Math.min(input.limit ?? 20, WORKFLOW_LIMITS.findMaxLimit);
      const { rows } = await sql<{ id: string; total: string }>`
        SELECT q.id, count(*) OVER () AS total FROM (${sql.raw(query)}) q
        LIMIT ${limit} OFFSET ${input.offset ?? 0}`.execute(env.tx.db);
      ids = rows.map((r) => r.id);
      total = Number(rows[0]?.total ?? 0);
    } catch (err) {
      if (err instanceof DomainError && err.statusCode < 500) throw new ToolError(err.message);
      throw err;
    }
    const records = await renderRecords(env.tx, def, ids, { withValues: true });
    return {
      output: { object: def.apiSlug, total, records },
      digest: {
        count: total,
        records: records.map((r) => ({ entityDefinitionId: def.id, entityInstanceId: r.entity_instance_id })),
      },
    };
  },
});

const getRecords = defineTool({
  name: 'get-records',
  kind: 'read',
  description: 'Read records by id with all their attribute values.',
  input: z.object({
    object: z.string().describe('Object or list: api slug or id'),
    record_ids: z.array(uuid).min(1).max(20),
  }),
  async execute(env, input) {
    const def = await readableDef(env, input.object);
    const records = await renderRecords(env.tx, def, input.record_ids, { withValues: true });
    return {
      output: { records },
      digest: {
        count: records.length,
        records: records.map((r) => ({ entityDefinitionId: def.id, entityInstanceId: r.entity_instance_id })),
      },
    };
  },
});

const listAttributes = defineTool({
  name: 'list-attributes',
  kind: 'read',
  description: "List an object's or list's attributes (titles, api slugs, types, select and status options).",
  input: z.object({ object: z.string().describe('Object or list: api slug, id or name') }),
  async execute(env, input) {
    const def = await readableDef(env, input.object);
    const attrs = visibleAttributes(def);
    const optionRows = await env.tx.db
      .selectFrom('select_options')
      .select(['attribute_id', 'title'])
      .where(
        'attribute_id',
        'in',
        attrs
          .filter((a) => a.type === 'select' || a.type === 'pipeline')
          .map((a) => a.id)
          .concat(['00000000-0000-0000-0000-000000000000']),
      )
      .where('is_archived', '=', false)
      .orderBy('sort_order')
      .execute();
    const options = new Map<string, string[]>();
    for (const o of optionRows) options.set(o.attribute_id, [...(options.get(o.attribute_id) ?? []), o.title]);
    return {
      output: {
        object: def.apiSlug,
        entity_definition_id: def.id,
        attributes: attrs.map((a) => ({
          title: a.title,
          api_slug: a.apiSlug,
          type: a.type,
          multiselect: a.isMultiselect,
          read_only: a.isReadOnly,
          ...(options.has(a.id) ? { options: options.get(a.id) } : {}),
        })),
      },
      digest: { count: attrs.length },
    };
  },
});

const listLists = defineTool({
  name: 'list-lists',
  kind: 'read',
  description: 'List the workspace lists the user can open (pipelines, campaigns, …) with their parent objects.',
  input: z.object({ query: z.string().max(200).optional() }),
  async execute(env, input) {
    const lists = await listOps(env.policies).list(env.tx, { scope: 'readable' });
    const q = input.query?.trim().toLowerCase();
    const found = lists.filter((l) => !q || l.name.toLowerCase().includes(q));
    return {
      output: {
        lists: found.map((l) => ({
          id: l.id,
          name: l.name,
          api_slug: l.apiSlug,
          parent_objects: l.parentEntityDefinitionIds,
        })),
      },
      digest: { count: found.length, listIds: found.map((l) => l.id) },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Tasks, notes, members

const listTasks = defineTool({
  name: 'list-tasks',
  kind: 'read',
  description: 'Find tasks, optionally linked to a record, assigned to a member, or by completion.',
  input: z.object({
    linked_record: recordRef.optional(),
    assignee_member_id: uuid.optional(),
    is_completed: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async execute(env, input) {
    const result = await taskOps.list(
      env.tx,
      { policies: env.policies },
      {
        timeZone: env.timeZone,
        groupBy: 'none',
        filter: {
          ...(input.linked_record ? { records: { operator: 'is', records: [ref(input.linked_record)] } } : {}),
          ...(input.assignee_member_id ? { assignees: { operator: 'is', memberIds: [input.assignee_member_id] } } : {}),
          ...(input.is_completed !== undefined ? { isCompleted: input.is_completed } : {}),
        },
        limit: input.limit ?? 20,
      },
    );
    const tasks = result.groups.flatMap((g) => g.tasks).slice(0, input.limit ?? 20);
    const names = await memberNames(
      env.tx,
      tasks.flatMap((t) => t.assigneeMemberIds),
    );
    return {
      output: {
        total: result.total,
        tasks: tasks.map((t) => ({
          task_id: t.id,
          body: t.content.text,
          due: t.deadlineAt,
          is_completed: t.isCompleted,
          assignees: t.assigneeMemberIds.map((id) => names.get(id) ?? id),
          linked_records: t.linkedRecords.map((r) => ({
            entity_definition_id: r.entityDefinitionId,
            entity_instance_id: r.entityInstanceId,
          })),
        })),
      },
      digest: { count: result.total, taskIds: tasks.map((t) => t.id) },
    };
  },
});

const listNotes = defineTool({
  name: 'list-notes',
  kind: 'read',
  description: 'Find notes (newest first), optionally of one record; returns titles and the first lines.',
  input: z.object({
    record: recordRef.optional(),
    created_after: z.string().optional().describe('ISO timestamp'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute(env, input) {
    const result = await noteOps.list(
      env.tx,
      { policies: env.policies },
      {
        ...(input.record ? { record: ref(input.record) } : {}),
        ...(input.created_after ? { createdFrom: new Date(input.created_after).toISOString() } : {}),
        limit: input.limit ?? 10,
        includeContent: true,
      },
    );
    return {
      output: {
        total: result.total,
        notes: result.notes.map((n) => ({
          note_id: n.id,
          title: n.title,
          created_at: n.createdAt,
          parent_records: n.parentRecords.map((r) => ({
            entity_definition_id: r.entityDefinitionId,
            entity_instance_id: r.entityInstanceId,
          })),
          excerpt: clip(documentText(n.content), 500),
        })),
      },
      digest: { count: result.total, noteIds: result.notes.map((n) => n.id) },
    };
  },
});

const getNotes = defineTool({
  name: 'get-notes',
  kind: 'read',
  description: 'Read the full content of notes by id.',
  input: z.object({ note_ids: z.array(uuid).min(1).max(10) }),
  async execute(env, input) {
    const result = await noteOps.batchGet(env.tx, { policies: env.policies }, { noteIds: input.note_ids });
    return {
      output: {
        notes: result.notes.map((n) => ({
          note_id: n.id,
          title: n.title,
          content: clip(documentText(n.content), 8000),
        })),
      },
      digest: { count: result.notes.length, noteIds: result.notes.map((n) => n.id) },
    };
  },
});

const listMembers = defineTool({
  name: 'list-workspace-members',
  kind: 'read',
  description: 'Find workspace members (for assignees and owners) by name or email.',
  input: z.object({ query: z.string().max(200).optional() }),
  async execute(env, input) {
    const { hits } = await searchOps.members(env.tx, { query: input.query ?? '', limit: 25 });
    return {
      output: {
        members: hits.map((m) => ({
          member_id: m.id,
          name: `${m.firstName} ${m.lastName}`.trim(),
          email: m.emailAddress,
          is_you: m.id === env.memberId,
        })),
      },
      digest: { count: hits.length, memberIds: hits.map((m) => m.id) },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Meetings, call recordings, emails

const meetingDeps = (env: ToolEnv) => ({ policies: env.policies, scheduleStrength: async () => {} });

const searchMeetings = defineTool({
  name: 'search-meetings',
  kind: 'read',
  description: 'Find meetings of a record or in a time range (calendar and imported calls).',
  input: z.object({
    record: recordRef.optional(),
    from: z.string().optional().describe('ISO timestamp: meetings ending after'),
    to: z.string().optional().describe('ISO timestamp: meetings starting before'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute(env, input) {
    const result = await meetingOps.list(env.tx, meetingDeps(env), {
      ...(input.record ? { record: ref(input.record) } : {}),
      ...(input.from ? { from: new Date(input.from).toISOString() } : {}),
      ...(input.to ? { to: new Date(input.to).toISOString() } : {}),
      sort: 'start_desc',
      limit: input.limit ?? 20,
    });
    return {
      output: {
        meetings: result.meetings.map((m) => ({
          meeting_id: m.id,
          title: m.title,
          start: m.start.at,
          end: m.end.at,
          participants: m.participants.map((p) => p.name ?? p.emailAddress).filter(Boolean),
          call_recording_ids: m.callRecordingIds,
        })),
      },
      digest: { count: result.meetings.length, meetingIds: result.meetings.map((m) => m.id) },
    };
  },
});

const getMeeting = defineTool({
  name: 'get-meeting',
  kind: 'read',
  description: 'Read one meeting: description, participants, linked records and call recordings.',
  input: z.object({ meeting_id: uuid }),
  async execute(env, input) {
    const m = await meetingOps.get(env.tx, input.meeting_id);
    return {
      output: {
        meeting_id: m.id,
        title: m.title,
        description: m.description,
        start: m.start.at,
        end: m.end.at,
        participants: m.participants.map((p) => ({ name: p.name, email: p.emailAddress, status: p.status })),
        linked_records: m.linkedRecords.map((r) => ({
          entity_definition_id: r.entityDefinitionId,
          entity_instance_id: r.entityInstanceId,
        })),
        call_recording_ids: m.callRecordingIds,
      },
      digest: { meetingId: m.id },
    };
  },
});

const fmt = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const getCallRecording = defineTool({
  name: 'get-call-recording',
  kind: 'read',
  description:
    'Read a call recording transcript (speaker, m:ss timestamps). Optionally only a time range in seconds. Use ' +
    'the timestamps for agentic-crm:call-recording-snippets blocks.',
  input: z.object({
    meeting_id: uuid,
    call_recording_id: uuid,
    start_time: z.number().min(0).optional(),
    end_time: z.number().min(0).optional(),
  }),
  async execute(env, input) {
    // The meeting's visibility rules apply (404 below full access). Speakers carry their display names (members by
    // member name, people by record name — calls/speakers.ts, X-28).
    const meeting = await meetingOps.get(env.tx, input.meeting_id);
    const { row: recording } = await loadCall(env.tx, input.call_recording_id);
    if (recording.meeting_id !== meeting.id) throw callNotFound(input.call_recording_id);
    const transcript = await loadTranscript(env.tx, recording.id);
    const segments = transcript.utterances.filter(
      (u) =>
        (input.start_time === undefined || u.end >= input.start_time) &&
        (input.end_time === undefined || u.start <= input.end_time),
    );
    const lines = segments.map((u) => `[${fmt(u.start)}] ${transcript.nameOf(u.speakerId)}: ${u.text}`);
    return {
      output: {
        meeting_id: meeting.id,
        call_recording_id: recording.id,
        title: meeting.title,
        status: recording.status,
        summary: recording.summary,
        speakers: transcript.speakers.map((sp) => sp.name),
        transcript: clip(lines.join('\n'), 60_000),
      },
      digest: { meetingId: meeting.id, callRecordingId: recording.id, segments: segments.length },
    };
  },
});

const searchEmails = defineTool({
  name: 'search-emails',
  kind: 'read',
  description: 'Find email threads with a record (newest first); returns subjects, participants and snippets.',
  input: z.object({
    record: recordRef,
    sent_after: z.string().optional().describe('ISO timestamp'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  async execute(env, input) {
    const result = await threadOps.listForRecord(
      env.tx,
      { policies: env.policies },
      {
        record: ref(input.record),
        limit: input.limit ?? 20,
        ...(input.sent_after ? { sentAfter: new Date(input.sent_after).toISOString() } : {}),
      },
    );
    return {
      output: {
        threads: result.threads.map((t) => ({
          thread_id: t.threadId,
          subject: t.subject,
          snippet: t.snippet,
          last_message_at: t.lastMessageAt,
          messages: t.messageCount,
          participants: t.participants.map((p) => p.name ?? p.emailAddress).filter(Boolean),
          access: t.access,
        })),
      },
      digest: { count: result.threads.length, threadIds: result.threads.map((t) => t.threadId) },
    };
  },
});

const getEmails = defineTool({
  name: 'get-emails',
  kind: 'read',
  description: 'Read the messages of an email thread (bodies only where the user has full access).',
  input: z.object({ thread_id: uuid }),
  async execute(env, input) {
    const thread = await threadOps.thread(env.tx, { threadId: input.thread_id });
    return {
      output: {
        thread_id: input.thread_id,
        messages: thread.messages.map((m) => ({
          sent_at: m.sentAt,
          subject: m.subject,
          from_to: m.participants.map((p) => `${p.role}: ${p.name ?? p.emailAddress}`),
          body: m.bodyText ? clip(m.bodyText, 6000) : m.snippet,
          access: m.access,
        })),
      },
      digest: { threadId: input.thread_id, count: thread.messages.length },
    };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Web search (permission per thread / member): a nested model call with the Anthropic web search server tool.

const WEB_SEARCH_TOOL: LlmTool = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };

const searchWeb = defineTool({
  name: 'search-web',
  kind: 'web',
  description:
    'Search the public web for information not in the CRM (company websites, news, people). Queries are shared ' +
    'with an external search provider, so the user is asked for permission.',
  input: z.object({
    objective: z.string().min(1).max(1000).describe('What you need to find out'),
    search_queries: z.array(z.string().max(300)).min(1).max(5),
  }),
  async execute(env, input) {
    let messages: Parameters<typeof env.llm.complete>[0]['messages'] = [
      {
        role: 'user',
        content: `Objective: ${input.objective}\nSuggested queries:\n${input.search_queries.map((q) => `- ${q}`).join('\n')}`,
      },
    ];
    const results: { url: string; title: string | null }[] = [];
    let text = '';
    for (let i = 0; i < 3; i++) {
      const res = await env.llm.complete({
        purpose: 'web-search',
        system:
          'You research the public web for a CRM assistant. Search, then answer the objective concisely with the ' +
          'facts found and their source URLs. Say plainly when nothing relevant was found.',
        messages,
        tools: [WEB_SEARCH_TOOL],
        maxTokens: 16_000,
      });
      env.addUsage(res.usage);
      text += res.text;
      for (const block of res.message.content) {
        if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
          for (const r of block.content) {
            if (r.type === 'web_search_result') results.push({ url: r.url, title: r.title ?? null });
          }
        }
      }
      if (res.stopReason !== 'pause_turn') break;
      messages = [...messages, { role: 'assistant', content: res.message.content }];
    }
    const unique = [...new Map(results.map((r) => [r.url, r])).values()].slice(0, 10);
    return { output: { findings: text, sources: unique }, digest: { results: unique } };
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Write tools (approval card; the approved — possibly edited — input runs)

const valuesInput = z
  .record(z.string(), z.unknown())
  .describe(
    'Attribute (api slug, id or title) → value: text, number, ISO date, option / status title, ' +
      '{entity_definition_id, entity_instance_id} for record references, member id for actors; arrays for ' +
      'multi-value attributes; null clears',
  );

function recordRefValues(values: Record<string, unknown>): Record<string, unknown> {
  // Record references arrive in snake_case; the write form wants camelCase.
  const convert = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(convert);
    if (v && typeof v === 'object' && 'entity_instance_id' in v) {
      const r = v as { entity_definition_id: string; entity_instance_id: string };
      return { entityDefinitionId: r.entity_definition_id, entityInstanceId: r.entity_instance_id };
    }
    return v;
  };
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, convert(v)]));
}

const createRecord = defineTool({
  name: 'create-record',
  kind: 'write',
  description: 'Create a record of an object. The user reviews and approves the values before it is created.',
  input: z.object({ object: z.string(), values: valuesInput }),
  async execute(env, input) {
    const def = await readableDef(env, input.object);
    await env.policies.assertCan(env.tx, def.id, 'create_entity_instance');
    const id = newId();
    await recordOps.create(env.tx, {
      entityDefinitionId: def.id,
      entityInstanceId: id,
      values: await valuesOf(env.tx, def, recordRefValues(input.values)),
    });
    const [record] = await renderRecords(env.tx, def, [id]);
    return {
      output: { created: record },
      digest: { entityDefinitionId: def.id, entityInstanceId: id },
    };
  },
});

const updateRecord = defineTool({
  name: 'update-record',
  kind: 'write',
  description: "Update a record's attribute values. The user reviews and approves the changes first.",
  input: z.object({ object: z.string(), record_id: uuid, values: valuesInput }),
  async execute(env, input) {
    const def = await readableDef(env, input.object);
    await env.policies.assertCan(env.tx, def.id, 'update_entity_instance');
    await recordOps.update(env.tx, {
      entityDefinitionId: def.id,
      entityInstanceId: input.record_id,
      values: await valuesOf(env.tx, def, recordRefValues(input.values)),
    });
    const [record] = await renderRecords(env.tx, def, [input.record_id], { withValues: true });
    return { output: { updated: record }, digest: { entityDefinitionId: def.id, entityInstanceId: input.record_id } };
  },
});

function deadlineOf(due: string | null | undefined, timeZone: string) {
  if (due === undefined) return undefined;
  if (due === null || due === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return { kind: 'date' as const, date: due, timeZone };
  const t = Date.parse(due);
  if (Number.isNaN(t)) throw new ToolError(`"${due}" is not a date`);
  return { kind: 'datetime' as const, at: new Date(t).toISOString() };
}

const createTask = defineTool({
  name: 'create-task',
  kind: 'write',
  description:
    'Create a task (body, optional due date, assignees, linked records). The user can edit it in an approval ' +
    'card before it is created.',
  input: z.object({
    body: z.string().min(1).max(2000),
    due_date: z.string().nullable().optional().describe('YYYY-MM-DD or ISO timestamp'),
    assignee_member_ids: z.array(uuid).max(20).optional(),
    linked_records: z.array(recordRef).max(20).optional(),
  }),
  async execute(env, input) {
    const id = newId();
    const task = await taskOps.create(
      env.tx,
      { policies: env.policies },
      {
        id,
        content: { text: input.body.trim(), mentions: [] },
        deadline: deadlineOf(input.due_date, env.timeZone) ?? null,
        assigneeMemberIds: input.assignee_member_ids ?? [],
        linkedRecords: (input.linked_records ?? []).map(ref),
      },
    );
    return {
      output: { task_id: task.id, embed: `agentic-crm:task-embed {"task_id":"${task.id}"}` },
      digest: { taskId: task.id },
    };
  },
});

const updateTask = defineTool({
  name: 'update-task',
  kind: 'write',
  description: 'Update a task (body, due date, completion, assignees, linked records) after the user approves.',
  input: z.object({
    task_id: uuid,
    body: z.string().min(1).max(2000).optional(),
    due_date: z.string().nullable().optional(),
    is_completed: z.boolean().optional(),
    assignee_member_ids: z.array(uuid).max(20).optional(),
    linked_records: z.array(recordRef).max(20).optional(),
  }),
  async execute(env, input) {
    const deadline = deadlineOf(input.due_date, env.timeZone);
    const task = await taskOps.update(
      env.tx,
      { policies: env.policies },
      {
        taskId: input.task_id,
        ...(input.body !== undefined ? { content: { text: input.body.trim(), mentions: [] } } : {}),
        ...(deadline !== undefined ? { deadline } : {}),
        ...(input.is_completed !== undefined ? { isCompleted: input.is_completed } : {}),
        ...(input.assignee_member_ids ? { assigneeMemberIds: input.assignee_member_ids } : {}),
        ...(input.linked_records ? { linkedRecords: input.linked_records.map(ref) } : {}),
      },
    );
    return { output: { task_id: task.id }, digest: { taskId: task.id } };
  },
});

const createNote = defineTool({
  name: 'create-note',
  kind: 'write',
  description: 'Create a note on a record (Markdown content) after the user approves.',
  input: z.object({
    parent_record: recordRef,
    title: z.string().max(1000),
    content: z.string().max(50_000).describe('Markdown'),
    meeting_id: uuid.nullable().optional(),
  }),
  async execute(env, input) {
    const note = await noteOps.create(
      env.tx,
      { policies: env.policies },
      {
        id: newId(),
        title: input.title,
        parentRecords: [ref(input.parent_record)],
        ...(input.meeting_id ? { meetingId: input.meeting_id } : {}),
      },
      { markdown: input.content },
    );
    // The member approved the write, but the model authored the content. Persist that distinction atomically with
    // creation so an interrupted runner can never promote this note to primary evidence.
    await env.tx.db
      .updateTable('documents')
      .set({ updated_by: jsonb({ type: 'system', id: 'ask-ai' }) })
      .where('workspace_id', '=', env.tx.workspaceId)
      .where('id', '=', note.documentId)
      .execute();
    return {
      output: { note_id: note.id, embed: `agentic-crm:note-embed {"note_id":"${note.id}"}` },
      digest: { noteId: note.id },
    };
  },
});

/** Every tool in a fixed order (prompt caching: the tool list is part of the cached prefix). */
export const AI_TOOLS: readonly AiToolDef<unknown>[] = [
  searchRecords,
  listRecords,
  getRecords,
  listAttributes,
  listLists,
  listTasks,
  listNotes,
  getNotes,
  listMembers,
  searchMeetings,
  getMeeting,
  getCallRecording,
  searchEmails,
  getEmails,
  searchWeb,
  createRecord,
  updateRecord,
  createTask,
  updateTask,
  createNote,
];

export function aiTool(name: string): AiToolDef<unknown> | undefined {
  return AI_TOOLS.find((t) => t.name === name);
}
