import type { LayoutElement, LayoutElementType, LayoutGroupIdentifier } from '@agentic-crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  addElement,
  adjacentTab,
  canRemove,
  childrenOf,
  findTab,
  groupChildren,
  isDirty,
  LayoutRuleError,
  moveSibling,
  removeElement,
  reorderChildren,
  resolveLayout,
  setSectionAttributes,
  toSaveElements,
  uniqueSlug,
  updateElement,
  widgetCount,
} from './model';

const DEF = '00000000-0000-7000-8000-00000000d0f0';
let n = 0;
const id = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
const NOW = '2026-10-13T00:00:00.000Z';

function el(
  type: LayoutElementType,
  parent: string | null,
  sortOrder: string,
  extra: Partial<LayoutElement> = {},
): LayoutElement {
  return {
    elementId: id(),
    parentElementId: parent,
    type,
    groupIdentifier: null,
    title: null,
    slug: null,
    sortOrder,
    isLocked: false,
    isSystemElement: false,
    path: null,
    field: null,
    createdAt: NOW,
    ...extra,
  };
}

const group = (identifier: LayoutGroupIdentifier, sortOrder: string) =>
  el('group', null, sortOrder, { groupIdentifier: identifier, isLocked: true, isSystemElement: true });

/** A company-like default layout, elements deliberately out of order. */
function fixture() {
  n = 0;
  const widgets = group('widgets-v2', '1');
  const statics = group('static-tabs', '2');
  const tabs = group('tabs', '3');
  const actions = group('actions', '4');
  const sidebar = group('details-sidebar', '5');
  const path = (a: string) => [{ entityDefinitionId: DEF, attributeDefinitionId: a }];
  const team = el('relationship-tab', tabs.elementId, 'p', { title: 'Team', slug: 'team', path: path(id()) });
  const elements = [
    el('file-tab', tabs.elementId, 'w', { title: 'Files', slug: 'files' }),
    el('agent-tab', tabs.elementId, 'z', { title: 'Agent', slug: 'agent', isSystemElement: true }),
    team,
    el('relationship-tab-value', team.elementId, 'i', { path: path(id()) }),
    el('activity-tab', tabs.elementId, 'd', { title: 'Activity', slug: 'activity', isSystemElement: true }),
    el('note-tab', tabs.elementId, 'r', { title: 'Notes', slug: 'notes', isSystemElement: true }),
    el('overview-tab', statics.elementId, 'i', {
      title: 'Overview',
      slug: 'overview',
      isLocked: true,
      isSystemElement: true,
    }),
    el('value-widget-v2', widgets.elementId, 'n', { path: path('a2') }),
    el('value-widget-v2', widgets.elementId, 'd', { path: path('a1') }),
    el('email-action', actions.elementId, 'i', { isLocked: true, isSystemElement: true }),
    el('details', sidebar.elementId, 'i', { title: 'Record Details' }),
    el('detail-list-entries', sidebar.elementId, 'r', { title: 'Lists', isLocked: true, isSystemElement: true }),
    widgets,
    statics,
    tabs,
    actions,
    sidebar,
  ];
  return { elements, widgets, tabs, sidebar, team };
}

describe('resolveLayout', () => {
  it('orders children by rank and splits the groups', () => {
    const { elements } = fixture();
    const layout = resolveLayout({ elements });
    expect(layout.overview?.slug).toBe('overview');
    expect(layout.tabs.map((t) => t.slug)).toEqual(['activity', 'team', 'notes', 'files', 'agent']);
    expect(layout.allTabs[0]?.kind).toBe('overview');
    expect(layout.tabs[1]?.kind).toBe('relationship');
    expect(layout.tabs[1]?.children).toHaveLength(1);
    expect(layout.tabs.find((tab) => tab.kind === 'agent')).toMatchObject({ slug: 'agent', title: 'Agent' });
    expect(layout.widgets.map((w) => w.path?.[0]?.attributeDefinitionId)).toEqual(['a1', 'a2']);
    expect(layout.sections.map((s) => s.element.type)).toEqual(['details', 'detail-list-entries']);
    expect(layout.actions.map((a) => a.type)).toEqual(['email-action']);
  });

  it('finds tabs by slug and moves through them with wrap-around (⌥←/→)', () => {
    const layout = resolveLayout({ elements: fixture().elements });
    expect(findTab(layout, 'notes')?.title).toBe('Notes');
    expect(findTab(layout, 'nope')).toBeNull();
    expect(findTab(layout, undefined)).toBeNull();
    expect(adjacentTab(layout, 'overview', 1)?.slug).toBe('activity');
    expect(adjacentTab(layout, 'agent', 1)?.slug).toBe('overview');
    expect(adjacentTab(layout, 'overview', -1)?.slug).toBe('agent');
  });
});

describe('editor store rules', () => {
  it('moves a tab left / right between its neighbours and is a no-op at the ends', () => {
    const { elements } = fixture();
    const notes = elements.find((e) => e.slug === 'notes') as LayoutElement;
    const left = resolveLayout({ elements: moveSibling(elements, notes.elementId, -1) });
    expect(left.tabs.map((t) => t.slug)).toEqual(['activity', 'notes', 'team', 'files', 'agent']);
    const right = resolveLayout({ elements: moveSibling(elements, notes.elementId, 1) });
    expect(right.tabs.map((t) => t.slug)).toEqual(['activity', 'team', 'files', 'notes', 'agent']);
    const agent = elements.find((e) => e.slug === 'agent') as LayoutElement;
    expect(moveSibling(elements, agent.elementId, 1)).toEqual(elements);
  });

  it('reorders children with fresh ranks', () => {
    const { elements, tabs } = fixture();
    const ids = childrenOf(elements, tabs.elementId).map((e) => e.elementId);
    const next = reorderChildren(elements, tabs.elementId, [...ids].reverse());
    expect(childrenOf(next, tabs.elementId).map((e) => e.slug)).toEqual([
      'agent',
      'files',
      'notes',
      'team',
      'activity',
    ]);
  });

  it('removes an element with its children; never system / locked elements or the last details section', () => {
    const { elements, team } = fixture();
    const next = removeElement(elements, team.elementId);
    expect(next.some((e) => e.elementId === team.elementId || e.parentElementId === team.elementId)).toBe(false);
    const activity = elements.find((e) => e.slug === 'activity') as LayoutElement;
    expect(canRemove(elements, activity.elementId)).toBe(false);
    expect(() => removeElement(elements, activity.elementId)).toThrow(LayoutRuleError);
    const agent = elements.find((e) => e.slug === 'agent') as LayoutElement;
    expect(canRemove(elements, agent.elementId)).toBe(false);
    const details = elements.find((e) => e.type === 'details') as LayoutElement;
    expect(() => removeElement(elements, details.elementId)).toThrow(
      'You must have at least one record details section',
    );
  });

  it('adds widgets up to six, after the last sibling', () => {
    const { elements, widgets } = fixture();
    let next = elements;
    for (let i = 0; i < 4; i++)
      next = addElement(next, widgets.elementId, { elementId: id(), type: 'value-widget-v2' }, NOW);
    expect(widgetCount(next)).toBe(6);
    expect((groupChildren(next, 'widgets-v2').at(-1)?.sortOrder ?? '') > 'n').toBe(true);
    expect(() => addElement(next, widgets.elementId, { elementId: id(), type: 'value-widget-v2' })).toThrow(
      "You've reached the limit. Remove a widget to add a new one",
    );
  });

  it('keeps tab slugs unique with a -N suffix', () => {
    const { elements, tabs } = fixture();
    expect(uniqueSlug(elements, 'files')).toBe('files-1');
    const next = addElement(elements, tabs.elementId, { elementId: id(), type: 'email-tab', slug: 'emails' });
    const again = addElement(next, tabs.elementId, { elementId: id(), type: 'email-tab', slug: 'emails' });
    expect(
      resolveLayout({ elements: again })
        .tabs.map((t) => t.slug)
        .slice(-2),
    ).toEqual(['emails', 'emails-1']);
  });

  it('system elements only move; editable ones rename', () => {
    const { elements, team } = fixture();
    const activity = elements.find((e) => e.slug === 'activity') as LayoutElement;
    expect(() => updateElement(elements, activity.elementId, { title: 'Feed' })).toThrow(LayoutRuleError);
    const renamed = updateElement(elements, team.elementId, { title: 'People' });
    expect(renamed.find((e) => e.elementId === team.elementId)?.title).toBe('People');
  });

  it('replaces the attributes of a details section, keeping rows that stay', () => {
    const { elements } = fixture();
    const details = elements.find((e) => e.type === 'details') as LayoutElement;
    const p = (a: string) => [{ entityDefinitionId: DEF, attributeDefinitionId: a }];
    const one = setSectionAttributes(elements, details.elementId, [p('x'), p('y')], id, NOW);
    const kept = childrenOf(one, details.elementId);
    expect(kept.map((e) => e.path?.[0]?.attributeDefinitionId)).toEqual(['x', 'y']);
    const two = setSectionAttributes(one, details.elementId, [p('y'), p('z')], id, NOW);
    const rows = childrenOf(two, details.elementId);
    expect(rows.map((e) => e.path?.[0]?.attributeDefinitionId)).toEqual(['y', 'z']);
    expect(rows[0]?.elementId).toBe(kept[1]?.elementId);
    expect(rows.every((r) => r.type === 'details-value')).toBe(true);
  });

  it('builds the full-replace payload and detects changes', () => {
    const { elements, team } = fixture();
    const payload = toSaveElements(elements);
    expect(payload).toHaveLength(elements.length);
    expect(payload[0]).not.toHaveProperty('isLocked');
    expect(isDirty(elements, [...elements].reverse())).toBe(false);
    expect(isDirty(elements, updateElement(elements, team.elementId, { title: 'X' }))).toBe(true);
  });
});
