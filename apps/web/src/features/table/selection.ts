// Row selection over the shown snapshot as zebra edges (C1 README §3.5, internal-api-shapes §3): checkbox toggles,
// shift-click ranges from the anchor, shift+↑/↓ group selection from the active row, select to top/bottom, select
// all ([0, total] — every matching record, loaded or not). Pure reducers; the table keeps the state.
import { zebraContains, zebraSize, zebraToggle, zebraUnion } from '@agentic-crm/contracts';

export interface RowSelection {
  edges: number[];
  /** Last row toggled by click: the start of a shift-click range. */
  anchor: number | null;
}

export const emptySelection: RowSelection = { edges: [], anchor: null };

export type SelectionAction =
  | { type: 'toggle'; index: number }
  | { type: 'range'; index: number }
  | { type: 'add'; from: number; to: number }
  | { type: 'all'; total: number }
  | { type: 'clear' };

export function selectionReducer(state: RowSelection, action: SelectionAction): RowSelection {
  switch (action.type) {
    case 'toggle':
      return { edges: zebraToggle(state.edges, action.index), anchor: action.index };
    case 'range': {
      const anchor = state.anchor ?? action.index;
      const lo = Math.min(anchor, action.index);
      const hi = Math.max(anchor, action.index);
      return { edges: zebraUnion(state.edges, [lo, hi + 1]), anchor };
    }
    case 'add': {
      const lo = Math.min(action.from, action.to);
      const hi = Math.max(action.from, action.to);
      return { edges: zebraUnion(state.edges, [lo, hi + 1]), anchor: state.anchor ?? action.from };
    }
    case 'all':
      return action.total > 0 ? { edges: [0, action.total], anchor: null } : emptySelection;
    case 'clear':
      return state.edges.length === 0 ? state : emptySelection;
  }
}

export function isSelected(selection: RowSelection, index: number): boolean {
  return zebraContains(selection.edges, index);
}

export function selectedCount(selection: RowSelection): number {
  return zebraSize(selection.edges);
}

/** Header checkbox state. */
export function headerState(selection: RowSelection, total: number): 'none' | 'some' | 'all' {
  const n = selectedCount(selection);
  if (n === 0) return 'none';
  return n >= total ? 'all' : 'some';
}

/** Splits a selection into consecutive selections of at most `maxRows` rows each (bulk calls with progress). */
export function sliceZebra(edges: readonly number[], maxRows: number): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let size = 0;
  for (let i = 0; i < edges.length; i += 2) {
    let s = edges[i] as number;
    const e = edges[i + 1] as number;
    while (s < e) {
      const take = Math.min(e - s, maxRows - size);
      current.push(s, s + take);
      size += take;
      s += take;
      if (size === maxRows) {
        out.push(current);
        current = [];
        size = 0;
      }
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}
