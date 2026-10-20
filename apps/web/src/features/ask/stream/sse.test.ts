import { describe, expect, it } from 'vitest';
import { eventOfFrame, parseSseChunk } from './sse';

const frame = (event: string, data: unknown, id: number) =>
  `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('sse parsing', () => {
  it('splits complete frames and keeps the unfinished tail', () => {
    const text = `${frame('turn', { type: 'turn', seq: 1 }, 1)}: ping\n\nid: 2\nevent: part\ndata: {"type":"par`;
    const { frames, rest } = parseSseChunk(text);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ event: 'turn', id: '1' });
    expect(rest).toBe('id: 2\nevent: part\ndata: {"type":"par');
    const next = parseSseChunk(`${rest}t","seq":2}\n\n`);
    expect(next.frames).toHaveLength(1);
    expect(eventOfFrame(next.frames[0] as never)).toEqual({ type: 'part', seq: 2 });
  });

  it('handles CRLF and multi-line data', () => {
    const { frames } = parseSseChunk('event: done\r\ndata: {"type":"done",\r\ndata: "seq":3}\r\n\r\n');
    expect(frames[0]?.data).toBe('{"type":"done",\n"seq":3}');
    expect(eventOfFrame(frames[0] as never)).toEqual({ type: 'done', seq: 3 });
  });

  it('ignores comments, unknown types and malformed json', () => {
    expect(parseSseChunk(': ping\n\n').frames).toEqual([]);
    expect(eventOfFrame({ event: null, id: null, data: '{"type":"other"}' })).toBeNull();
    expect(eventOfFrame({ event: null, id: null, data: 'nope' })).toBeNull();
  });
});
