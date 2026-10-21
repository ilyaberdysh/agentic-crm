// Table keyboard model: arrows move the active cell,
// ⌘↑/⌘↓ jump to top/bottom, Home/End to the first/last column (⌘ also to the first/last row), PageUp/PageDown by a
// screen, Tab/⇧Tab next/previous cell (wrapping rows), ⇧␣ toggles the row, ⇧↑/⇧↓ group-select rows, ⌘⇧↑/⌘⇧↓ select to
// top/bottom, ⌘A selects all, ⌘↩ opens the record, ↩ edits, a printable key opens the editor with that key, ⌫/Del
// clears the value. Pure: the table applies the returned action. Column -1 is the record column.

export interface CellPos {
  row: number;
  col: number;
}

export type GridAction =
  | { type: 'move'; to: CellPos }
  | { type: 'select-rows'; from: number; to: number; move: CellPos }
  | { type: 'toggle-row'; row: number }
  | { type: 'select-all' }
  | { type: 'edit'; initialKey?: string }
  | { type: 'open-record' }
  | { type: 'clear-value' }
  | { type: 'escape' };

export interface KeyInput {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface GridShape {
  active: CellPos | null;
  rows: number;
  /** Data columns (the record column is -1 and always exists). */
  cols: number;
  /** Rows per screen for PageUp/PageDown. */
  page: number;
  apple: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function gridAction(e: KeyInput, g: GridShape): GridAction | null {
  if (g.rows === 0) return null;
  const mod = g.apple ? e.metaKey : e.ctrlKey;
  const lastRow = g.rows - 1;
  const lastCol = g.cols - 1;
  const a = g.active;
  if (!a) {
    // Nothing active yet: arrows / Tab start at the first cell.
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'].includes(e.key)) {
      return { type: 'move', to: { row: 0, col: g.cols > 0 ? 0 : -1 } };
    }
    if (mod && !e.altKey && e.key.toLowerCase() === 'a') return { type: 'select-all' };
    return null;
  }
  const at = (row: number, col: number): GridAction => ({
    type: 'move',
    to: { row: clamp(row, 0, lastRow), col: clamp(col, -1, lastCol) },
  });

  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown': {
      const down = e.key === 'ArrowDown';
      if (mod && e.shiftKey) {
        return down
          ? { type: 'select-rows', from: a.row, to: lastRow, move: { row: lastRow, col: a.col } }
          : { type: 'select-rows', from: 0, to: a.row, move: { row: 0, col: a.col } };
      }
      if (mod) return at(down ? lastRow : 0, a.col);
      const row = clamp(a.row + (down ? 1 : -1), 0, lastRow);
      if (e.shiftKey) return { type: 'select-rows', from: a.row, to: row, move: { row, col: a.col } };
      return at(row, a.col);
    }
    case 'ArrowLeft':
      return mod ? at(a.row, -1) : at(a.row, a.col - 1);
    case 'ArrowRight':
      return mod ? at(a.row, lastCol) : at(a.row, a.col + 1);
    case 'Home':
      return mod ? at(0, -1) : at(a.row, -1);
    case 'End':
      return mod ? at(lastRow, lastCol) : at(a.row, lastCol);
    case 'PageUp':
      return at(a.row - Math.max(1, g.page), a.col);
    case 'PageDown':
      return at(a.row + Math.max(1, g.page), a.col);
    case 'Tab': {
      if (e.shiftKey) {
        if (a.col > -1) return at(a.row, a.col - 1);
        return a.row > 0 ? at(a.row - 1, lastCol) : at(0, -1);
      }
      if (a.col < lastCol) return at(a.row, a.col + 1);
      return a.row < lastRow ? at(a.row + 1, -1) : at(lastRow, lastCol);
    }
    case 'Enter':
      if (mod) return { type: 'open-record' };
      return { type: 'edit' };
    case 'Escape':
      return { type: 'escape' };
    case 'Backspace':
    case 'Delete':
      return mod || e.altKey ? null : { type: 'clear-value' };
    case ' ':
      if (e.shiftKey) return { type: 'toggle-row', row: a.row };
      break;
  }
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'a') return { type: 'select-all' };
  // Printable character (no command modifier) opens the editor with that key.
  if (e.key.length === 1 && !mod && !e.altKey && !(e.ctrlKey || e.metaKey)) {
    if (e.key === ' ' && e.shiftKey) return null;
    return { type: 'edit', initialKey: e.key };
  }
  return null;
}
