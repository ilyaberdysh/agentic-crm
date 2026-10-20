//  e2e data (notes, templates, tasks, comments, favorites) seeded through the domain services: an account plan,
// kickoff notes with bodies, a discovery-call template, eight tasks around today (overdue … completed), and a comment
// thread with a reply plus a
// resolved one. Idempotent (stable ids). Prints the ids as JSON on the last line.
// pnpm --filter @agentic-crm/api exec tsx../web/e2e/seed- --db agentic_crm_test_s3notes
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { addDays, localDateOf } from '@agentic-crm/contracts';
import { createDb, sql } from '@agentic-crm/db';
import { createDomain, memberContext } from '@agentic-crm/domain';
import { databaseUrl, E2E_DATABASE, E2E_USER, WORKSPACE_SLUG } from './env.ts';

const { values: args } = parseArgs({
  options: { db: { type: 'string', default: E2E_DATABASE }, tz: { type: 'string', default: 'UTC' } },
});
const database = createDb({ connectionString: databaseUrl(args.db as string), max: 4, applicationName: 'seed-slice3' });
const domain = createDomain({ database });
const timeZone = args.tz as string;

function stableId(workspaceId: string, key: string): string {
  const h = createHash('sha256').update(`agentic-crm-s3:${workspaceId}:${key}`).digest('hex');
  const variant = ((Number.parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function recordId(workspaceId: string, objectSlug: string, name: string | null, index = 0): Promise<string> {
  const { rows } = await sql<{ id: string }>`
    SELECT i.id FROM entity_instances i JOIN entity_definitions d ON d.id = i.entity_definition_id
    WHERE i.workspace_id = ${workspaceId} AND d.api_slug = ${objectSlug} AND i.archived_at IS NULL
    ORDER BY i.created_at, i.id`.execute(database.kysely);
  if (name === null) return (rows[index] ?? rows[0])?.id as string;
  const named = await sql<{ id: string }>`
    SELECT v.instance_id AS id FROM attribute_values v
    JOIN entity_definitions d ON d.id = v.entity_definition_id
    WHERE v.workspace_id = ${workspaceId} AND d.api_slug = ${objectSlug} AND v.active_until IS NULL
      AND v.v_text ILIKE ${`%${name}%`}
    LIMIT 1`.execute(database.kysely);
  return (named.rows[0]?.id ?? rows[0]?.id) as string;
}

try {
  const { rows } = await sql<{ id: string }>`SELECT id FROM users WHERE email = ${E2E_USER.email}`.execute(
    database.kysely,
  );
  const userId = rows[0]?.id;
  const resolution = userId ? await domain.workspaces.resolveForUser(userId, { slug: WORKSPACE_SLUG }) : null;
  if (!resolution || resolution.status !== 'ok') throw new Error(`workspace "${WORKSPACE_SLUG}" not found`);
  const workspaceId = resolution.workspace.id;
  const memberId = resolution.membership.id;
  const ctx = memberContext(workspaceId, memberId);
  const id = (key: string) => stableId(workspaceId, key);

  const northwind = await recordId(workspaceId, 'companies', 'Northwind Robotics');
  const cedar = await recordId(workspaceId, 'companies', 'Cedar Health');
  const project = (i: number) => recordId(workspaceId, 'projects', null, i);
  const projects = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(project));
  const companies = await sql<{
    id: string;
  }>`SELECT id FROM entity_definitions WHERE workspace_id = ${workspaceId} AND api_slug = 'companies'`.execute(
    database.kysely,
  );
  const projectsDef = await sql<{
    id: string;
  }>`SELECT id FROM entity_definitions WHERE workspace_id = ${workspaceId} AND api_slug = 'projects'`.execute(
    database.kysely,
  );
  const companiesId = companies.rows[0]?.id as string;
  const projectsId = projectsDef.rows[0]?.id as string;

  // ---- notes ----
  const kickoff = (code: string) =>
    `**[seed] Kickoff notes ${code}**\n\n**Attendees:** client team, delivery lead\n\n## Decisions\n\n- Scope agreed for phase 1\n- Weekly check-ins`;
  // Created oldest first so the notes page (newest first) reads like the capture: Account plan, 006, 004, 002, 001.
  const notes: { key: string; title: string; record: [string, string]; markdown: string }[] = [
    ...['SEED-001', 'SEED-002', 'SEED-004', 'SEED-006'].map((code, i) => ({
      key: `note.kickoff.${code}`,
      title: `[seed] Kickoff ${code}`,
      record: [projectsId, projects[4 - i] as string] as [string, string],
      markdown: kickoff(code),
    })),
    {
      key: 'note.account-plan',
      title: '[seed] Account plan',
      record: [companiesId, northwind],
      markdown:
        '## Goals\n\n- Expand to 3 warehouses\n- Introduce telemetry add-on\n\n## Contacts\n\n- [seed] Jane Cooper',
    },
  ];
  const noteIds: Record<string, string> = {};
  for (const n of notes) {
    const note = await domain.notes.create(
      ctx,
      {
        id: id(n.key),
        title: n.title,
        parentRecords: [{ entityDefinitionId: n.record[0], entityInstanceId: n.record[1] }],
      },
      { markdown: n.markdown },
    );
    noteIds[n.key] = note.id;
  }

  // ---- template ----
  const template = await domain.noteTemplates.create(ctx, {
    id: id('template.discovery'),
    title: '[seed] Discovery call template',
  });
  await sql`
    UPDATE documents SET markdown = ${'## Agenda\n\n- Introductions\n- Current tooling\n\n## Next steps\n\n1. Owner'},
      search_text = ${'Agenda Introductions Current tooling Next steps Owner'}
    WHERE id = ${template.documentId} AND yjs_state IS NULL`.execute(database.kysely);

  // ---- tasks (deadlines around the local today) ----
  const today = localDateOf(Date.now(), timeZone);
  const tasks: { key: string; title: string; offset: number | null; done?: boolean; project: number }[] = [
    { key: 'task.deep-dive', title: '[seed] Book technical deep-dive', offset: -1, project: 0 },
    { key: 'task.redlines', title: '[seed] Review contract redlines', offset: 0, project: 1 },
    { key: 'task.forecast', title: '[seed] Update forecast', offset: 1, project: 2 },
    { key: 'task.proposal', title: '[seed] Send proposal draft', offset: 2, project: 3 },
    { key: 'task.security', title: '[seed] Collect security questionnaire', offset: 5, project: 4 },
    { key: 'task.case-study', title: '[seed] Share case study', offset: 10, project: 5 },
    { key: 'task.procurement', title: '[seed] Intro to procurement', offset: null, project: 6 },
    { key: 'task.recap', title: '[seed] Kickoff call recap', offset: -5, done: true, project: 7 },
  ];
  const taskIds: Record<string, string> = {};
  for (const t of tasks) {
    const task = await domain.tasks.create(ctx, {
      id: id(t.key),
      content: { text: t.title, mentions: [] },
      deadline: t.offset === null ? null : { kind: 'date', date: addDays(today, t.offset), timeZone },
      assigneeMemberIds: [memberId],
      linkedRecords: [{ entityDefinitionId: projectsId, entityInstanceId: projects[t.project] as string }],
      isCompleted: t.done ?? false,
    });
    taskIds[t.key] = task.id;
  }

  // ---- comments ----
  const commented = projects[1] as string;
  const target = { kind: 'record' as const, entityDefinitionId: projectsId, entityInstanceId: commented };
  const root = await domain.comments.create(ctx, {
    id: id('comment.timeline'),
    target,
    content: { text: '[seed] Client asked for a revised timeline.', mentions: [], styles: [] },
  });
  await domain.comments.create(ctx, {
    id: id('comment.timeline.reply'),
    threadId: root.threadId,
    content: { text: '[seed] Timeline v2 shared, waiting for feedback.', mentions: [], styles: [] },
  });
  const resolved = await domain.comments.create(ctx, {
    id: id('comment.resolve'),
    target,
    content: { text: '[seed] Top-level comment for resolve test', mentions: [], styles: [] },
  });
  await domain.comments.resolve(ctx, { commentId: resolved.id, resolved: true });

  console.log(
    JSON.stringify({
      workspaceId,
      memberId,
      companiesId,
      projectsId,
      northwind,
      cedar,
      projects,
      notes: noteIds,
      templateId: template.id,
      tasks: taskIds,
      thread: { threadId: root.threadId, rootId: root.id, recordId: commented },
      resolvedThreadId: resolved.threadId,
    }),
  );
} finally {
  await database.destroy();
}
