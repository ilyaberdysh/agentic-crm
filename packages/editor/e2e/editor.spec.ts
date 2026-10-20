// Two browsers (Ada, Grace) on one document through the real collab server: typing converges, each sees the other's
// caret with a name pill and both avatars, the body survives a reload and the server projection (markdown) follows.
// Plus the editor behaviours of E editor.md: markdown shortcuts, slash menu, mentions, toolbar formatting, lists.
import { expect, test } from '@playwright/test';
import {
  accounts,
  caretToEnd,
  createDocument,
  editorBody,
  openEditor,
  selectWord,
  signedInContext,
  storedDocument,
} from './support.ts';

test('two users see each other’s text, carets and avatars; the body persists and is projected', async ({ browser }) => {
  const [ada, grace] = accounts().users;
  if (!ada || !grace) throw new Error('missing accounts');
  const contextA = await signedInContext(browser, ada);
  const contextB = await signedInContext(browser, grace);
  const id = await createDocument(contextA, '# Shared notes');
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  await openEditor(pageA, id);
  await openEditor(pageB, id);

  await caretToEnd(pageA);
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type('Hello from Ada');
  await expect(editorBody(pageB)).toContainText('Hello from Ada');

  await caretToEnd(pageB);
  await pageB.keyboard.press('Enter');
  await pageB.keyboard.type('Reply from Grace');
  await expect(editorBody(pageA)).toContainText('Reply from Grace');

  // Remote carets with the peer's name (server-asserted identity) and one avatar per user.
  await expect(pageA.locator('.collaboration-carets__label', { hasText: 'Grace Hopper' })).toBeVisible();
  await expect(pageB.locator('.collaboration-carets__label', { hasText: 'Ada Lovelace' })).toBeVisible();
  await expect(pageA.getByTestId('presence-avatars').locator('[data-user]')).toHaveCount(2);
  await expect(pageB.getByTestId('presence-avatars').locator('[data-user]')).toHaveCount(2);

  // A remote selection is drawn in the peer colour.
  await selectWord(pageA, 'Hello');
  await expect(pageB.locator('.collaboration-carets__selection').first()).toBeVisible();

  // Persisted (debounced) and projected for search / API / previews.
  await expect
    .poll(async () => (await storedDocument(contextA, id)).markdown, { timeout: 10_000 })
    .toBe('# Shared notes\nHello from Ada\nReply from Grace');
  await pageB.reload();
  await expect(pageB.locator('[data-editor-state="editable"]')).toBeVisible();
  await expect(editorBody(pageB)).toContainText('Reply from Grace');

  await contextA.close();
  await contextB.close();
});

test('markdown shortcuts, slash menu, mentions and the selection toolbar write Attio’s model', async ({ browser }) => {
  const [ada] = accounts().users;
  if (!ada) throw new Error('missing account');
  const context = await signedInContext(browser, ada);
  const id = await createDocument(context);
  const page = await context.newPage();
  await openEditor(page, id);
  const body = editorBody(page);
  await body.click();

  // Markdown shortcuts: headings and lists convert; quote, code and #### stay literal.
  await page.keyboard.type('## Agenda');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Introductions');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Current tooling');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('> not a quote');
  await page.keyboard.press('Enter');
  await page.keyboard.type('#### not a heading');
  await page.keyboard.press('Enter');

  // Slash menu: 7 items in Attio's order; filtering keeps the order; Enter applies.
  await page.keyboard.type('/');
  const menu = page.getByTestId('slash-menu');
  await expect(menu.getByRole('option')).toHaveText([
    /Heading 1/,
    /Heading 2/,
    /Heading 3/,
    /Body/,
    /Bulleted list/,
    /Numbered list/,
    /Image/,
  ]);
  await page.keyboard.type('num');
  await expect(menu.getByRole('option')).toHaveText([/Numbered list/]);
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await page.keyboard.type('Owner ');

  // Mention: members first, then records; the token is followed by an automatic space.
  await page.keyboard.type('@gra');
  const mentions = page.getByTestId('mention-menu');
  await expect(mentions.getByRole('option').first()).toContainText('Grace Hopper');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and @atlas');
  await expect(mentions.getByRole('option').first()).toContainText('[seed] Atlas Ventures');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('alpha beta gamma');

  // Selection toolbar only for a pointer selection; Body/colour/highlight/link/B/I/S, no underline.
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.getByTestId('selection-toolbar')).toBeHidden();
  await selectWord(page, 'beta');
  const toolbar = page.getByTestId('selection-toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button')).toHaveText(['Body', 'Text', 'Highlight', '', '', '', '']);
  await toolbar.getByRole('button', { name: 'Bold' }).click();
  await toolbar.getByRole('button', { name: 'Text colour' }).click();
  await toolbar.getByTestId('swatch-block_red').click();
  await toolbar.getByRole('button', { name: 'Highlight' }).click();
  await toolbar.getByTestId('swatch-pastel_green').click();
  await selectWord(page, 'gamma');
  await toolbar.getByRole('button', { name: 'Link' }).click();
  await toolbar.getByRole('textbox', { name: 'URL' }).fill('not a url');
  await page.keyboard.press('Enter');
  await expect(toolbar).toContainText('Enter a valid URL');
  await toolbar.getByRole('textbox', { name: 'URL' }).fill('example.com/gamma');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ControlOrMeta+u'); // blocked in notes

  const lines = async () => (await storedDocument(context, id)).markdown.split('\n').map((line) => line.trimEnd());
  await expect
    .poll(lines, { timeout: 10_000 })
    .toEqual([
      '## Agenda',
      '- Introductions',
      '  - Current tooling',
      '> not a quote',
      '\\#### not a heading',
      '1. Owner @Grace Hopper and @[seed] Atlas Ventures',
      'alpha **==beta==** [gamma](http://example.com/gamma)',
    ]);
  const stored = await storedDocument(context, id);
  expect(stored.blocks.map((b) => b.type)).toEqual(['h2', 'ul', 'ul', 'unstyled', 'unstyled', 'ol', 'unstyled']);
  await context.close();
});
