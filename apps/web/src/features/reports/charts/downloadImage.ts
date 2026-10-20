// "Download as image": the chart box as a PNG, without a new dependency. The element is cloned with its computed styles
// inlined into an SVG <foreignObject>, drawn on a canvas at 2× and saved. Best effort: web fonts are embedded when their
// files can be fetched, otherwise the system font stands in.
import { toast } from '@agentic-crm/ui';

const XHTML = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SCALE = 2;

/** Copies the computed style of every element of `source` onto the matching element of `target`. */
function inlineStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source);
  const style = (target as HTMLElement).style;
  if (style) {
    for (let i = 0; i < computed.length; i++) {
      const name = computed.item(i);
      style.setProperty(name, computed.getPropertyValue(name), computed.getPropertyPriority(name));
    }
  }
  const sc = source.children;
  const tc = target.children;
  for (let i = 0; i < sc.length; i++) {
    const s = sc.item(i);
    const t = tc.item(i);
    if (s && t) inlineStyles(s, t);
  }
}

function backgroundOf(element: HTMLElement): string {
  for (let el: HTMLElement | null = element; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
  }
  return '#ffffff';
}

async function toDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const type = res.headers.get('content-type') ?? 'font/woff2';
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

/** @font-face rules of the Inter families with their files inlined (so the exported image keeps the typeface). */
async function embeddedFontCss(): Promise<string> {
  const out: string[] = [];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule) || !/inter/i.test(rule.style.getPropertyValue('font-family'))) continue;
        let css = rule.cssText;
        const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
        for (const m of urls) {
          const raw = m[1];
          if (!raw || raw.startsWith('data:')) continue;
          const uri = await toDataUri(new URL(raw, sheet.href ?? document.baseURI).href);
          if (uri) css = css.replace(raw, uri);
        }
        out.push(css);
      }
    }
  } catch {
    // fall back to the system font
  }
  return out.join('\n');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The chart could not be rendered as an image'));
    img.src = src;
  });
}

/** Renders an element to a PNG blob. */
export async function renderElementToPng(element: HTMLElement): Promise<Blob> {
  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const clone = element.cloneNode(true) as HTMLElement;
  inlineStyles(element, clone);
  clone.setAttribute('xmlns', XHTML);
  clone.style.margin = '0';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  const fonts = await embeddedFontCss();
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (fonts) {
    const style = document.createElementNS(SVG_NS, 'style');
    style.textContent = fonts;
    svg.appendChild(style);
  }
  const object = document.createElementNS(SVG_NS, 'foreignObject');
  object.setAttribute('x', '0');
  object.setAttribute('y', '0');
  object.setAttribute('width', '100%');
  object.setAttribute('height', '100%');
  object.appendChild(clone);
  svg.appendChild(object);
  const markup = new XMLSerializer().serializeToString(svg);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
  const canvas = document.createElement('canvas');
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas is not available');
  g.fillStyle = backgroundOf(element);
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created'))), 'image/png');
  });
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "Download as image": toasts while preparing, saves `<fileName>.png`; failures raise an error toast. */
export async function downloadChartImage(element: HTMLElement, fileName: string): Promise<void> {
  const id = toast('Preparing report for download...', { durationMs: Number.POSITIVE_INFINITY, dismissable: false });
  try {
    const blob = await renderElementToPng(element);
    saveBlob(blob, /\.png$/i.test(fileName) ? fileName : `${fileName}.png`);
    toast.dismiss(id);
    toast.success('Report downloaded');
  } catch (error) {
    console.error('[reports] image export failed', error);
    toast.dismiss(id);
    toast.error('Failed to download the report');
  }
}
