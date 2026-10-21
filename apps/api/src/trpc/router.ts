// Internal API router: resource-oriented procedures, each a thin adapter over
// packages/domain (I5) with inputs from packages/contracts. Workspace-scoped procedures take the workspace from the
// `x-workspace-slug` header. Mutations answer `{<canonical state>, seq}` (see mutation.ts); queries accept
// `acceptAfter` (input or `x-accept-after`). Send queries as POST (client `methodOverride: 'POST'`): batched value
// reads do not fit in a URL.
import { resolvePoliciesInputSchema } from '@agentic-crm/contracts';
import { acceptAfterInput, acceptAfterOnly } from './mutation';
import { agenticRouter } from './routers/agentic';
import { aiRouter, creditsRouter, promptsRouter } from './routers/ai';
import { aiAttributesRouter } from './routers/ai-attributes';
import { callsRouter } from './routers/calls';
import { commentsRouter } from './routers/comments';
import { dashboardsRouter } from './routers/dashboards';
import { developersRouter } from './routers/developers';
import { connectorsRouter, emailRouter } from './routers/email';
import { exportsRouter } from './routers/exports';
import { favoritesRouter } from './routers/favorites';
import { filesRouter } from './routers/files';
import { formulasRouter } from './routers/formulas';
import { homeRouter } from './routers/home';
import { importsRouter } from './routers/imports';
import { insightTemplatesRouter } from './routers/insightTemplates';
import { entriesRouter, kanbanRouter, listsRouter } from './routers/lists';
import { mailboxesRouter, suppressionRouter, workspaceEmailRouter } from './routers/mailboxes';
import { meetingsRouter } from './routers/meetings';
import { membersRouter } from './routers/members';
import { documentsRouter, notesRouter, noteTemplatesRouter } from './routers/notes';
import { notificationsRouter } from './routers/notifications';
import { permissionsRouter } from './routers/permissions';
import { profileRouter } from './routers/profile';
import { layoutsRouter, preferencesRouter, recordPageRouter, timelineRouter } from './routers/record-page';
import { recordsRouter, valuesRouter } from './routers/records';
import { reportingRouter } from './routers/reporting';
import { reportsRouter } from './routers/reports';
import { rulesRouter } from './routers/rules';
import { schemaRouter } from './routers/schema';
import { searchRouter } from './routers/search';
import { tasksRouter } from './routers/tasks';
import { teamsRouter } from './routers/teams';
import { snapshotsRouter, viewsRouter } from './routers/views';
import { webhooksRouter } from './routers/webhooks';
import { workflowsRouter } from './routers/workflows';
import { workspaceRouter } from './routers/workspace';
import { invitesRouter, workspacesRouter } from './routers/workspaces';
import { authedProcedure, router, workspaceProcedure } from './trpc';

export const appRouter = router({
  agentic: agenticRouter,
  /** The signed-in user and current session. */
  me: authedProcedure.query(({ ctx }) => ({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      name: ctx.user.name,
      image: ctx.user.image ?? null,
      emailVerified: ctx.user.emailVerified,
      createdAt: new Date(ctx.user.createdAt).toISOString(),
    },
    session: {
      id: ctx.session.id,
      expiresAt: new Date(ctx.session.expiresAt).toISOString(),
    },
  })),

  workspaces: workspacesRouter,
  members: membersRouter,
  invites: invitesRouter,
  schema: schemaRouter,
  records: recordsRouter,
  values: valuesRouter,
  views: viewsRouter,
  snapshots: snapshotsRouter,
  search: searchRouter,

  // Slice 3: record page, notes, tasks, comments, favorites, files.
  recordPage: recordPageRouter,
  timeline: timelineRouter,
  layouts: layoutsRouter,
  notes: notesRouter,
  noteTemplates: noteTemplatesRouter,
  documents: documentsRouter,
  tasks: tasksRouter,
  comments: commentsRouter,
  favorites: favoritesRouter,
  files: filesRouter,
  preferences: preferencesRouter,

  // Slice 4: lists, entries, kanban boards.
  lists: listsRouter,
  entries: entriesRouter,
  kanban: kanbanRouter,
  // Slice 4: CSV import and view export (worker jobs, D-10).
  imports: importsRouter,
  exports: exportsRouter,

  // Slice 5: notifications inbox and preferences, home summary (search.records extended in routers/search).
  notifications: notificationsRouter,
  home: homeRouter,

  // Slice 7: email and calendar (connector-agnostic part; Gmail arrives with 7b).
  mailboxes: mailboxesRouter,
  workspaceEmail: workspaceEmailRouter,
  suppression: suppressionRouter,
  email: emailRouter,
  meetings: meetingsRouter,
  connectors: connectorsRouter,

  /** Resolved action policies of the caller per object (client `can(flag)` gating; A internal #16). */
  policies: router({
    resolve: workspaceProcedure
      .input(resolvePoliciesInputSchema.extend(acceptAfterInput))
      .query(({ ctx, input }) =>
        ctx.domain.policies.resolve(ctx.service, { entityDefinitionIds: input.entityDefinitionIds }),
      ),
  }),

  // Slice 6: settings, permissions, members, teams, rules, developers.
  profile: profileRouter,
  workspace: workspaceRouter,
  teams: teamsRouter,
  permissions: permissionsRouter,
  rules: rulesRouter,
  developers: developersRouter,
  webhooks: webhooksRouter,

  // Slice 8: workflows (editor, versions, runs, triggers, catalogue, credits usage).
  workflows: workflowsRouter,
  // Slice 9: dashboards, reports and the reporting dataset engine.
  dashboards: dashboardsRouter,
  reports: reportsRouter,
  reporting: reportingRouter,
  // Slice 10 (S10-ASK): Ask Agentic, prompts library, credits (records.summary lives in the records router).
  ai: aiRouter,
  prompts: promptsRouter,
  credits: creditsRouter,
  // Slice 10: formula attributes and AI autofill attributes.
  formulas: formulasRouter,
  aiAttributes: aiAttributesRouter,
  // Slice 10: calls (transcripts imported from mymeet through /v2), insights and insight templates.
  calls: callsRouter,
  insightTemplates: insightTemplatesRouter,

  /** Feature flags and quotas of the workspace (B.13; all on for internal use). */
  capabilities: router({
    get: workspaceProcedure.input(acceptAfterOnly).query(({ ctx }) => ctx.domain.capabilities.get(ctx.service)),
  }),
});

export type AppRouter = typeof appRouter;
