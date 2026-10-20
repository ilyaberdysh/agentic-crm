// Shared e2e helpers: the seeded accounts (written by the backend stack), sign-in, documents and the editor page.
import { readFileSync } from 'node:fs';
import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test';
import { STATE_FILE, WEB_ORIGIN } from './env.ts';

export interface Account {
  email: string;
  name: string;
  memberId: string;
}

export function accounts(): { password: string; users: Account[] } {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

/** A browser context signed in as `user` (the API session cookie lands in the context). */
export async function signedInContext(browser: Browser, user: Account): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  const response = await context.request.post('/api/auth/sign-in/email', {
    headers: { origin: WEB_ORIGIN },
    data: { email: user.email, password: accounts().password },
  });
  expect(response.status(), await response.text()).toBe(200);
  return context;
}

/** A standalone workspace document with `markdown` (collab dev endpoint, through the domain). */
export async function createDocument(context: BrowserContext, markdown = ''): Promise<string> {
  const response = await context.request.post('/collab/dev/documents', {
    data: markdown ? { markdown } : {},
  });
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

export async function storedDocument(context: BrowserContext, id: string) {
  const response = await context.request.get(`/collab/dev/documents/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    markdown: string;
    version: number;
    blocks: Array<{ type: string; text: string }>;
  };
}

export interface OpenOptions {
  title?: string;
  meta?: string;
}

/** Opens the single note window on `id` and waits until the document is synced and editable. */
export async function openEditor(page: Page, id: string, options: OpenOptions = {}): Promise<void> {
  const params = new URLSearchParams({ doc: id, single: '1', projection: '0' });
  if (options.title) params.set('title', options.title);
  if (options.meta) params.set('meta', options.meta);
  await page.goto(`/?${params}`);
  await expect(page.locator('[data-editor-state="editable"]')).toBeVisible();
  // The dev page autofocuses the body once editable; wait for it so later clicks are not undone by it.
  await expect(page.getByTestId('rich-text-editor')).toBeFocused();
}

export const editorBody = (page: Page) => page.getByTestId('rich-text-editor');

/** Puts the caret at the end of the body: a click in the body area below the text (as a user would). */
export async function caretToEnd(page: Page): Promise<void> {
  const root = page.locator('[data-editor-state]');
  const box = await root.boundingBox();
  if (!box) throw new Error('no editor root');
  await page.mouse.click(box.x + 20, box.y + box.height - 8);
}

/** Bounding box of the first occurrence of `word` in the editor body. */
export async function wordBox(page: Page, word: string) {
  return page.evaluate((w) => {
    const root = document.querySelector('[data-testid="rich-text-editor"]');
    if (!root) throw new Error('no editor');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(w) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + w.length);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    throw new Error(`word ${w} not found`);
  }, word);
}

/** Selects `word` with a mouse double-click (the selection toolbar only follows pointer selections). */
export async function selectWord(page: Page, word: string): Promise<void> {
  const box = await wordBox(page, word);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}
