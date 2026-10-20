// Write-path hook (B.28): at the end of every write transaction Tx.flush() hands the transaction's domain events here.
// When an active workflow trigger of the workspace listens to one of their types, the events are kept as one
// change_log row (resource 'workflow-events', audience nobody) with the cause (the workflow run that wrote them, if
// any). The worker's trigger fan-out reads committed rows and matches them against the live triggers, so UI, /v2 and
// import writes start workflows the same way. Raw (not normalised) events are kept: "Attribute value changed" also
// fires for values written while a record is created.
import type { Tx } from '../tx.ts';
import type { DomainEvent } from '../webhooks/events.ts';

/** Domain event types each event trigger listens to. */
export const TRIGGER_EVENT_TYPES: Record<string, readonly string[]> = {
  'on-record-created': ['record.created'],
  'on-record-updated': ['record.created', 'record.updated'],
  'on-attribute-invalidated': ['record.updated', 'list-entry.updated'],
  'on-list-entry-created': ['list-entry.created'],
  'on-list-entry-updated': ['list-entry.created', 'list-entry.updated'],
  'on-task-created': ['task.created'],
  'on-note-created': ['note.created'],
  // Slice 10: a call recording finished processing (transcript + summaries).
  'on-call-recording-created': ['call-recording.created'],
};

export async function captureWorkflowEvents(tx: Tx, events: DomainEvent[]): Promise<void> {
  if (events.length === 0) return;
  const rows = await tx.db
    .selectFrom('workflow_triggers')
    .select('slug')
    .distinct()
    .where('slug', 'in', Object.keys(TRIGGER_EVENT_TYPES))
    .execute();
  if (rows.length === 0) return;
  const types = new Set(rows.flatMap((r) => TRIGGER_EVENT_TYPES[r.slug] ?? []));
  const kept = events.filter((e) => types.has(e.event_type));
  if (kept.length === 0) return;
  tx.emit('workflow-events', null, { events: kept, cause: tx.ctx.workflowRun ?? null }, { userIds: [] });
}
