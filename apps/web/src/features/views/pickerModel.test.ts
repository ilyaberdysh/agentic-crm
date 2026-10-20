import type { AttributeDefinition, EntityDefinition } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import { levelItems, type PickerLevel, searchItems } from './pickerModel';
import { SchemaIndex } from './schemaIndex';
import { a, attr, COMPANIES, companyCreatedAt, companyName, PROJECTS, TASKS } from './testFixtures';

const def = (id: string, singular: string): EntityDefinition =>
  ({ id, singularNoun: singular, pluralNoun: `${singular}s`, apiSlug: singular.toLowerCase() }) as EntityDefinition;

// companies.parent → companies: a self-reference lets paths grow to the 5-hop limit.
const parent = attr(COMPANIES, 'Parent', 'entity-reference', {
  isSystem: false,
  sortOrder: 'z',
  config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [COMPANIES] } },
});
const avatar = attr(COMPANIES, 'Logo', 'text', { isSystem: true, systemAttributeType: 'avatar-url', sortOrder: 'c' });
const listEntries = attr(PROJECTS, 'List entries', 'entity-reference', {
  isSystem: true,
  isHidden: true,
  systemAttributeType: 'list-entries',
  sortOrder: '2',
});
const nextDueTask = attr(PROJECTS, 'Next due task', 'entity-reference', {
  isSystem: true,
  isHidden: true,
  systemAttributeType: 'next-due-task',
  sortOrder: '3',
  config: { entityReferenceConfiguration: { allowedEntityDefinitionIds: [TASKS] } },
});
const deadline = attr(TASKS, 'Deadline', 'timestamp', { isSystem: true, systemAttributeType: 'task-deadline' });
const completed = attr(TASKS, 'Completed', 'checkbox', { isSystem: true, systemAttributeType: 'task-completed' });
const archived = attr(PROJECTS, 'Old field', 'text', { isArchived: true });

const projectAttrs: AttributeDefinition[] = [...Object.values(a), listEntries, nextDueTask, archived];
const index = new SchemaIndex(
  [def(PROJECTS, 'Project'), def(COMPANIES, 'Company'), def(TASKS, 'Task')],
  new Map([
    [PROJECTS, projectAttrs],
    [COMPANIES, [companyName, companyCreatedAt, parent, avatar]],
    [TASKS, [deadline, completed]],
  ]),
);
const root: PickerLevel = { kind: 'object', definitionId: PROJECTS, prefix: [], via: null };

describe('attribute path picker (B.7)', () => {
  it('lists system attributes first, hides list entries, archived and avatar attributes, keeps Next due task', () => {
    const labels = levelItems(index, root, 'column').map((i) => i.label);
    expect(labels.slice(0, 2)).toEqual(['Record ID', 'Next due task']);
    expect(labels).not.toContain('List entries');
    expect(labels).not.toContain('Old field');
    expect(labels).toContain('Code');
  });

  it('drills relationships with a count; the drilled level starts with the relationship itself', () => {
    const client = levelItems(index, root, 'column').find((i) => i.label === 'Client');
    expect(client?.drill?.kind).toBe('object');
    expect(client?.count).toBe(3); // Name, Created at, Parent (Logo is an avatar)
    const level = levelItems(index, client?.drill as PickerLevel, 'column');
    expect(level[0]).toMatchObject({ label: 'Client', isSelf: true });
    expect(level.slice(1).every((i) => i.indent)).toBe(true);
    expect(level[1]?.select?.path).toHaveLength(2);
  });

  it('Next due task drills into the due date only', () => {
    const task = levelItems(index, root, 'column').find((i) => i.label === 'Next due task');
    expect(task?.count).toBe(1);
    const level = levelItems(index, task?.drill as PickerLevel, 'column');
    expect(level.map((i) => i.label)).toEqual(['Next due task', 'Deadline']);
  });

  it('stops drilling at 5 hops', () => {
    let level = levelItems(index, root, 'column').find((i) => i.label === 'Client')?.drill as PickerLevel;
    let depth = 1;
    for (;;) {
      const next = levelItems(index, level, 'column').find((i) => i.label === 'Parent' && !i.isSelf);
      if (!next?.drill) {
        expect(next?.select?.path).toHaveLength(5);
        break;
      }
      level = next.drill;
      depth++;
    }
    expect(depth).toBe(4); // Client + 3 × Parent drills; the 5th hop is selectable but not drillable
  });

  it('location columns drill into City / State / Country', () => {
    const office = levelItems(index, root, 'column').find((i) => i.label === 'Office');
    expect(office?.drill).toMatchObject({ kind: 'fields' });
    const fields = levelItems(index, office?.drill as PickerLevel, 'column').map((i) => [i.label, i.select?.field]);
    expect(fields).toEqual([
      ['City', 'locality'],
      ['State', 'region'],
      ['Country', 'country_code'],
    ]);
  });

  it('filters: multi-field types drill into sub-fields; status selects directly with a Lifecycle chevron', () => {
    const items = levelItems(index, root, 'filter');
    const owner = items.find((i) => i.label === 'Owner');
    expect(levelItems(index, owner?.drill as PickerLevel, 'filter').map((i) => i.label)).toEqual(['Owner', 'Type']);
    const phase = items.find((i) => i.label === 'Phase');
    expect(phase).toMatchObject({ clickSelects: true, select: { field: 'pipeline_stage_id' } });
    expect(levelItems(index, phase?.drill as PickerLevel, 'filter').map((i) => i.label)).toEqual([
      'Phase',
      'Lifecycle',
    ]);
  });

  it('sorts: no direct sort on relationships, status drills into Stage order / Active from', () => {
    const items = levelItems(index, root, 'sort');
    const client = items.find((i) => i.label === 'Client');
    expect(client?.select).toBeUndefined();
    expect(levelItems(index, client?.drill as PickerLevel, 'sort').some((i) => i.isSelf)).toBe(false);
    const phase = items.find((i) => i.label === 'Phase');
    expect(levelItems(index, phase?.drill as PickerLevel, 'sort').map((i) => [i.label, i.select?.field])).toEqual([
      ['Stage order', 'stage_sort_order'],
      ['Active from', 'active_from'],
    ]);
    expect(items.find((i) => i.label === 'Budget')?.select?.field).toBe('raw_value');
  });

  it('search matches nested paths ("Client › Created at")', () => {
    const hits = searchItems(index, root, 'column', 'created at').map((i) => i.label);
    expect(hits).toContain('Client › Created at');
  });
});
