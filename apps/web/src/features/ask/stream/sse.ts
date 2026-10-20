// Server-Sent Events over fetch (the stream needs the session cookie and the `x-workspace-slug` header, which
// EventSource cannot send): GET /api/ai/threads/:threadId/stream?turnId=… → frames `id:` / `event:` / `data:` separated
// by blank lines, `: ping` comments every 15 s. Each `data:` is one JSON `AiStreamEvent` (slice10-ask-server).
import { type AiStreamEvent, aiStreamPath } from '@agentic-crm/contracts';
import { HttpError } from '../../../data/trpc';

export interface SseFrame {
  event: string | null;
  id: string | null;
  data: string;
}

/** Splits the received text into complete frames; `rest` is the unfinished tail to prepend to the next chunk. */
export function parseSseChunk(buffer: string): { frames: SseFrame[]; rest: string } {
  const text = buffer.replace(/\r\n?/g, '\n');
  const parts = text.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames: SseFrame[] = [];
  for (const part of parts) {
    let event: string | null = null;
    let id: string | null = null;
    const data: string[] = [];
    for (const line of part.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length > 0) frames.push({ event, id, data: data.join('\n') });
  }
  return { frames, rest };
}

/** The `AiStreamEvent` of a frame, or null for anything else. */
export function eventOfFrame(frame: SseFrame): AiStreamEvent | null {
  try {
    const value = JSON.parse(frame.data) as { type?: unknown };
    if (value && (value.type === 'turn' || value.type === 'part' || value.type === 'done')) {
      return value as AiStreamEvent;
    }
  } catch {
    // malformed frame: skipped
  }
  return null;
}

export interface TurnStreamOptions {
  workspaceSlug: string;
  threadId: string;
  turnId: string;
  signal: AbortSignal;
  onEvent: (event: AiStreamEvent) => void;
}

/**
 * Reads the stream of an assistant turn until the server ends it (after `done`) or the signal aborts. Rejects with an
 * `HttpError` for a non-200 answer (402 `CREDITS_EXHAUSTED`, 404 …) and with the network error otherwise.
 */
export async function readTurnStream(options: TurnStreamOptions): Promise<void> {
  const response = await fetch(aiStreamPath(options.threadId, options.turnId), {
    credentials: 'include',
    headers: { accept: 'text/event-stream', 'x-workspace-slug': options.workspaceSlug },
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { message?: string; additional_information?: { code?: string } };
      message = body.message ?? message;
      code = body.additional_information?.code;
    } catch {
      // not JSON
    }
    throw new HttpError(response.status, message, code);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const frame of frames) {
        const event = eventOfFrame(frame);
        if (event) options.onEvent(event);
      }
    }
    buffer += decoder.decode();
    const { frames } = parseSseChunk(`${buffer}\n\n`);
    for (const frame of frames) {
      const event = eventOfFrame(frame);
      if (event) options.onEvent(event);
    }
  } finally {
    reader.releaseLock();
  }
}
