//  import / export e2e helpers: the seeded CSV (C2 fixture data: a comma-decimal budget, an invalid
// number, an invalid checkbox, an out-of-range rating, an unknown status, an unknown select option, a member id and an
// unknown member, plus a row where every value is invalid) and the Projects schema lookups.
import type { Page } from '@playwright/test';
import { trpc } from './slice3-support.ts';

/** `{run}` keeps codes and the new option unique per run (the e2e database is reused between runs). */
export function importCsv(member: string, run = ''): string {
  return [
    'Code,Summary,Budget,Headcount,Strategic,Start date,Kickoff at,Health,Phase,Priority,Tags,Owner',
    `SEED-I01${run},[seed] Import test alpha,"12500,50",4,true,14/07/2026,2026-07-14T09:30:00Z,3,Discovery,High,"AI, Imported${run}",${member}`,
    `SEED-I02${run},[seed] Import test beta,8000,two,no,31/12/2026,2026-12-31,9,Unknown phase,Urgent,Data,Nobody Seed`,
    'SEED-012,,,4,,,,,,,,',
    ',,,three,,,,,,,,',
  ].join('\n');
}

export interface ProjectsSchema {
  id: string;
  attrs: Record<string, string>;
}

export async function projectsSchema(page: Page): Promise<ProjectsSchema> {
  const def = await trpc<{ id: string }>(page, 'schema.objects.get', { entityDefinitionId: 'projects' });
  const attrs = await trpc<Array<{ id: string; apiSlug: string }>>(page, 'schema.attributes.list', {
    entityDefinitionId: def.id,
  });
  return { id: def.id, attrs: Object.fromEntries(attrs.map((a) => [a.apiSlug, a.id])) };
}

export async function memberId(page: Page): Promise<string> {
  const members = await trpc<Array<{ id: string; emailAddress: string }>>(page, 'members.list', undefined);
  return (members.find((m) => m.emailAddress === 'e2e@mymeet.ai') ?? members[0])?.id as string;
}

type ValuesList = { values: Record<string, { state: string; value?: { values: { value: unknown }[] } }> };

async function projectsByCode(page: Page, projects: ProjectsSchema, operator: 'eq' | 'starts-with', code: string) {
  const out = await trpc<{ ids: string[] }>(page, 'snapshots.query', {
    entityDefinitionId: projects.id,
    filter: {
      path: [{ entityDefinitionId: projects.id, attributeDefinitionId: projects.attrs.code as string }],
      mode: 'must',
      constraints: [{ field: 'value', operator, value: code }],
    },
    initialRange: { start: 0, size: 500 },
  });
  return out.ids;
}

export interface ImportFootprint {
  projects: ProjectsSchema;
  seed012: string | undefined;
  headcountBefore: { value: unknown }[];
}

/**
 * What an import run of `importCsv` changes in the seeded Projects, so a spec can put it back afterwards
 * (`restoreImport`): the run creates "SEED-I…" projects and sets SEED-012's headcount. Later specs (views, exports)
 * count and sort the seeded projects.
 */
export async function importFootprint(page: Page): Promise<ImportFootprint> {
  const projects = await projectsSchema(page);
  const [seed012] = await projectsByCode(page, projects, 'eq', 'SEED-012');
  const listed = seed012
    ? await trpc<ValuesList>(page, 'values.list', {
        entityDefinitionId: projects.id,
        attributeDefinitionId: projects.attrs.headcount as string,
        entityInstanceIds: [seed012],
      })
    : null;
  const headcountBefore = seed012
    ? (listed?.values[seed012]?.value?.values.map((v) => ({ value: v.value })) ?? [])
    : [];
  return { projects, seed012, headcountBefore };
}

export async function restoreImport(page: Page, f: ImportFootprint): Promise<void> {
  for (const id of await projectsByCode(page, f.projects, 'starts-with', 'SEED-I')) {
    await trpc(page, 'records.delete', { entityDefinitionId: f.projects.id, entityInstanceId: id });
  }
  if (f.seed012) {
    await trpc(page, 'records.patch', {
      entityDefinitionId: f.projects.id,
      entityInstanceId: f.seed012,
      values: { [f.projects.attrs.headcount as string]: f.headcountBefore },
    });
  }
}
