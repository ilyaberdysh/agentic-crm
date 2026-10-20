import { describe, expect, it } from 'vitest';
import { clockToSeconds, snippetHref, snippetsOf } from './snippets';

describe('call snippets', () => {
  it('converts clock times to seconds', () => {
    expect(clockToSeconds('0:38')).toBe(38);
    expect(clockToSeconds('12:05')).toBe(725);
    expect(clockToSeconds('1:02:03')).toBe(3723);
    expect(clockToSeconds('x')).toBe(0);
  });

  it('keeps complete snippets, drops partial ones and merges snippets at most 3 seconds apart', () => {
    const snippets = snippetsOf({
      snippets: [
        { title: 'Budget', start_time: '1:00', end_time: '1:30' },
        { title: 'Budget follow-up', start_time: '1:32', end_time: '2:00' },
        { title: 'Timeline', start_time: '5:00', end_time: '5:20' },
        { title: 'Half written', start_time: '6:0' },
        { start_time: '7:00', end_time: '7:10' },
      ],
    });
    expect(snippets).toEqual([
      { title: 'Budget', start: '1:00', end: '2:00' },
      { title: 'Timeline', start: '5:00', end: '5:20' },
    ]);
    expect(snippetsOf(null)).toEqual([]);
  });

  it('links to the transcript range of the call page', () => {
    expect(snippetHref('acme', 'm1', 'r1', { title: 'x', start: '1:02', end: '1:30' })).toBe(
      '/acme/calls/m1/r1/transcript?start=62&end=90',
    );
  });
});
