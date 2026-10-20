// The review step shows the HTML the server rendered for an email (paragraphs, lists, bold / italic / strikethrough,
// links, grey text). The server escapes every value, but the client still renders it through an allowlist: a fixed
// set of tags, `href` of http(s) and mailto links only, a hex `color` on spans, nothing else.
const TAGS = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'S', 'A', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'SPAN']);
const SAFE_HREF = /^(https?:|mailto:)/i;
const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

function clean(node: Node, out: Node, doc: Document): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.appendChild(doc.createTextNode(child.textContent ?? ''));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (!TAGS.has(tag)) {
      // Unknown element: keep its text, drop the element (scripts and styles have none worth keeping).
      if (tag !== 'SCRIPT' && tag !== 'STYLE') clean(el, out, doc);
      continue;
    }
    const copy = doc.createElement(tag.toLowerCase());
    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (SAFE_HREF.test(href)) {
        copy.setAttribute('href', href);
        copy.setAttribute('target', '_blank');
        copy.setAttribute('rel', 'noreferrer noopener');
      }
    } else if (tag === 'SPAN') {
      const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(el.getAttribute('style') ?? '')?.[1]?.trim();
      if (color && SAFE_COLOR.test(color)) copy.setAttribute('style', `color:${color}`);
    }
    clean(el, copy, doc);
    out.appendChild(copy);
  }
}

/** `html` reduced to the allowlist, as an HTML string. */
export function sanitizeEmailHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = doc.createElement('div');
  clean(doc.body, out, doc);
  return out.innerHTML;
}
