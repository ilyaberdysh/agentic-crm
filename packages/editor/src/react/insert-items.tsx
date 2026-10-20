// Items of the slash menu and the "+" insert menu (E editor.md §8): same seven items, same order, fuzzy filter by
// name that keeps the order. Icons are Lucide glyphs (D-17), not Attio's.
import type { Editor } from '@tiptap/core';
import { Heading1, Heading2, Heading3, Image, List, ListOrdered, type LucideIcon, Type } from 'lucide-react';
import type { InsertItemId } from './types.ts';

export interface InsertItem {
  id: InsertItemId;
  title: string;
  description: string;
  icon: LucideIcon;
}

export const INSERT_ITEMS: readonly InsertItem[] = [
  { id: 'h1', title: 'Heading 1', description: 'Large section heading', icon: Heading1 },
  { id: 'h2', title: 'Heading 2', description: 'Medium section heading', icon: Heading2 },
  { id: 'h3', title: 'Heading 3', description: 'Small section heading', icon: Heading3 },
  { id: 'body', title: 'Body', description: 'Just start typing with plain text', icon: Type },
  { id: 'ul', title: 'Bulleted list', description: 'Create a simple bulleted list', icon: List },
  { id: 'ol', title: 'Numbered list', description: 'Create a list with numbering', icon: ListOrdered },
  { id: 'image', title: 'Image', description: 'Upload an image', icon: Image },
];

/** Subsequence match ("hd2" → "Heading 2"), case-insensitive; the menu keeps its order. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (q === '') return true;
  const t = target.toLowerCase();
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

export function filterInsertItems(query: string, available: readonly InsertItemId[]): InsertItem[] {
  return INSERT_ITEMS.filter((item) => available.includes(item.id) && fuzzyMatch(query, item.title));
}

/** Turns the current block into the item's type (or starts an image upload). */
export function runInsertItem(editor: Editor, id: InsertItemId, pickImage: () => void): void {
  const chain = editor.chain().focus();
  switch (id) {
    case 'h1':
    case 'h2':
    case 'h3':
      chain.setNode('heading', { level: Number(id.slice(1)) }).run();
      return;
    case 'body':
      chain.setNode('paragraph').run();
      return;
    case 'ul':
    case 'ol':
      chain.setListItem(id).run();
      return;
    case 'image':
      chain.run();
      pickImage();
      return;
  }
}
