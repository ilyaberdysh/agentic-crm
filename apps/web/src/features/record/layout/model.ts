// Record page layout model (BACKLOG 3.01, 3.10; D README §2.2–2.5, §2.8, §4.1). The server stores one flat element
// list per object: six locked groups, their elements and child elements, each ordered by a fractional `sortOrder`
// among its siblings. This module resolves that list into what the page renders (tabs, highlight widgets, header
// actions, sidebar sections) and implements the layout editor's store rules (ConfigureRecordPageStore, D §4.1):
// system elements only move, locked/system elements cannot be removed, removing an element removes its children, at
// least one Record Details section, at most 6 widgets, unique tab slugs ("-N"). "Save changes" sends the full list.
import {
  type CustomLayout,
  type LayoutElement,
  type LayoutElementInput,
  type LayoutElementType,
  type LayoutGroupIdentifier,
  MAX_LAYOUT_WIDGETS,
  type Path,
  rankBetween,
  rankSequence,
} from '@agentic-crm/contracts';

export type TabKind =
  | 'overview'
  | 'activity'
  | 'agent'
  | 'notes'
  | 'tasks'
  | 'emails'
  | 'calls'
  | 'files'
  | 'relationship';

const TAB_KIND: Partial<Record<LayoutElementType, TabKind>> = {
  'overview-tab': 'overview',
  'activity-tab': 'activity',
  'agent-tab': 'agent',
  'note-tab': 'notes',
  'task-tab': 'tasks',
  'email-tab': 'emails',
  'call-tab': 'calls',
  'file-tab': 'files',
  'relationship-tab': 'relationship',
};

const DEFAULT_TAB_TITLE: Record<TabKind, string> = {
  overview: 'Overview',
  activity: 'Activity',
  agent: 'Agent',
  notes: 'Notes',
  tasks: 'Tasks',
  emails: 'Emails',
  calls: 'Calls',
  files: 'Files',
  relationship: 'Related records',
};

export interface ResolvedTab {
  element: LayoutElement;
  kind: TabKind;
  /** The `$activeTab` URL segment. */
  slug: string;
  title: string;
  /** Email sources / relationship columns. */
  children: LayoutElement[];
}

export interface ResolvedSection {
  element: LayoutElement;
  /** Attribute rows chosen for a `details` section (empty = the first five attributes). */
  values: LayoutElement[];
}

export interface ResolvedLayout {
  widgets: LayoutElement[];
  overview: ResolvedTab | null;
  /** Configurable tabs after the divider, in order. */
  tabs: ResolvedTab[];
  /** Overview first, then `tabs` (⌥←/→ order). */
  allTabs: ResolvedTab[];
  actions: LayoutElement[];
  sections: ResolvedSection[];
}

const bySortOrder = (a: LayoutElement, b: LayoutElement) =>
  a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : a.elementId < b.elementId ? -1 : 1;

/** Children of an element (or the root groups for `null`), in sort order. */
export function childrenOf(elements: readonly LayoutElement[], parentId: string | null): LayoutElement[] {
  return elements.filter((e) => e.parentElementId === parentId).sort(bySortOrder);
}

export function groupElement(
  elements: readonly LayoutElement[],
  identifier: LayoutGroupIdentifier,
): LayoutElement | undefined {
  return elements.find((e) => e.type === 'group' && e.groupIdentifier === identifier);
}

export function groupChildren(elements: readonly LayoutElement[], identifier: LayoutGroupIdentifier): LayoutElement[] {
  const group = groupElement(elements, identifier);
  return group ? childrenOf(elements, group.elementId) : [];
}

export function tabKindOf(type: LayoutElementType): TabKind | null {
  return TAB_KIND[type] ?? null;
}

function resolveTab(elements: readonly LayoutElement[], element: LayoutElement): ResolvedTab | null {
  const kind = tabKindOf(element.type);
  if (!kind) return null;
  return {
    element,
    kind,
    slug: element.slug ?? kind,
    title: element.title?.trim() || DEFAULT_TAB_TITLE[kind],
    children: childrenOf(elements, element.elementId),
  };
}

export function resolveLayout(layout: Pick<CustomLayout, 'elements'>): ResolvedLayout {
  const els = layout.elements;
  const overviewEl = groupChildren(els, 'static-tabs').find((e) => e.type === 'overview-tab');
  const overview = overviewEl ? resolveTab(els, overviewEl) : null;
  const tabs = groupChildren(els, 'tabs')
    .map((e) => resolveTab(els, e))
    .filter((t): t is ResolvedTab => t !== null);
  const sections = groupChildren(els, 'details-sidebar')
    .filter((e) => e.type === 'details' || e.type === 'detail-list-entries')
    .map((element) => ({ element, values: element.type === 'details' ? childrenOf(els, element.elementId) : [] }));
  return {
    widgets: groupChildren(els, 'widgets-v2').filter((e) => e.type === 'value-widget-v2'),
    overview,
    tabs,
    allTabs: overview ? [overview, ...tabs] : tabs,
    actions: groupChildren(els, 'actions'),
    sections,
  };
}

/** The tab for a `$activeTab` segment; null when unknown (the page then replaces the URL with `overview`). */
export function findTab(layout: ResolvedLayout, slug: string | undefined): ResolvedTab | null {
  if (!slug) return null;
  return layout.allTabs.find((t) => t.slug === slug) ?? null;
}

/** ⌥→ / ⌥←: the next / previous tab, wrapping around (D §3.11). */
export function adjacentTab(layout: ResolvedLayout, slug: string, delta: 1 | -1): ResolvedTab | null {
  const tabs = layout.allTabs;
  if (tabs.length === 0) return null;
  const i = tabs.findIndex((t) => t.slug === slug);
  const next = i < 0 ? 0 : (i + delta + tabs.length) % tabs.length;
  return tabs[next] ?? null;
}

/** First attribute id of a path (the attribute on the page's own object). */
export function pathHead(path: Path | null | undefined): string | null {
  return path?.[0]?.attributeDefinitionId ?? null;
}

// ---- editor store ---------------------------------------------------------------------------------------------------

export class LayoutRuleError extends Error {}

function siblingsOf(elements: readonly LayoutElement[], element: LayoutElement): LayoutElement[] {
  return childrenOf(elements, element.parentElementId);
}

function replace(elements: readonly LayoutElement[], next: LayoutElement): LayoutElement[] {
  return elements.map((e) => (e.elementId === next.elementId ? next : e));
}

/** Moves an element one step among its siblings (tab "Move left / Move right"). No-op at the ends. */
export function moveSibling(elements: readonly LayoutElement[], elementId: string, delta: 1 | -1): LayoutElement[] {
  const el = elements.find((e) => e.elementId === elementId);
  if (!el) return [...elements];
  const sibs = siblingsOf(elements, el);
  const i = sibs.findIndex((s) => s.elementId === elementId);
  const j = i + delta;
  if (j < 0 || j >= sibs.length) return [...elements];
  // New rank between the neighbour we jump over and the one beyond it.
  const before = delta > 0 ? (sibs[j] as LayoutElement).sortOrder : (sibs[j - 1]?.sortOrder ?? null);
  const after = delta > 0 ? (sibs[j + 1]?.sortOrder ?? null) : (sibs[j] as LayoutElement).sortOrder;
  return replace(elements, { ...el, sortOrder: rankBetween(before, after) });
}

/** Reorders the children of `parentId` to `orderedIds` (drag and drop); new ranks only for elements that moved. */
export function reorderChildren(
  elements: readonly LayoutElement[],
  parentId: string,
  orderedIds: readonly string[],
): LayoutElement[] {
  const current = childrenOf(elements, parentId);
  if (current.map((e) => e.elementId).join() === orderedIds.join()) return [...elements];
  const byId = new Map(current.map((e) => [e.elementId, e]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter((e): e is LayoutElement => e !== undefined);
  const ranks = rankSequence(ordered.length);
  const next = new Map(ordered.map((e, i) => [e.elementId, { ...e, sortOrder: ranks[i] as string }]));
  return elements.map((e) => next.get(e.elementId) ?? e);
}

export function canRemove(elements: readonly LayoutElement[], elementId: string): boolean {
  const el = elements.find((e) => e.elementId === elementId);
  if (!el || el.isLocked || el.isSystemElement) return false;
  if (el.type === 'details') return elements.filter((e) => e.type === 'details').length > 1;
  return true;
}

/** Removes an element and everything below it. */
export function removeElement(elements: readonly LayoutElement[], elementId: string): LayoutElement[] {
  if (!canRemove(elements, elementId)) {
    const el = elements.find((e) => e.elementId === elementId);
    throw new LayoutRuleError(
      el?.type === 'details' ? 'You must have at least one record details section' : 'This element cannot be removed',
    );
  }
  const doomed = new Set([elementId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of elements) {
      if (e.parentElementId && doomed.has(e.parentElementId) && !doomed.has(e.elementId)) {
        doomed.add(e.elementId);
        grew = true;
      }
    }
  }
  return elements.filter((e) => !doomed.has(e.elementId));
}

export interface NewElement {
  elementId: string;
  type: LayoutElementType;
  title?: string | null;
  slug?: string | null;
  path?: Path | null;
  field?: string | null;
}

/** Appends an element after its last sibling (new widgets, tabs, sections, section attributes). */
export function addElement(
  elements: readonly LayoutElement[],
  parentId: string,
  input: NewElement,
  now: string = new Date().toISOString(),
): LayoutElement[] {
  const sibs = childrenOf(elements, parentId);
  if (
    input.type === 'value-widget-v2' &&
    sibs.filter((e) => e.type === 'value-widget-v2').length >= MAX_LAYOUT_WIDGETS
  ) {
    throw new LayoutRuleError("You've reached the limit. Remove a widget to add a new one");
  }
  const last = sibs[sibs.length - 1];
  const slug =
    input.slug === undefined || input.slug === null ? null : uniqueSlug(elements, input.slug, input.elementId);
  const el: LayoutElement = {
    elementId: input.elementId,
    parentElementId: parentId,
    type: input.type,
    groupIdentifier: null,
    title: input.title ?? null,
    slug,
    sortOrder: rankBetween(last?.sortOrder ?? null, null),
    isLocked: false,
    isSystemElement: false,
    path: input.path ?? null,
    field: input.field ?? null,
    createdAt: now,
  };
  return [...elements, el];
}

export function updateElement(
  elements: readonly LayoutElement[],
  elementId: string,
  patch: Partial<Pick<LayoutElement, 'title' | 'slug' | 'path' | 'field'>>,
): LayoutElement[] {
  const el = elements.find((e) => e.elementId === elementId);
  if (!el) return [...elements];
  if ((el.isSystemElement || el.isLocked) && Object.keys(patch).length > 0) {
    throw new LayoutRuleError('System elements can only be moved');
  }
  return replace(elements, { ...el, ...patch });
}

/** Replaces the attribute rows of a details section (Edit section dialog "Attributes to show"). */
export function setSectionAttributes(
  elements: readonly LayoutElement[],
  sectionId: string,
  paths: readonly Path[],
  newId: () => string,
  now?: string,
): LayoutElement[] {
  const existing = childrenOf(elements, sectionId);
  const keep = new Map(existing.map((e) => [JSON.stringify(e.path), e]));
  let out = elements.filter((e) => e.parentElementId !== sectionId);
  const ranks = rankSequence(paths.length);
  for (const [i, path] of paths.entries()) {
    const reuse = keep.get(JSON.stringify(path));
    const sortOrder = ranks[i] as string;
    if (reuse) out = [...out, { ...reuse, sortOrder }];
    else
      out = [
        ...out,
        {
          elementId: newId(),
          parentElementId: sectionId,
          type: 'details-value',
          groupIdentifier: null,
          title: null,
          slug: null,
          sortOrder,
          isLocked: false,
          isSystemElement: false,
          path: [...path],
          field: null,
          createdAt: now ?? new Date().toISOString(),
        },
      ];
  }
  return out;
}

/** A slug not used by another element ("emails", "emails-1", …). */
export function uniqueSlug(elements: readonly LayoutElement[], base: string, selfId?: string): string {
  const taken = new Set(elements.filter((e) => e.elementId !== selfId && e.slug).map((e) => e.slug as string));
  let slug = base;
  for (let i = 1; taken.has(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export function widgetCount(elements: readonly LayoutElement[]): number {
  return groupChildren(elements, 'widgets-v2').filter((e) => e.type === 'value-widget-v2').length;
}

/** The save payload: the full element list (removed elements are simply omitted, D §5). */
export function toSaveElements(elements: readonly LayoutElement[]): LayoutElementInput[] {
  return [...elements].sort(bySortOrder).map((e) => ({
    elementId: e.elementId,
    parentElementId: e.parentElementId,
    type: e.type,
    groupIdentifier: e.groupIdentifier,
    title: e.title,
    slug: e.slug,
    sortOrder: e.sortOrder,
    path: e.path,
    field: e.field,
  }));
}

/** Whether the editor's working copy differs from the saved layout (shows the dirty bar). */
export function isDirty(saved: readonly LayoutElement[], working: readonly LayoutElement[]): boolean {
  const key = (els: readonly LayoutElement[]) => JSON.stringify(toSaveElements(els));
  return key(saved) !== key(working);
}
