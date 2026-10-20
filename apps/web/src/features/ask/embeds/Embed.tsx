// Generative components of an answer (ask-agentic-internals §5.1): the model writes a fenced block `agentic-crm:<identifier>`
// with a JSON body. Complete blocks are validated and rendered as a card; a block still streaming shows a skeleton
// (call snippets render the part that has arrived). Unknown identifiers and bad data render nothing but a quiet line.
import { Icon } from '@agentic-crm/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type ReactNode, useMemo } from 'react';
import { keys } from '../../../data/keys';
import { api, httpStatusOf, inWorkspace } from '../../../data/trpc';
import { useMembers, useRecordTitle } from '../../attributes/data/queries';
import { MemberAvatar, RecordAvatar, recordKind, recordPath } from '../../attributes/ui/primitives';
import { useMeeting } from '../../meetings/data';
import { useNote, useWorkspaceRef } from '../../notes/data';
import { openNote, openTask, openWindow } from '../../overlays/store';
import { useWorkspace } from '../../shell/workspaceContext';
import { setTaskCompleted, type Task, useTask } from '../../tasks/data';
import { TaskCheckbox } from '../../tasks/TaskCheckbox';
import * as md from '../markdown/markdown.css';
import { parseComponentJson, parsePartialJson } from '../markdown/parse';
import { RecordPill } from '../markdown/RecordPill';
import * as s from './embeds.css';
import { snippetHref, snippetsOf } from './snippets';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

function Missing({ children }: { children: ReactNode }) {
  return (
    <div className={s.error} data-testid="ask-embed-missing">
      {children}
    </div>
  );
}

// ---- record card ----------------------------------------------------------------------------------------------------------------

function EntityEmbed({
  entityDefinitionId,
  entityInstanceId,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
}) {
  const { workspace } = useWorkspace();
  const { title, definition, isLoading } = useRecordTitle(entityDefinitionId, entityInstanceId);
  const navigate = useNavigate();
  const href = recordPath(workspace.slug, definition, entityInstanceId);
  if (!isLoading && !definition) return <Missing>This record could not be found</Missing>;
  return (
    <a
      className={`${s.card} ${s.interactive}`}
      href={href ?? undefined}
      data-testid="ask-entity-embed"
      onClick={(e) => {
        if (!href || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        void navigate({ href });
      }}
    >
      <span className={s.row}>
        <RecordAvatar kind={recordKind(definition)} size={20} />
        <span className={s.title}>{title || ' '}</span>
      </span>
    </a>
  );
}

// ---- task card -------------------------------------------------------------------------------------------------------------------

function formatDue(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function TaskEmbed({ taskId }: { taskId: string }) {
  const task = useTask(taskId);
  const { workspace } = useWorkspace();
  const ws = useWorkspaceRef();
  const client = useQueryClient();
  const members = useMembers();
  const data = task.data as Task | undefined;
  if (task.isError && httpStatusOf(task.error) === 404) return <Missing>This task may have been deleted</Missing>;
  if (!data) return <div className={md.skeleton} />;
  const assignees = data.assigneeMemberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  return (
    <div
      className={`${s.card} ${s.interactive}`}
      role="button"
      tabIndex={0}
      data-testid="ask-task-embed"
      data-task-id={data.id}
      onClick={() => openTask(data.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          openTask(data.id);
        }
      }}
    >
      <span className={s.row}>
        <TaskCheckbox
          checked={data.isCompleted}
          label={`Mark "${data.content.text}" as done`}
          onChange={(next) => void setTaskCompleted(client, ws, data, next, workspace.membership.id)}
        />
        <span className={`${s.title} ${data.isCompleted ? s.titleDone : ''}`}>{data.content.text}</span>
      </span>
      {(assignees.length > 0 || data.deadlineAt || data.linkedRecords.length > 0) && (
        <span className={s.meta}>
          {assignees.map((m) => (
            <span key={m.id} className={s.metaItem}>
              <MemberAvatar member={m} size={16} />
              {m.id === workspace.membership.id ? 'You' : `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || 'Member'}
            </span>
          ))}
          {data.deadlineAt && (
            <span className={s.metaItem}>
              <Icon icon="calendarDays" size={12} />
              {formatDue(data.deadlineAt)}
            </span>
          )}
          {data.linkedRecords.map((r) => (
            <RecordPill
              key={r.entityInstanceId}
              entityDefinitionId={r.entityDefinitionId}
              entityInstanceId={r.entityInstanceId}
              label=""
            />
          ))}
        </span>
      )}
    </div>
  );
}

// ---- note and meeting cards ----------------------------------------------------------------------------------------

function NoteEmbed({ noteId }: { noteId: string }) {
  const note = useNote(noteId);
  if (note.isError) return <Missing>There was a problem loading this note</Missing>;
  if (!note.data) return <div className={md.skeleton} />;
  const preview = note.data.content?.plaintext?.trim().split('\n').find(Boolean) ?? '';
  return (
    <div
      className={`${s.card} ${s.interactive}`}
      role="button"
      tabIndex={0}
      data-testid="ask-note-embed"
      onClick={() => openNote(noteId)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) openNote(noteId);
      }}
    >
      <span className={s.row}>
        <Icon icon="notes" size={16} />
        <span className={s.title}>{note.data.title || 'Untitled note'}</span>
      </span>
      {preview && <span className={s.preview}>{preview}</span>}
    </div>
  );
}

function MeetingEmbed({ meetingId }: { meetingId: string }) {
  const meeting = useMeeting(meetingId);
  if (meeting.isError) return <Missing>This meeting could not be found</Missing>;
  if (!meeting.data) return <div className={md.skeleton} />;
  const start = meeting.data.start?.at ? new Date(meeting.data.start.at) : null;
  return (
    <div
      className={`${s.card} ${s.interactive}`}
      role="button"
      tabIndex={0}
      data-testid="ask-meeting-embed"
      onClick={() => openWindow('meeting', meetingId, {})}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) openWindow('meeting', meetingId, {});
      }}
    >
      <span className={s.row}>
        <Icon icon="meeting" size={16} />
        <span className={s.title}>{meeting.data.title || 'Untitled meeting'}</span>
      </span>
      {start && (
        <span className={s.secondary}>
          {start.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      )}
    </div>
  );
}

// ---- call snippets -----------------------------------------------------------------------------------------------------------------

function CallSnippetsEmbed({ data, partial }: { data: Record<string, unknown> | null; partial: boolean }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const meetingId = data && isId(data.meeting_id) ? data.meeting_id : null;
  const recordingId = data && isId(data.call_recording_id) ? data.call_recording_id : null;
  const snippets = useMemo(() => snippetsOf(data), [data]);
  const ws = useWorkspaceRef();
  const call = useQuery({
    queryKey: [...keys.resource(ws.id, 'call-recording'), recordingId ?? ''],
    queryFn: () => api.calls.get.query({ recordingId: recordingId as string }, inWorkspace(ws)),
    enabled: Boolean(recordingId),
    retry: (count, error) => httpStatusOf(error) !== 404 && count < 2,
  });
  if (!meetingId || !recordingId)
    return partial ? <div className={md.skeleton} /> : <Missing>This call recording could not be found</Missing>;
  if (call.isError) return <Missing>This call recording could not be found</Missing>;
  return (
    <div className={s.card} data-testid="ask-call-snippets">
      <div className={s.snippetHeader}>
        <Icon icon="meeting" size={16} color="positive" />
        <span className={s.title}>{call.data?.title || 'Call recording'}</span>
      </div>
      {snippets.map((snippet) => {
        const href = snippetHref(workspace.slug, meetingId, recordingId, snippet);
        return (
          <a
            key={`${snippet.start}-${snippet.end}`}
            className={s.snippetRow}
            href={href}
            data-testid="ask-call-snippet"
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              void navigate({ href });
            }}
          >
            <span className={s.snippetTitle}>{snippet.title}</span>
            <span className={s.snippetTime}>
              {snippet.start}–{snippet.end}
            </span>
          </a>
        );
      })}
      {partial && snippets.length === 0 && <div className={md.skeleton} style={{ height: 24 }} />}
    </div>
  );
}

// ---- dispatcher -----------------------------------------------------------------------------------------------------------------------

export function Embed({ id, data, partial }: { id: string; data: string; partial: boolean }) {
  if (id === 'call-recording-snippets') {
    const parsed = partial ? parsePartialJson(data) : parseComponentJson(data);
    if (!parsed && !partial) return <Missing>Something went wrong</Missing>;
    return <CallSnippetsEmbed data={parsed} partial={partial} />;
  }
  if (partial) return <div className={md.skeleton} data-testid="ask-embed-skeleton" />;
  const parsed = parseComponentJson(data);
  if (!parsed) return <Missing>Something went wrong</Missing>;
  switch (id) {
    case 'entity-embed':
      return isId(parsed.entity_definition_id) && isId(parsed.entity_instance_id) ? (
        <EntityEmbed entityDefinitionId={parsed.entity_definition_id} entityInstanceId={parsed.entity_instance_id} />
      ) : (
        <Missing>Something went wrong</Missing>
      );
    case 'task-embed':
      return isId(parsed.task_id) ? <TaskEmbed taskId={parsed.task_id} /> : <Missing>Something went wrong</Missing>;
    case 'note-embed':
      return isId(parsed.note_id) ? <NoteEmbed noteId={parsed.note_id} /> : <Missing>Something went wrong</Missing>;
    case 'meeting-embed':
      return isId(parsed.meeting_id) ? (
        <MeetingEmbed meetingId={parsed.meeting_id} />
      ) : (
        <Missing>Something went wrong</Missing>
      );
    default:
      // Unknown or deprecated component: nothing to show.
      return null;
  }
}
