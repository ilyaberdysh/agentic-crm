// Call snippets (ask-agentic §12, BACKLOG 10.16): `agentic-crm:call-recording-snippets` carries moments of a call as
// {title, start_time "m:ss", end_time "m:ss"}; each row links to the transcript range of the call page.
export interface Snippet {
  title: string;
  start: string;
  end: string;
}

/** "m:ss" or "h:mm:ss" → seconds. */
export function clockToSeconds(clock: string): number {
  const parts = clock
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Snippets of the block, dropping incomplete ones and merging those whose gap is at most 3 s (§5.1). */
export function snippetsOf(data: Record<string, unknown> | null): Snippet[] {
  const raw = Array.isArray(data?.snippets) ? (data?.snippets as unknown[]) : [];
  const out: Snippet[] = [];
  for (const item of raw) {
    const o = item as Record<string, unknown> | null;
    if (!o || typeof o.title !== 'string' || typeof o.start_time !== 'string' || typeof o.end_time !== 'string')
      continue;
    if (!o.title || !/^\d+(:\d{1,2}){1,2}$/.test(o.start_time) || !/^\d+(:\d{1,2}){1,2}$/.test(o.end_time)) continue;
    const prev = out[out.length - 1];
    if (
      prev &&
      clockToSeconds(o.start_time) - clockToSeconds(prev.end) <= 3 &&
      clockToSeconds(o.start_time) >= clockToSeconds(prev.end)
    ) {
      prev.end = o.end_time;
      continue;
    }
    out.push({ title: o.title, start: o.start_time, end: o.end_time });
  }
  return out;
}

/** `/<ws>/calls/<meetingId>/<callRecordingId>/transcript?start=<s>&end=<s>` (10.16). */
export function snippetHref(
  workspaceSlug: string,
  meetingId: string,
  callRecordingId: string,
  snippet: Snippet,
): string {
  return `/${workspaceSlug}/calls/${meetingId}/${callRecordingId}/transcript?start=${clockToSeconds(snippet.start)}&end=${clockToSeconds(snippet.end)}`;
}
