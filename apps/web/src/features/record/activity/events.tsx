// Event renderings of the activity feed (D README §3.8): actor (member avatar + name, or a tile for API tokens,
// workflows and the system), the sentence per event type, and the note / task cards under an event. Attribute
// changes show the new value through the attribute registry (chip density); several changes collapse into
// "changed [n attributes]" with a popover table "Attribute | New value".
import type {
  Actor,
  AttributeChange,
  AttributeDefinition,
  AttributeValue,
  EntityDefinition,
  TimelineEvent,
} from '@agentic-crm/contracts';
import { Icon, Popover } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { api, inWorkspace, type RouterOutputs } from '../../../data/trpc';
import { formatValue, getAttributeUi, useMembers } from '../../attributes';
import { actorTypeLabel, formatRelativeTime, memberName } from '../../attributes/format/formatValue';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import { useWorkspace } from '../../shell/workspaceContext';
import { useCalendar } from '../../tasks';
import {
  ActivityCallCard,
  type CallListItem,
  isPast,
  type Meeting,
  openNote,
  openTask,
  openWindow,
  participantCountLabel,
  timelineVerb,
  timeRangeLabel,
  useCallsByMeetings,
  useMeetingsById,
} from '../adapters';
import type { RecordRef } from '../context';
import { recordKeys } from '../data';
import * as s from './activity.css';

type Note = RouterOutputs['notes']['batchGet']['notes'][number];
type Task = RouterOutputs['tasks']['batchGet']['tasks'][number];

export interface Hydrated {
  notes: Map<string, Note>;
  tasks: Map<string, Task>;
  meetings: Map<string, Meeting>;
  /** The call of a meeting, when it has one (concise summary on the meeting card). */
  calls: Map<string, CallListItem>;
}

/** Notes, tasks and meetings referenced by a page of events, fetched in one batch each. */
export function useEventHydration(recordRef: RecordRef, events: readonly TimelineEvent[]): Hydrated {
  const { workspace } = useWorkspace();
  const noteIds = useMemo(
    () => [...new Set(events.flatMap((e) => (e.eventType === 'note-added' ? [e.noteId] : [])))].sort(),
    [events],
  );
  const taskIds = useMemo(
    () =>
      [
        ...new Set(
          events.flatMap((e) =>
            e.eventType === 'task-upcoming' || e.eventType === 'task-overdue' || e.eventType === 'task-completed'
              ? [e.taskId]
              : [],
          ),
        ),
      ].sort(),
    [events],
  );
  const meetingIds = useMemo(
    () => [...new Set(events.flatMap((e) => (e.eventType === 'meeting' ? [e.meetingId] : [])))].sort(),
    [events],
  );
  const meetings = useMeetingsById(meetingIds);
  const calls = useCallsByMeetings(meetingIds);
  const base = recordKeys.timeline(workspace.id, recordRef.entityDefinitionId, recordRef.entityInstanceId);
  const notes = useQuery({
    queryKey: [...base, 'notes-by-id', noteIds],
    queryFn: () => api.notes.batchGet.query({ noteIds, includeContent: true }, inWorkspace(workspace)),
    enabled: noteIds.length > 0,
  });
  const tasks = useQuery({
    queryKey: [...base, 'tasks-by-id', taskIds],
    queryFn: () => api.tasks.batchGet.query({ taskIds }, inWorkspace(workspace)),
    enabled: taskIds.length > 0,
  });
  return useMemo(
    () => ({
      notes: new Map((notes.data?.notes ?? []).map((n) => [n.id, n])),
      tasks: new Map((tasks.data?.tasks ?? []).map((t) => [t.id, t])),
      meetings,
      calls,
    }),
    [notes.data, tasks.data, meetings, calls],
  );
}

/**
 * The person an event is about: upcoming / overdue task events read "{assignee} has an upcoming task" (D §3.8), so
 * they show the task's first assignee rather than the system that derived the event.
 */
export function displayEvent(event: TimelineEvent, hydrated: Hydrated): TimelineEvent {
  if (event.eventType !== 'task-upcoming' && event.eventType !== 'task-overdue') return event;
  const assignee = hydrated.tasks.get(event.taskId)?.assigneeMemberIds[0];
  return assignee ? { ...event, actor: { type: 'workspace-member', id: assignee } } : event;
}

// ---- actors -----------------------------------------------------------------------------------------------------

export function ActorAvatar({ actor }: { actor: Actor | null }) {
  const members = useMembers();
  if (actor?.type === 'workspace-member') {
    return <MemberAvatar member={members.find((m) => m.id === actor.id)} size={16} />;
  }
  const label = actorLabel(actor);
  return (
    <span className={s.actorTile} aria-hidden="true">
      {(label[0] ?? '?').toUpperCase()}
    </span>
  );
}

function actorLabel(actor: Actor | null): string {
  if (!actor) return 'System';
  return actor.type === 'system' ? 'System' : actorTypeLabel(actor.type);
}

export function ActorName({ actor }: { actor: Actor | null }) {
  const members = useMembers();
  const name =
    actor?.type === 'workspace-member'
      ? memberName(members.find((m) => m.id === actor.id)) || 'Workspace member'
      : actorLabel(actor);
  return <span className={s.strong}>{name}</span>;
}

// ---- sentences ----------------------------------------------------------------------------------------------------

export interface SentenceContext {
  object: Pick<EntityDefinition, 'singularNoun'>;
  attributes: readonly AttributeDefinition[];
}

/** Values of a change as current rows (retired rows keep their `activeUntil`; Views draw current values only). */
const asCurrent = (values: readonly AttributeValue[]) => values.map((v) => ({ ...v, activeUntil: null }));

function NewValue({
  attribute,
  values,
  previous = [],
}: {
  attribute: AttributeDefinition;
  values: readonly AttributeValue[];
  previous?: readonly AttributeValue[];
}) {
  const { View } = getAttributeUi(attribute.type);
  // The old value of the change: on hover (Attio's sentence shows only the new one).
  const before = previous.length > 0 ? formatValue(attribute, asCurrent(previous)) : '';
  return (
    <span
      className={s.valueChip}
      title={before ? `Previous value: ${before}` : undefined}
      data-previous={before || undefined}
    >
      <View attribute={attribute} values={asCurrent(values)} density="chip" />
    </span>
  );
}

function ChangesPopover({ changes, ctx }: { changes: AttributeChange[]; ctx: SentenceContext }) {
  const byId = new Map(ctx.attributes.map((a) => [a.id, a]));
  const known = changes.filter((c) => byId.has(c.attributeDefinitionId));
  return (
    <Popover
      aria-label="Changed attributes"
      placement="bottom start"
      padding={0}
      trigger={
        <AriaButton className={s.countButton} data-testid="changed-attributes">
          {changes.length} attributes
        </AriaButton>
      }
    >
      <div className={s.changesTable}>
        <div className={s.changesHead}>
          <span>Attribute</span>
          <span>New value</span>
        </div>
        {known.map((c) => {
          const attribute = byId.get(c.attributeDefinitionId) as AttributeDefinition;
          return (
            <div key={c.attributeDefinitionId} className={s.changesRow}>
              <span className={s.changesAttr}>
                <Icon icon={attributeIcon(attribute)} size={16} />
                {attribute.title}
              </span>
              <span style={{ minWidth: 0, overflow: 'hidden' }}>
                {c.added.length > 0 ? <NewValue attribute={attribute} values={c.added} /> : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

function AttributeSentence({ changes, ctx }: { changes: AttributeChange[]; ctx: SentenceContext }) {
  if (changes.length !== 1) {
    return (
      <>
        <span>changed</span>
        <ChangesPopover changes={changes} ctx={ctx} />
      </>
    );
  }
  const change = changes[0] as AttributeChange;
  const attribute = ctx.attributes.find((a) => a.id === change.attributeDefinitionId);
  if (!attribute) return <span>changed an attribute</span>;
  if (change.added.length === 0) {
    return (
      <>
        <span>cleared</span>
        <span
          className={s.strong}
          title={
            change.removed.length > 0
              ? `Previous value: ${formatValue(attribute, asCurrent(change.removed))}`
              : undefined
          }
        >
          {attribute.title}
        </span>
      </>
    );
  }
  return (
    <>
      <span>changed</span>
      <span className={s.strong}>{attribute.title}</span>
      <span>to</span>
      <NewValue attribute={attribute} values={change.added} previous={change.removed} />
    </>
  );
}

/** "{actor} {verb …}" of one event. */
export function EventSentence({ event, ctx }: { event: TimelineEvent; ctx: SentenceContext }) {
  const actor = <ActorName actor={event.actor} />;
  switch (event.eventType) {
    case 'entity-instance-created':
      return (
        <>
          {actor}
          <span>created {ctx.object.singularNoun}</span>
        </>
      );
    case 'attribute-values-updated':
      return (
        <>
          {actor}
          <AttributeSentence changes={event.changes} ctx={ctx} />
        </>
      );
    case 'merged':
      return (
        <>
          {actor}
          <span>
            {event.mergedFromIds.length > 1
              ? `merged ${event.mergedFromIds.length} duplicate records`
              : 'merged a duplicate record'}
          </span>
        </>
      );
    case 'list-entry-created':
      return (
        <>
          {actor}
          <span>added {ctx.object.singularNoun} to a list</span>
        </>
      );
    case 'list-entry-deleted':
      return (
        <>
          {actor}
          <span>removed {ctx.object.singularNoun} from a list</span>
        </>
      );
    case 'list-attribute-values-updated':
      return (
        <>
          {actor}
          <span>
            changed {event.changes.length === 1 ? 'an attribute' : `${event.changes.length} attributes`} in a list
          </span>
        </>
      );
    case 'note-added':
      return (
        <>
          {actor}
          <span>created a note</span>
        </>
      );
    case 'task-upcoming':
      return (
        <>
          {actor}
          <span>has an upcoming task</span>
        </>
      );
    case 'task-overdue':
      return (
        <>
          {actor}
          <span>has an overdue task</span>
        </>
      );
    case 'task-completed':
      return (
        <>
          {actor}
          <span>completed a task</span>
        </>
      );
    case 'meeting': {
      // "{actor} attended a meeting / was invited to / is attending / declined" by the attending member's RSVP
      // (D §3.8); a meeting no member takes part in has no actor to name.
      const past = Date.parse(event.occurredAt) <= Date.now();
      const verb = timelineVerb(event.memberStatus, past);
      return verb ? (
        <>
          {actor}
          <span>{verb}</span>
        </>
      ) : (
        <span>{past ? 'A meeting took place' : 'A meeting is scheduled'}</span>
      );
    }
    default:
      return actor;
  }
}

// ---- cards ----------------------------------------------------------------------------------------------------

export function EventCard({ event, hydrated }: { event: TimelineEvent; hydrated: Hydrated }) {
  if (event.eventType === 'meeting') {
    const meeting = hydrated.meetings.get(event.meetingId);
    const call = hydrated.calls.get(event.meetingId);
    if (call && meeting?.access === 'full-access') return <ActivityCallCard call={call} />;
    return meeting ? <MeetingCard meeting={meeting} /> : null;
  }
  if (event.eventType === 'note-added') {
    const note = hydrated.notes.get(event.noteId);
    if (!note) return null;
    const preview = note.content?.plaintext?.trim().split('\n').find(Boolean) ?? '';
    return (
      <div className={s.card} data-testid="event-note-card" data-interactive="" onClick={() => openNote(note.id)}>
        <div className={s.cardTitle}>{note.title || 'Untitled note'}</div>
        {preview && <div className={s.cardPreview}>{preview}</div>}
      </div>
    );
  }
  if (
    event.eventType === 'task-upcoming' ||
    event.eventType === 'task-overdue' ||
    event.eventType === 'task-completed'
  ) {
    const task = hydrated.tasks.get(event.taskId);
    if (!task) return null;
    return (
      <div className={s.card} data-testid="event-task-card" data-interactive="" onClick={() => openTask(task.id)}>
        <div className={s.cardRow}>
          <span className={s.taskCheck} data-done={task.isCompleted || undefined} aria-hidden="true">
            {task.isCompleted && <Icon icon="check" size={10} strokeWidth={3} />}
          </span>
          <span className={s.cardTitle}>{task.content.text}</span>
          <span className={s.cardMeta}>
            <TaskAssignees memberIds={task.assigneeMemberIds} />
            {task.deadlineAt && !task.isCompleted && (
              <span className={s.due} data-overdue={event.eventType === 'task-overdue' || undefined}>
                <Icon icon="attrTimestamp" size={12} />
                {capitalize(formatRelativeTime(task.deadlineAt))}
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

/** Title, time range and participant count of a meeting; opens the meeting modal (F README §2.5). */
function MeetingCard({ meeting }: { meeting: Meeting }) {
  const { timeZone } = useCalendar();
  return (
    <div
      className={s.card}
      data-testid="event-meeting-card"
      data-meeting-id={meeting.id}
      data-interactive=""
      onClick={() => openWindow('meeting', meeting.id, {})}
    >
      <div className={s.cardRow}>
        <Icon icon="meeting" size={16} />
        <span className={s.cardTitle} data-testid="event-meeting-title">
          {meeting.title === null ? 'Private meeting' : meeting.title || 'Untitled meeting'}
        </span>
        <span className={s.cardMeta}>
          <span className={s.cardPreview} data-testid="event-meeting-time">
            {timeRangeLabel(meeting, timeZone)}
          </span>
          <span
            className={s.cardPreview}
            data-testid="event-meeting-participants"
            data-ended={isPast(meeting, Date.now()) || undefined}
          >
            {participantCountLabel(meeting.participants.length)}
          </span>
        </span>
      </div>
    </div>
  );
}

export function TaskAssignees({ memberIds }: { memberIds: readonly string[] }) {
  const members = useMembers();
  const first = members.find((m) => m.id === memberIds[0]);
  if (!first) return null;
  return (
    <span className={s.cardMeta} style={{ gap: 4 }}>
      <MemberAvatar member={first} size={16} />
      <span className={s.cardPreview} style={{ maxWidth: 90, color: 'inherit' }}>
        {memberName(first)}
      </span>
    </span>
  );
}

export const capitalize = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
