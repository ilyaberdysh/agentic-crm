// Autocomplete and helper filtering (formulas.md §4.3–4.4): the word at the cursor drives the helper panel
// (`{…` searches attributes only; true/false/null/and/or never filter); function completion lists every function
// callable by name whose name *starts with* the typed prefix, alphabetically; attributes rank exact → prefix →
// word start → substring, keeping the object's attribute order within a rank.
import { AUTOCOMPLETE_FUNCTIONS, type FunctionName } from '@agentic-crm/formula';

export interface EditorQuery {
  /** `attribute` = after an unclosed `{` (attributes only); `word` = an identifier at the cursor. */
  kind: 'attribute' | 'word';
  query: string;
  /** Range of the typed text (replaced when an item is inserted): includes the `{` for attribute queries. */
  from: number;
  to: number;
}

const IGNORED_WORDS = new Set(['true', 'false', 'null', 'and', 'or']);
const WORD_CHAR = /[A-Za-z0-9_]/;

/** The query the editor drives at `pos`, or null (empty, inside a string or comment, or a keyword). */
export function editorQuery(text: string, pos: number): EditorQuery | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const before = text.slice(lineStart, pos);
  // Inside a comment or an open string: no query.
  let inString = false;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '/' && before[i + 1] === '/') return null;
  }
  if (inString) return null;
  // An unclosed `{` (attribute names may contain spaces).
  const brace = before.lastIndexOf('{');
  if (brace >= 0 && before[brace - 1] !== '_' && !/[}(),"[\]]/.test(before.slice(brace + 1))) {
    return { kind: 'attribute', query: before.slice(brace + 1), from: lineStart + brace, to: pos };
  }
  let from = pos;
  while (from > lineStart && WORD_CHAR.test(text[from - 1] as string)) from--;
  let to = pos;
  while (to < text.length && WORD_CHAR.test(text[to] as string)) to++;
  const word = text.slice(from, to);
  if (!word || /^\d/.test(word) || IGNORED_WORDS.has(word.toLowerCase())) return null;
  // A reference token `_{…}` is not a word.
  if (text[to] === '{' && word.endsWith('_')) return null;
  return { kind: 'word', query: word, from, to };
}

/** Functions offered for a typed prefix (alphabetical, prefix match, case-insensitive). */
export function functionMatches(prefix: string): FunctionName[] {
  const p = prefix.toLowerCase();
  if (!p) return [];
  return AUTOCOMPLETE_FUNCTIONS.filter((name) => name.toLowerCase().startsWith(p));
}

function rankOf(title: string, query: string): number {
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  if (t.split(/[\s›>_\-/()[\]]+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 3;
  return -1;
}

/** Items matching `query` best first (stable within a rank); an empty query keeps every item in order. */
export function rankByTitle<T>(items: readonly T[], query: string, titleOf: (item: T) => string): T[] {
  const q = query.trim();
  if (!q) return [...items];
  return items
    .map((item, index) => ({ item, index, rank: rankOf(titleOf(item), q) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}
