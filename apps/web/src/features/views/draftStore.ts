// Session-scoped view drafts (C1 README §3.1, CROSS-DOMAIN B.20): unsaved filter and sort edits per view live in memory
// for the lifetime of the tab — they survive in-app navigation, are cleared by "Discard changes" and by saving, and a
// reload reverts to the saved view (Attio persists drafts nowhere). Column edits are not drafts: they are saved at once,
// and only their in-flight optimistic operations are tracked here so the grid shows them before the server answers.
// An external store (subscribe / get) consumed through useSyncExternalStore.
import type { Sort } from '@agentic-crm/contracts';
import type { PendingColumnOp } from './columns';
import type { FilterModel } from './filterModel';
import type { FilterAst } from './types';

/**
 * A drafted filter: an AST set from outside (`setFilter`), or the editing model of the filter bar together with the AST
 * of its complete conditions (built by the editor, which has the schema at hand).
 */
export type FilterDraft = { kind: 'ast'; ast: FilterAst } | { kind: 'model'; model: FilterModel; ast: FilterAst };

export interface ViewDraftState {
  filter?: FilterDraft;
  sorts?: Sort[];
  columnOps: readonly PendingColumnOp[];
  /** UI hand-off: the filter bar opens this condition's operator menu (header menu "Filter"). */
  focusConditionId?: string;
}

const EMPTY: ViewDraftState = Object.freeze({ columnOps: Object.freeze([]) as readonly PendingColumnOp[] });

type Listener = () => void;

export class ViewDraftStore {
  private readonly states = new Map<string, ViewDraftState>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly anyListeners = new Set<Listener>();

  /** Current state of a view (a stable reference until it changes). */
  get(viewId: string): ViewDraftState {
    return this.states.get(viewId) ?? EMPTY;
  }

  subscribe(viewId: string, listener: Listener): () => void {
    let set = this.listeners.get(viewId);
    if (!set) {
      set = new Set();
      this.listeners.set(viewId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(viewId);
    };
  }

  /** Any change of any view (the view switcher marks views with drafts). */
  subscribeAll(listener: Listener): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  /** Views that currently hold a filter or sort draft. */
  draftedViewIds(): string[] {
    return [...this.states.entries()].filter(([, s]) => s.filter || s.sorts).map(([id]) => id);
  }

  private update(viewId: string, fn: (prev: ViewDraftState) => ViewDraftState): void {
    const prev = this.get(viewId);
    const next = fn(prev);
    if (next === prev) return;
    if (!next.filter && !next.sorts && next.columnOps.length === 0 && !next.focusConditionId)
      this.states.delete(viewId);
    else this.states.set(viewId, next);
    for (const l of this.listeners.get(viewId) ?? []) l();
    for (const l of this.anyListeners) l();
  }

  setFilterAst(viewId: string, ast: FilterAst): void {
    this.update(viewId, (s) => ({ ...s, filter: { kind: 'ast', ast } }));
  }

  setFilterModel(viewId: string, model: FilterModel, ast: FilterAst): void {
    this.update(viewId, (s) => ({ ...s, filter: { kind: 'model', model, ast } }));
  }

  setSorts(viewId: string, sorts: Sort[]): void {
    this.update(viewId, (s) => ({ ...s, sorts }));
  }

  /** "Discard changes": drops the filter and sort drafts (no request, no confirmation; C1 §3.1). */
  discard(viewId: string): void {
    this.update(viewId, (s) => (s.filter || s.sorts || s.focusConditionId ? { columnOps: s.columnOps } : s));
  }

  /** Drops only the parts that were saved (a newer edit made while saving stays a draft). */
  clearSaved(viewId: string, saved: { filter?: FilterDraft; sorts?: Sort[] }): void {
    this.update(viewId, (s) => {
      const next: ViewDraftState = { ...s };
      if (saved.filter && s.filter === saved.filter) delete next.filter;
      if (saved.sorts && s.sorts === saved.sorts) delete next.sorts;
      return next.filter === s.filter && next.sorts === s.sorts ? s : next;
    });
  }

  /** Restores drafts after a failed save. */
  restore(viewId: string, drafts: { filter?: FilterDraft; sorts?: Sort[] }): void {
    this.update(viewId, (s) => ({
      ...s,
      ...(drafts.filter && !s.filter ? { filter: drafts.filter } : {}),
      ...(drafts.sorts && !s.sorts ? { sorts: drafts.sorts } : {}),
    }));
  }

  addColumnOp(viewId: string, op: PendingColumnOp): void {
    this.update(viewId, (s) => ({ ...s, columnOps: [...s.columnOps, op] }));
  }

  removeColumnOp(viewId: string, opId: string): void {
    this.update(viewId, (s) =>
      s.columnOps.some((o) => o.id === opId) ? { ...s, columnOps: s.columnOps.filter((o) => o.id !== opId) } : s,
    );
  }

  setFocus(viewId: string, conditionId: string | undefined): void {
    this.update(viewId, (s) => (s.focusConditionId === conditionId ? s : { ...s, focusConditionId: conditionId }));
  }

  /** Sign-out / tests. */
  clear(): void {
    const ids = [...this.states.keys()];
    this.states.clear();
    for (const id of ids) for (const l of this.listeners.get(id) ?? []) l();
    for (const l of this.anyListeners) l();
  }
}

/** The tab's draft store. */
export const viewDrafts = new ViewDraftStore();

export function clearViewDrafts(): void {
  viewDrafts.clear();
}
