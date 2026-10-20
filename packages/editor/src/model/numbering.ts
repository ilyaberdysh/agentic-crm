// Numbers of numbered-list items in a flat block sequence (shared by the editor decoration, the preview and the
// markdown serialiser). A list is a run of consecutive list items; any other block ends it. Within a run, numbering
// at a depth continues across deeper items, restarts when the list type at that depth changes, and deeper levels
// restart whenever a shallower item appears (nested lists in the UI/Lexical behave the same way).

export interface NumberingItem {
  /** Block type: 'ol' / 'ul' for list items, anything else ends the run. */
  type: string;
  indent: number;
}

/** For every item: its number when it is a numbered-list item, otherwise null. */
export function listNumbers(items: readonly NumberingItem[]): Array<number | null> {
  let counters: number[] = [];
  let kinds: Array<string | undefined> = [];
  return items.map((item) => {
    if (item.type !== 'ol' && item.type !== 'ul') {
      counters = [];
      kinds = [];
      return null;
    }
    const depth = Math.max(0, item.indent);
    counters = counters.slice(0, depth + 1);
    kinds = kinds.slice(0, depth + 1);
    counters[depth] = kinds[depth] === item.type ? (counters[depth] ?? 0) + 1 : 1;
    kinds[depth] = item.type;
    return item.type === 'ol' ? (counters[depth] as number) : null;
  });
}
