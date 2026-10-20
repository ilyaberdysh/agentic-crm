// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sanitizeEmailHtml } from './sanitize';

describe('sanitizeEmailHtml', () => {
  it('keeps the formatting the server renders', () => {
    expect(sanitizeEmailHtml('<p>Hi <strong>Jane</strong></p><ul><li>a</li></ul>')).toBe(
      '<p>Hi <strong>Jane</strong></p><ul><li>a</li></ul>',
    );
  });

  it('drops scripts, handlers, styles and images', () => {
    const out = sanitizeEmailHtml(
      '<p onclick="x()">a<script>alert(1)</script><img src=x onerror=alert(1)><style>p{}</style></p>',
    );
    expect(out).toBe('<p>a</p>');
  });

  it('keeps http(s) and mailto links only', () => {
    expect(sanitizeEmailHtml('<a href="https://x.io">x</a>')).toContain('href="https://x.io"');
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeEmailHtml('<a href="mailto:a@b.co">x</a>')).toContain('mailto:a@b.co');
  });

  it('keeps a hex colour on spans and nothing else', () => {
    expect(sanitizeEmailHtml('<span style="color:#6f6f6f;position:fixed">x</span>')).toBe(
      '<span style="color:#6f6f6f">x</span>',
    );
    expect(sanitizeEmailHtml('<span style="color:url(x)">x</span>')).toBe('<span>x</span>');
  });
});
