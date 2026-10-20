// Record page layouts (BACKLOG 3.10; D §2.2–2.5, §2.8, §4.1).
import type { CustomLayout, LayoutElement, LayoutElementInput } from '@agentic-crm/contracts';
import { sql } from '@agentic-crm/db';
import { describe, expect, it } from 'vitest';
import { collabFixture } from './collab-fixtures.ts';
import { database, domain, expectCode, newId } from './support/harness.ts';

const toInput = (e: LayoutElement): LayoutElementInput => ({
  elementId: e.elementId,
  parentElementId: e.parentElementId,
  type: e.type,
  groupIdentifier: e.groupIdentifier,
  title: e.title,
  slug: e.slug,
  sortOrder: e.sortOrder,
  path: e.path,
  field: e.field,
});

const group = (layout: CustomLayout, id: string) =>
  layout.elements.find((e) => e.type === 'group' && e.groupIdentifier === id) as LayoutElement;
const children = (layout: CustomLayout, parent: LayoutElement) =>
  layout.elements
    .filter((e) => e.parentElementId === parent.elementId)
    .sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : 1));

describe('record page layouts', () => {
  it.each([
    ['companies', ['activity', 'emails', 'calls', 'team', 'notes', 'tasks', 'files', 'agent'], 6, false],
    ['people', ['activity', 'emails', 'calls', 'company', 'notes', 'tasks', 'files', 'agent'], 6, true],
  ])('seeds the %s default layout on bootstrap (D §2.4, §2.5)', async (object, tabs, widgets, sequence) => {
    const f = await collabFixture();
    const layout = await domain.layouts.get(f.ctx, { entityDefinitionId: object });
    expect(layout).toMatchObject({ type: 'record-page', title: 'Default', isSystemLayout: true, version: 1 });
    expect(children(layout, group(layout, 'tabs')).map((t) => t.slug)).toEqual(tabs);
    expect(children(layout, group(layout, 'static-tabs')).map((t) => t.slug)).toEqual(['overview']);
    expect(children(layout, group(layout, 'widgets-v2'))).toHaveLength(widgets);
    const actions = children(layout, group(layout, 'actions')).map((a) => a.type);
    expect(actions.includes('sequence-action')).toBe(sequence);
    expect(children(layout, group(layout, 'details-sidebar')).map((d) => d.type)).toEqual([
      'details',
      'detail-list-entries',
    ]);
    const rel = layout.elements.find((e) => e.type === 'relationship-tab') as LayoutElement;
    expect(children(layout, rel)).toHaveLength(2);
  });

  it('seeds deals on activation and custom objects on creation (lazily for anything else)', async () => {
    const f = await collabFixture();
    await domain.schema.updateObject(f.ctx, { entityDefinitionId: 'deals', isArchived: false });
    const deals = await domain.layouts.get(f.ctx, { entityDefinitionId: 'deals' });
    expect(children(deals, group(deals, 'tabs')).map((t) => t.slug)).toEqual([
      'activity',
      'notes',
      'tasks',
      'associated_people',
      'emails',
      'files',
      'agent',
    ]);
    const widget = children(deals, group(deals, 'widgets-v2')).at(-1) as LayoutElement;
    expect(widget.path).toHaveLength(2); // Associated people › Last interaction
    const custom = await domain.schema.createObject(f.ctx, {
      id: newId(),
      apiSlug: 'projects',
      singularNoun: 'Project',
      pluralNoun: 'Projects',
    });
    const layout = await domain.layouts.get(f.ctx, { entityDefinitionId: custom.id });
    expect(children(layout, group(layout, 'tabs')).map((t) => t.slug)).toEqual([
      'activity',
      'notes',
      'tasks',
      'emails',
      'files',
      'agent',
    ]);
    expect(children(layout, group(layout, 'widgets-v2'))).toHaveLength(3);
  });

  it('adds Agent once to an existing custom layout without changing its other elements', async () => {
    const f = await collabFixture();
    const initial = await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' });
    const customized = await domain.layouts.save(f.ctx, {
      customLayoutId: initial.id,
      elements: initial.elements.map((item) =>
        item.type === 'email-tab' ? { ...toInput(item), title: 'Customer email' } : toInput(item),
      ),
    });
    const legacyElements = customized.elements
      .filter((item) => item.type !== 'agent-tab')
      .map((item) => (item.type === 'email-tab' ? { ...item, slug: 'agent' } : item));
    await sql`UPDATE custom_layouts SET elements = ${JSON.stringify(legacyElements)}::jsonb WHERE id = ${customized.id}`.execute(
      database.kysely,
    );

    const upgraded = await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' });
    expect(upgraded.version).toBe(customized.version + 1);
    expect(children(upgraded, group(upgraded, 'tabs')).at(-1)).toMatchObject({ type: 'agent-tab', slug: 'agent-2' });
    expect(upgraded.elements.find((item) => item.type === 'email-tab')?.title).toBe('Customer email');

    const repeated = await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' });
    expect(repeated.version).toBe(upgraded.version);
    expect(repeated.elements.filter((item) => item.type === 'agent-tab')).toHaveLength(1);
  });

  it('saves a full replacement: reorder tabs, add a widget and a section, remove a tab, unique slugs', async () => {
    const f = await collabFixture();
    const layout = await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' });
    const tabs = children(layout, group(layout, 'tabs'));
    const files = tabs.find((t) => t.slug === 'files') as LayoutElement;
    const calls = tabs.find((t) => t.slug === 'calls') as LayoutElement;
    const description = (await domain.schema.listAttributes(f.ctx, { entityDefinitionId: 'companies' })).find(
      (a) => a.apiSlug === 'description',
    );
    const path = [{ entityDefinitionId: f.companies, attributeDefinitionId: description?.id as string }];
    const widgets = children(layout, group(layout, 'widgets-v2'));
    const sectionId = newId();
    const added: LayoutElementInput[] = [
      {
        elementId: newId(),
        parentElementId: group(layout, 'widgets-v2').elementId,
        type: 'value-widget-v2',
        sortOrder: 'z',
        path,
        title: 'About',
      },
      {
        elementId: sectionId,
        parentElementId: group(layout, 'details-sidebar').elementId,
        type: 'details',
        sortOrder: 'y',
        title: 'More',
      },
      { elementId: newId(), parentElementId: sectionId, type: 'details-value', sortOrder: 'i', path },
      {
        elementId: newId(),
        parentElementId: group(layout, 'tabs').elementId,
        type: 'email-tab',
        sortOrder: 'zz',
        title: 'Emails 2',
      },
    ];
    const deduped: LayoutElementInput[] = [
      ...layout.elements
        .filter((e) => e.elementId !== calls.elementId && e.elementId !== widgets[0]?.elementId)
        // Files moves first.
        .map((e) => (e.elementId === files.elementId ? { ...toInput(e), sortOrder: '0001' } : toInput(e))),
      ...added,
    ];
    const saved = await domain.layouts.save(f.ctx, {
      customLayoutId: layout.id,
      elements: deduped,
      expectedVersion: 1,
    });
    expect(saved).toMatchObject({ version: 2, isSystemLayout: false });
    const savedTabs = children(saved, group(saved, 'tabs')).map((t) => t.slug);
    expect(savedTabs[0]).toBe('files');
    expect(savedTabs).not.toContain('calls');
    expect(savedTabs).toContain('emails-1');
    expect(children(saved, group(saved, 'widgets-v2')).at(-1)).toMatchObject({ title: 'About', path });
    expect(children(saved, group(saved, 'details-sidebar')).map((e) => e.title)).toEqual([
      'Record Details',
      'Lists',
      'More',
    ]);
    await expectCode(
      domain.layouts.save(f.ctx, { customLayoutId: layout.id, elements: deduped, expectedVersion: 1 }),
      'VERSION_CONFLICT',
      409,
    );
    expect((await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' })).version).toBe(2);
  });

  it.each<[string, (layout: CustomLayout, f: Awaited<ReturnType<typeof collabFixture>>) => LayoutElementInput[]]>([
    ['removing a system tab', (l) => l.elements.filter((e) => e.type !== 'activity-tab').map(toInput)],
    ['removing every details section', (l) => l.elements.filter((e) => e.type !== 'details').map(toInput)],
    [
      'adding a group',
      (l) => [
        ...l.elements.map(toInput),
        { elementId: newId(), parentElementId: null, type: 'group', groupIdentifier: 'tabs', sortOrder: 'z' },
      ],
    ],
    [
      'a second notes tab',
      (l) => [
        ...l.elements.map(toInput),
        { elementId: newId(), parentElementId: group(l, 'tabs').elementId, type: 'note-tab', sortOrder: 'z' },
      ],
    ],
    [
      'a widget under tabs',
      (l, f) => [
        ...l.elements.map(toInput),
        {
          elementId: newId(),
          parentElementId: group(l, 'tabs').elementId,
          type: 'value-widget-v2',
          sortOrder: 'z',
          path: (l.elements.find((e) => e.type === 'value-widget-v2') as LayoutElement).path ?? [
            { entityDefinitionId: f.companies, attributeDefinitionId: newId() },
          ],
        },
      ],
    ],
    [
      'a seventh widget',
      (l) => {
        const w = l.elements.find((e) => e.type === 'value-widget-v2') as LayoutElement;
        return [...l.elements.map(toInput), { ...toInput(w), elementId: newId(), sortOrder: 'zz' }];
      },
    ],
    [
      'an unknown attribute path',
      (l, f) => [
        ...l.elements.map(toInput),
        {
          elementId: newId(),
          parentElementId: group(l, 'widgets-v2').elementId,
          type: 'value-widget-v2',
          sortOrder: 'z',
          path: [{ entityDefinitionId: f.companies, attributeDefinitionId: newId() }],
        },
      ],
    ],
    [
      'moving the overview tab into the tabs group',
      (l) =>
        l.elements.map((e) =>
          e.type === 'overview-tab' ? { ...toInput(e), parentElementId: group(l, 'tabs').elementId } : toInput(e),
        ),
    ],
    [
      'changing a relationship tab path',
      (l, f) =>
        l.elements.map((e) =>
          e.type === 'relationship-tab'
            ? {
                ...toInput(e),
                path: [
                  { entityDefinitionId: f.people, attributeDefinitionId: e.path?.[0]?.attributeDefinitionId as string },
                ],
              }
            : toInput(e),
        ),
    ],
  ])('rejects %s', async (_label, mutate) => {
    const f = await collabFixture();
    const layout = await domain.layouts.get(f.ctx, { entityDefinitionId: 'companies' });
    // The 7th-widget case starts from a full highlights group: drop nothing, add one.
    await expect(
      domain.layouts.save(f.ctx, { customLayoutId: layout.id, elements: mutate(layout, f) }),
    ).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('keeps system element titles and moves only (D §4.1 store rules)', async () => {
    const f = await collabFixture();
    const layout = await domain.layouts.get(f.ctx, { entityDefinitionId: 'people' });
    const saved = await domain.layouts.save(f.ctx, {
      customLayoutId: layout.id,
      elements: layout.elements.map((e) =>
        e.type === 'activity-tab' ? { ...toInput(e), title: 'Hacked', sortOrder: 'zzz' } : toInput(e),
      ),
    });
    const activity = saved.elements.find((e) => e.type === 'activity-tab') as LayoutElement;
    expect(activity).toMatchObject({ title: 'Activity', sortOrder: 'zzz', isSystemElement: true });
  });
});
