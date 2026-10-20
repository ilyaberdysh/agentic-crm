// The composer's context chip (ask-agentic-internals §7.2): the page context with high prominence — a record (object
// icon + name), a call (camera + title, with the selected transcript range), a meeting or a list.
import type { AiContext } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { keys } from '../../../data/keys';
import { api, httpStatusOf, inWorkspace } from '../../../data/trpc';
import { useObjectDefinition, useRecordTitle } from '../../attributes/data/queries';
import { RecordAvatar, recordKind } from '../../attributes/ui/primitives';
import { useMeeting } from '../../meetings/data';
import { useWorkspaceRef } from '../../notes/data';
import * as s from './composer.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className={s.contextChip} title={label} data-testid="ask-context-chip">
      {icon}
      <span className={s.contextChipLabel}>{label}</span>
    </span>
  );
}

function RecordContext({
  entityDefinitionId,
  entityInstanceId,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
}) {
  const { title, definition } = useRecordTitle(entityDefinitionId, entityInstanceId);
  return <Chip icon={<RecordAvatar kind={recordKind(definition)} size={16} />} label={title || 'Record'} />;
}

function CallContext({ call }: { call: NonNullable<AiContext['call']> }) {
  const ws = useWorkspaceRef();
  const q = useQuery({
    queryKey: [...keys.resource(ws.id, 'call-recording'), call.callRecordingId],
    queryFn: () => api.calls.get.query({ recordingId: call.callRecordingId }, inWorkspace(ws)),
    retry: (count, error) => httpStatusOf(error) !== 404 && count < 2,
  });
  const range =
    call.startTime !== undefined && call.endTime !== undefined
      ? ` · ${clock(call.startTime)}-${clock(call.endTime)}`
      : '';
  return <Chip icon={<Icon icon="meeting" size={16} />} label={`${q.data?.title || 'Call recording'}${range}`} />;
}

function MeetingContext({ meetingId }: { meetingId: string }) {
  const meeting = useMeeting(meetingId);
  return <Chip icon={<Icon icon="meeting" size={16} />} label={meeting.data?.title || 'Meeting'} />;
}

function ListContext({ listId }: { listId: string }) {
  const def = useObjectDefinition(listId);
  return <Chip icon={<Icon icon="list" size={16} />} label={def?.pluralNoun || 'List'} />;
}

export function ContextChip({ context }: { context: AiContext }) {
  if (context.call) return <CallContext call={context.call} />;
  if (context.meeting) return <MeetingContext meetingId={context.meeting.meetingId} />;
  const record = context.records?.[0];
  if (record) return <RecordContext {...record} />;
  if (context.listId) return <ListContext listId={context.listId} />;
  return null;
}

/** Whether a context has anything to show as a chip. */
export function hasContext(context: AiContext): boolean {
  return Boolean(context.call || context.meeting || context.records?.length || context.listId);
}
