// Email rendering: subject (text with variables) and body (editor blocks with variables, B.10 / B.11) → the text and
// HTML handed to the connector. A variable renders its resolved value, else its fallback; a variable with neither is
// reported as missing (review step) and renders empty. Body HTML is deliberately plain: paragraphs, headings, nested
// bulleted / numbered lists, bold / italic / strikethrough / links / text colour, images.
import { type Block, VARIABLE_PLACEHOLDER, type VariableRef } from '@agentic-crm/editor/model';

export type Resolve = (variable: VariableRef) => string | null;

export interface Rendered {
  text: string;
  missing: VariableRef[];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fallback-aware value of a variable; null when both the value and the fallback are empty. */
function valueOf(variable: VariableRef, resolve: Resolve): string | null {
  const value = resolve(variable);
  if (value !== null && value !== '') return value;
  return variable.fallback !== null && variable.fallback !== '' ? variable.fallback : null;
}

/** Plain text with every variable replaced. */
export function renderAnnotated(
  text: string,
  variables: readonly VariableRef[] | undefined,
  resolve: Resolve,
): Rendered {
  const byStart = new Map(
    (variables ?? []).filter((v) => text[v.start] === VARIABLE_PLACEHOLDER).map((v) => [v.start, v]),
  );
  let out = '';
  const missing: VariableRef[] = [];
  for (let i = 0; i < text.length; i++) {
    const variable = byStart.get(i);
    if (!variable) {
      out += text[i];
      continue;
    }
    const value = valueOf(variable, resolve);
    if (value === null) missing.push(variable);
    out += value ?? '';
  }
  return { text: out, missing };
}

/** Text of a template / draft for previews: variables as `{{label}}`. */
export function previewAnnotated(text: string, variables: readonly VariableRef[] | undefined): string {
  return renderAnnotated(text, variables, (v) => `{{${tokenOf(v)}}}`).text;
}

/** `{{first_name}}`-style token of a variable (drafts list and template cards, F composer §3, §6). */
export function tokenOf(v: VariableRef): string {
  const raw = v.field ?? v.label?.split('›').at(-1) ?? v.path.at(-1)?.attributeDefinitionId ?? '';
  return raw
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

const COLORS: Record<string, string> = { block_grey: '#6f6f6f', block_gray: '#6f6f6f' };

function inlineHtml(block: Block, resolve: Resolve, missing: VariableRef[]): string {
  const { text } = block;
  const variables = new Map(
    (block.variables ?? []).filter((v) => text[v.start] === VARIABLE_PLACEHOLDER).map((v) => [v.start, v]),
  );
  const cuts = new Set<number>([0, text.length]);
  for (const s of block.styles) {
    cuts.add(Math.max(0, s.start));
    cuts.add(Math.min(text.length, s.start + s.length));
  }
  for (const start of variables.keys()) {
    cuts.add(start);
    cuts.add(start + 1);
  }
  const points = [...cuts].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i] as number;
    const to = points[i + 1] as number;
    if (to <= from) continue;
    const variable = from + 1 === to ? variables.get(from) : undefined;
    let segment: string;
    if (variable) {
      const value = valueOf(variable, resolve);
      if (value === null) missing.push(variable);
      segment = escapeHtml(value ?? '');
    } else {
      segment = escapeHtml(text.slice(from, to)).replace(/\n/g, '<br>');
    }
    const styles = block.styles.filter((s) => s.start <= from && s.start + s.length >= to);
    for (const s of styles) {
      if (s.style === 'BOLD') segment = `<strong>${segment}</strong>`;
      else if (s.style === 'ITALIC') segment = `<em>${segment}</em>`;
      else if (s.style === 'STRIKETHROUGH') segment = `<s>${segment}</s>`;
      else if (s.style === 'COLORED' && s.color && COLORS[s.color])
        segment = `<span style="color:${COLORS[s.color]}">${segment}</span>`;
    }
    const link = styles.find((s) => s.style === 'LINK' && s.link);
    if (link?.link && /^(https?:|mailto:)/i.test(link.link))
      segment = `<a href="${escapeHtml(link.link)}">${segment}</a>`;
    html += segment;
  }
  return html;
}

/** Body blocks → {html, text, missing}. */
export function renderBody(
  blocks: readonly Block[],
  resolve: Resolve,
): { html: string; text: string; missing: VariableRef[] } {
  const missing: VariableRef[] = [];
  const lines: string[] = [];
  let html = '';
  // Open lists, innermost last; each has an open <li>.
  const stack: { tag: 'ul' | 'ol'; indent: number }[] = [];
  const closeTop = () => {
    html += `</li></${(stack.pop() as { tag: string }).tag}>`;
  };
  const closeTo = (indent: number) => {
    while (stack.length > 0 && (stack.at(-1) as { indent: number }).indent >= indent) closeTop();
  };
  for (const block of blocks) {
    if (block.type === 'ul' || block.type === 'ol') {
      while (stack.length > 0 && (stack.at(-1) as { indent: number }).indent > block.indent) closeTop();
      const top = stack.at(-1);
      if (top && top.indent === block.indent && top.tag === block.type) {
        html += '</li><li>';
      } else {
        if (top && top.indent === block.indent) closeTop();
        html += `<${block.type}><li>`;
        stack.push({ tag: block.type, indent: block.indent });
      }
      html += inlineHtml(block, resolve, missing);
      lines.push(
        `${'  '.repeat(block.indent)}${block.type === 'ul' ? '-' : '1.'} ${renderAnnotated(block.text, block.variables, resolve).text}`,
      );
      continue;
    }
    closeTo(0);
    if (block.type === 'image-embed') {
      const src = block.image?.src;
      if (src && /^https?:/i.test(src))
        html += `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(block.image?.caption ?? '')}"></p>`;
      lines.push('');
      continue;
    }
    const tag = block.type === 'h1' || block.type === 'h2' || block.type === 'h3' ? block.type : 'p';
    const inner = inlineHtml(block, resolve, missing);
    html += `<${tag}>${inner === '' ? '<br>' : inner}</${tag}>`;
    lines.push(renderAnnotated(block.text, block.variables, resolve).text);
  }
  closeTo(0);
  // `missing` collects each variable once per occurrence in the HTML pass (the text pass repeats them).
  return { html, text: lines.join('\n'), missing };
}

/** True when the subject or body uses any variable. */
export function hasVariables(subject: { variables?: readonly VariableRef[] }, body: readonly Block[]): boolean {
  return (subject.variables?.length ?? 0) > 0 || body.some((b) => (b.variables?.length ?? 0) > 0);
}
