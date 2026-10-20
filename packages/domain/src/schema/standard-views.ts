// Default views of the standard objects (C1 README §1 "Default (system/onboarding-created) views"). The record
// column (titled with the singular noun) is implicit and not stored as a view column.
import type { Path, Predicate, Sort } from '@agentic-crm/contracts';
import { rankSequence } from '@agentic-crm/contracts';
import type { Tx } from '../tx.ts';
import { insertView } from '../views/service.ts';
import type { DefInfo } from './model.ts';

export interface ColumnSpecSeed {
  attr: string;
  field?: string;
  width?: number;
}

interface ViewSeed {
  title: string;
  type: 'table' | 'kanban';
  columns: ColumnSpecSeed[];
  sorts: { attr: string; field?: string; direction: 'asc' | 'desc' }[];
  filter?: (path: (attr: string) => Path) => Predicate;
  kanbanPivot?: string;
}

const countryIs = (country: string) => (path: (attr: string) => Path) => ({
  path: path('primary_location'),
  mode: 'must' as const,
  constraints: [{ field: 'country_code', operator: 'eq' as const, value: country }],
});

const VIEWS: Record<string, ViewSeed[]> = {
  companies: [
    {
      title: 'All Companies',
      type: 'table',
      columns: [
        { attr: 'description', width: 288 },
        { attr: 'primary_location', field: 'country_code' },
        { attr: 'foundation_date' },
        { attr: 'twitter_follower_count' },
        { attr: 'twitter' },
        { attr: 'linkedin' },
        { attr: 'domains' },
        { attr: 'categories' },
        { attr: 'strongest_connection_strength' },
        { attr: 'last_interaction', field: 'interacted_at', width: 288 },
      ],
      sorts: [
        { attr: 'last_interaction', field: 'interacted_at', direction: 'desc' },
        { attr: 'twitter_follower_count', direction: 'desc' },
      ],
    },
    {
      title: 'US Companies',
      type: 'table',
      columns: [
        { attr: 'description', width: 288 },
        { attr: 'primary_location', field: 'country_code' },
        { attr: 'strongest_connection_strength' },
        { attr: 'last_interaction', field: 'interacted_at' },
      ],
      sorts: [{ attr: 'last_interaction', field: 'interacted_at', direction: 'desc' }],
      filter: (path) => ({ and: [countryIs('US')(path)] }),
    },
    {
      title: 'UK, French and German Companies',
      type: 'table',
      columns: [
        { attr: 'description', width: 288 },
        { attr: 'primary_location', field: 'country_code' },
        { attr: 'strongest_connection_strength' },
        { attr: 'last_interaction', field: 'interacted_at' },
      ],
      sorts: [{ attr: 'last_interaction', field: 'interacted_at', direction: 'desc' }],
      filter: (path) => ({ and: [{ or: [countryIs('GB')(path), countryIs('FR')(path), countryIs('DE')(path)] }] }),
    },
  ],
  people: [
    {
      title: 'Recently Contacted People',
      type: 'table',
      columns: [
        { attr: 'strongest_connection_strength' },
        { attr: 'last_email_interaction', field: 'interacted_at', width: 288 },
        { attr: 'last_calendar_interaction', field: 'interacted_at', width: 310 },
      ],
      sorts: [{ attr: 'last_interaction', field: 'interacted_at', direction: 'desc' }],
    },
  ],
  deals: [
    {
      title: 'Pipeline',
      type: 'kanban',
      kanbanPivot: 'stage',
      columns: [{ attr: 'owner' }, { attr: 'value' }, { attr: 'associated_company' }],
      sorts: [{ attr: 'created_at', direction: 'desc' }],
    },
    {
      title: 'All Deals',
      type: 'table',
      columns: [
        { attr: 'stage' },
        { attr: 'owner' },
        { attr: 'value' },
        { attr: 'next_due_task' },
        { attr: 'created_by' },
      ],
      sorts: [{ attr: 'created_at', direction: 'desc' }],
    },
  ],
  users: [
    {
      title: 'All Users',
      type: 'table',
      columns: [
        { attr: 'person' },
        { attr: 'primary_email_address' },
        { attr: 'next_due_task' },
        { attr: 'created_by' },
        { attr: 'created_at' },
      ],
      sorts: [{ attr: 'created_at', direction: 'desc' }],
    },
  ],
  workspaces: [
    {
      title: 'All Workspaces',
      type: 'table',
      columns: [
        { attr: 'name' },
        { attr: 'company' },
        { attr: 'users' },
        { attr: 'next_due_task' },
        { attr: 'created_by' },
        { attr: 'created_at' },
      ],
      sorts: [{ attr: 'created_at', direction: 'desc' }],
    },
  ],
};

/** Sort orders: Deals open on "Pipeline" before "All Deals" (C1 README: sort_order 'c' before 'o'). */
export async function seedViews(tx: Tx, def: DefInfo): Promise<void> {
  const seeds = VIEWS[def.apiSlug];
  if (!seeds) return;
  const path = (attr: string): Path => {
    const a = def.bySlug.get(attr);
    if (!a) throw new Error(`Default view references unknown attribute ${def.apiSlug}.${attr}`);
    return [{ entityDefinitionId: def.id, attributeDefinitionId: a.id }];
  };
  const ranks = rankSequence(seeds.length);
  for (const [i, seed] of seeds.entries()) {
    const sorts: Sort[] = seed.sorts.map((s) => ({
      path: path(s.attr),
      direction: s.direction,
      ...(s.field ? { field: s.field } : {}),
    }));
    await insertView(tx, def, {
      type: seed.type,
      title: seed.title,
      sortOrder: ranks[i] as string,
      filter: seed.filter ? seed.filter(path) : null,
      sorts,
      columns: seed.columns.map((c) => ({
        path: path(c.attr),
        field: c.field ?? null,
        tableColumnWidth: c.width ?? null,
      })),
      kanbanPivotPath: seed.kanbanPivot ? path(seed.kanbanPivot) : null,
    });
  }
}
