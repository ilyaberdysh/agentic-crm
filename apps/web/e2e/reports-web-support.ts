//  e2e fixtures for the dashboard grid, editor and charts: a custom "[seed] Projects" object with the shape of
// the captured layout (Budget currency, Phase status Discovery / Build / Review / Done, Priority select, Start date),
// twelve records with these phase budgets (Build 470 000, Discovery 200 000, Review 43 000, Done 21 000), and
// dashboards with reports created through the procedures.
import { type Page } from '@playwright/test';
import { WORKSPACE_SLUG } from './env.ts';
import { trpc as rawTrpc, uuid } from './slice3-support.ts';

/** tRPC with retries: the shared Postgres cluster of parallel agents sometimes answers "too many clients" (500). */
async function trpc<T>(page: Page, name: string, input: unknown): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await rawTrpc<T>(page, name, input);
    } catch (error) {
      last = error;
      if (!/: 500 /.test(String(error))) throw error;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw last;
}

export interface ProjectsFixture {
  objectId: string;
  apiSlug: string;
  budget: string;
  phase: string;
  priority: string;
  start: string;
  stages: Record<'Discovery' | 'Build' | 'Review' | 'Done', string>;
  options: Record<'Critical' | 'High' | 'Medium' | 'Low', string>;
  records: { id: string; name: string; phase: keyof ProjectsFixture['stages']; budget: number }[];
}

/** [phase, budget, priority, start date] of the twelve projects (contributing-data-table.png). */
const PROJECTS: [keyof ProjectsFixture['stages'], number, keyof ProjectsFixture['options'], string][] = [
  ['Build', 250_000, 'High', '2026-03-12'],
  ['Done', 12_000, 'Low', '2025-12-05'],
  ['Build', 70_000, 'High', '2026-04-20'],
  ['Discovery', 60_000, 'Critical', '2026-10-01'],
  ['Done', 9_000, 'Medium', '2026-01-15'],
  ['Build', 30_000, 'Medium', '2026-08-03'],
  ['Review', 18_000, 'Medium', '2026-05-09'],
  ['Discovery', 15_000, 'Low', '2026-06-22'],
  ['Discovery', 45_000, 'Medium', '2026-09-14'],
  ['Discovery', 80_000, 'High', '2026-10-05'],
  ['Build', 120_000, 'High', '2026-07-11'],
  ['Review', 25_000, 'Medium', '2026-11-02'],
];

export async function createProjects(page: Page, suffix = Date.now().toString(36)): Promise<ProjectsFixture> {
  const objectId = uuid();
  const apiSlug = `rep_projects_${suffix}`;
  await trpc(page, 'schema.objects.create', {
    id: objectId,
    apiSlug,
    singularNoun: '[seed] Project',
    pluralNoun: '[seed] Projects',
  });
  const attr = async (input: Record<string, unknown>) => {
    const id = uuid();
    await trpc(page, 'schema.attributes.create', { id, entityDefinitionId: objectId, ...input });
    return id;
  };
  const stageTitles = ['Discovery', 'Build', 'Review', 'Done'] as const;
  const stageColors = {
    Discovery: 'block_light-green',
    Build: 'block_blue',
    Review: 'block_magenta',
    Done: 'block_grey',
  };
  const stages = Object.fromEntries(stageTitles.map((t) => [t, uuid()])) as ProjectsFixture['stages'];
  const phase = await attr({
    title: 'Phase',
    apiSlug: 'phase',
    type: 'pipeline',
    stages: stageTitles.map((t) => ({ id: stages[t], title: t, color: stageColors[t] })),
  });
  const budget = await attr({
    title: 'Budget',
    apiSlug: 'budget',
    type: 'currency',
    currencyConfiguration: {
      defaultCurrencyCode: 'EUR',
      defaultDisplayType: 'symbol',
      defaultDecimalPlaces: 'two-decimals',
      defaultGroups: 'default',
    },
  });
  const optionTitles = ['Critical', 'High', 'Medium', 'Low'] as const;
  const options = Object.fromEntries(optionTitles.map((t) => [t, uuid()])) as ProjectsFixture['options'];
  const priority = await attr({
    title: 'Priority',
    apiSlug: 'priority',
    type: 'select',
    options: optionTitles.map((t) => ({ id: options[t], title: t, color: 'pastel_grey' })),
  });
  const start = await attr({ title: 'Start date', apiSlug: 'start_date', type: 'date' });
  const records: ProjectsFixture['records'] = [];
  for (const [i, [stage, amount, prio, date]] of PROJECTS.entries()) {
    const id = uuid();
    const name = `Project ${i + 1}`;
    await trpc(page, 'records.put', {
      entityDefinitionId: objectId,
      entityInstanceId: id,
      values: {
        [phase]: [{ value: { pipelineStageId: stages[stage] } }],
        [budget]: [{ value: { currencyValue: amount } }],
        [priority]: [{ value: { selectOptionId: options[prio] } }],
        [start]: [{ value: date }],
      },
    });
    records.push({ id, name, phase: stage, budget: amount });
  }
  return { objectId, apiSlug, budget, phase, priority, start, stages, options, records };
}

export const reportsPath = (path = '') => `/${WORKSPACE_SLUG}/reports${path}`;

export interface CreatedReport {
  reportId: string;
  cellId: string;
}

/** Creates a dashboard (titled) and returns its id. */
export async function createDashboard(page: Page, title: string, description = ''): Promise<string> {
  const id = uuid();
  await trpc(page, 'dashboards.create', { id, title, description });
  return id;
}

/** Adds a report to a dashboard through the procedure (full width after the last cell). */
export async function addReport(
  page: Page,
  dashboardId: string,
  input: {
    entityDefinitionId: string;
    title: string;
    reportType: 'insights' | 'historical' | 'funnel' | 'time-in-stage' | 'stage-changed';
    visualisationType?: string;
    settings?: Record<string, unknown>;
    description?: string | null;
    filter?: unknown;
    width?: number;
  },
): Promise<CreatedReport> {
  const reportId = uuid();
  const cellId = uuid();
  await trpc(page, 'reports.create', {
    id: reportId,
    cellId,
    dashboardId,
    width: 12,
    ...input,
  });
  return { reportId, cellId };
}

/** A path to an attribute of the fixture (single hop). */
export const hop = (f: ProjectsFixture, attribute: string) => [
  { entityDefinitionId: f.objectId, attributeDefinitionId: attribute },
];

/** Insight: sum of Budget grouped by Phase, shown as a bar chart. */
export function budgetByPhase(f: ProjectsFixture): Record<string, unknown> {
  return {
    primaryMetric: { attributePath: hop(f, f.budget), field: null, aggregation: 'sum' },
    primaryGrouping: {
      attributePath: hop(f, f.phase),
      field: 'pipeline_stage_id',
      selectedValues: null,
      nullGroupVisible: true,
      emptyGroupsVisible: false,
      selectedPipelineStageIds: [],
    },
  };
}
