// The "Meeting" modal (BACKLOG 7.04; F README §2.4), opened at `?modal=meeting&id=<meetingId>` (a timeline card, the
// Home widget or a link): the date tile, title and the viewer's RSVP pill, the time and description rows, "Call
// intelligence", participants (first three, "Show all"), linked records with "+" and a dashed "Link records" button,
// and the footer "Ask Agentic" / "Create note". Synced meetings are read-only apart from their linked records; manual
// ones edit their title and description in place.

import type { RecordRefInput } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Button,
  DialogHeader,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  Skeleton,
  toast,
} from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf, httpStatusOf } from '../../data/trpc';
import { openAsk } from '../ask';
import { RecordChip, RecordPicker, useRecordTitle } from '../attributes';
import { createNote } from '../notes';
import { closeWindow, openNote, type WindowContentProps } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from '../tasks';
import { type Meeting, useDeleteMeeting, useMeeting, useRecordings, useUpdateMeeting, useWsRef } from './data';
import * as s from './meetings.css';
import { calendarTile, isPast, meetingTimeLabel } from './model';
import { ParticipantAvatar, RsvpPill, useNow, useParticipantName } from './parts';

export const PRIVATE_MEETING = 'Private meeting';
const SHOWN_PARTICIPANTS = 3;

export function MeetingModal({ id }: WindowContentProps) {
  const meeting = useMeeting(id);
  const close = () => closeWindow('meeting', id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteMeeting();
  const canDelete = meeting.data && !meeting.data.isReadOnly;
  return (
    <div className={s.modal} data-testid="meeting-modal" data-meeting-id={id}>
      <DialogHeader
        title="Meeting"
        icon={<Icon icon="calendar" size={16} />}
        onClose={close}
        actions={
          canDelete ? (
            <MenuTrigger>
              <IconButton icon="moreVertical" aria-label="Meeting options" tooltip="Meeting options" />
              <Menu aria-label="Meeting options" placement="bottom end" onAction={() => setConfirmDelete(true)}>
                <MenuItem id="delete" icon="delete" variant="danger">
                  Delete meeting
                </MenuItem>
              </Menu>
            </MenuTrigger>
          ) : undefined
        }
      />
      {meeting.isPending ? (
        <div className={s.modalScroll} style={{ padding: 20 }} data-testid="meeting-loading">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <Skeleton width={40} height={40} />
            <Skeleton width={260} height={16} />
          </div>
          <Skeleton width={200} height={12} />
        </div>
      ) : meeting.isError ? (
        <div className={s.stateBox} data-testid="meeting-unavailable">
          <Icon icon="lock" size={24} />
          <div className={s.stateTitle}>Meeting unavailable</div>
          <div className={s.stateText}>
            {httpStatusOf(meeting.error) === 404
              ? "This meeting doesn't exist, or you don't have access to it."
              : 'The meeting could not be loaded. Try again in a moment.'}
          </div>
        </div>
      ) : (
        <MeetingBody meeting={meeting.data} />
      )}
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this meeting?"
        description="The meeting is removed from every record it appears on."
        confirmLabel="Delete meeting"
        onConfirm={() =>
          remove.mutate(id, {
            onSuccess: () => {
              toast({ title: 'Meeting deleted' });
              close();
            },
            onError: (e) =>
              toast.error({ title: 'Failed to delete the meeting', description: errorEnvelopeOf(e).message }),
          })
        }
      />
    </div>
  );
}

/** Records a note on this meeting belongs to: its linked records, else the records of matched participants. */
export function noteParents(meeting: Pick<Meeting, 'linkedRecords' | 'participants'>): RecordRefInput[] {
  const out: RecordRefInput[] = meeting.linkedRecords.map((r) => ({
    entityDefinitionId: r.entityDefinitionId,
    entityInstanceId: r.entityInstanceId,
  }));
  if (out.length === 0) {
    for (const p of meeting.participants) {
      if (p.personId) out.push({ entityDefinitionId: 'people', entityInstanceId: p.personId });
      else if (p.companyId) out.push({ entityDefinitionId: 'companies', entityInstanceId: p.companyId });
    }
  }
  const seen = new Set<string>();
  return out.filter((r) => !seen.has(r.entityInstanceId) && seen.add(r.entityInstanceId)).slice(0, 20);
}

function MeetingBody({ meeting }: { meeting: Meeting }) {
  const { workspace } = useWorkspace();
  const ws = useWsRef();
  const client = useQueryClient();
  const { timeZone } = useCalendar();
  const now = useNow();
  const update = useUpdateMeeting();
  const past = isPast(meeting, now);
  const full = meeting.access === 'full-access';
  const editable = !meeting.isReadOnly && full;
  const mine = meeting.participants.find((p) => p.memberId === workspace.membership.id);
  const tile = calendarTile(meeting, timeZone);
  const [creatingNote, setCreatingNote] = useState(false);

  const fail = (what: string) => (e: unknown) => toast.error({ title: what, description: errorEnvelopeOf(e).message });

  const createMeetingNote = async () => {
    const parents = noteParents(meeting);
    if (parents.length === 0) {
      toast.error({
        title: 'Link a record first',
        description: 'A note belongs to a record. Link one to this meeting to create a note.',
      });
      return;
    }
    setCreatingNote(true);
    try {
      const note = await createNote(client, ws, {
        title: meeting.title ?? '',
        parentRecords: parents,
        meetingId: meeting.id,
      });
      openNote(note.id);
    } catch (e) {
      fail('Failed to create the note')(e);
    } finally {
      setCreatingNote(false);
    }
  };

  return (
    <>
      <div className={s.modalScroll}>
        <div className={s.titleRow}>
          <div className={s.tile} aria-hidden="true" data-testid="meeting-tile">
            <span className={s.tileMonth}>{tile.month}</span>
            <span className={s.tileDay}>{tile.day}</span>
          </div>
          {editable ? (
            <TitleInput meeting={meeting} />
          ) : (
            <h2 className={s.titleText} data-private={meeting.title === null || undefined} data-testid="meeting-title">
              {meeting.title === null ? PRIVATE_MEETING : meeting.title || 'Untitled meeting'}
            </h2>
          )}
          {mine && <RsvpPill status={mine.status} past={past} />}
        </div>
        <div className={s.infoRow} data-testid="meeting-time">
          <Icon icon="clock" size={16} className={s.infoIcon} />
          <span className={s.infoText}>{meetingTimeLabel(meeting, now, timeZone)}</span>
        </div>
        {(editable || (full && meeting.description)) && (
          <div className={s.infoRow} data-testid="meeting-description">
            <Icon icon="attrText" size={16} className={s.infoIcon} />
            {editable ? (
              <DescriptionInput meeting={meeting} />
            ) : (
              <span className={s.infoText}>{meeting.description}</span>
            )}
          </div>
        )}

        {full && <CallIntelligence meeting={meeting} />}

        <Participants meeting={meeting} past={past} />

        <LinkedRecords
          meeting={meeting}
          onChange={(linkedRecords, mode) =>
            update.mutate(
              { meetingId: meeting.id, linkedRecords, linkedRecordsMode: mode },
              { onError: fail('Failed to update the linked records') },
            )
          }
        />
      </div>
      <div className={s.footer}>
        <Button
          variant="secondary"
          size={28}
          icon="askAi"
          onPress={() => openAsk({ context: { meeting: { meetingId: meeting.id } } })}
        >
          Ask AI
        </Button>
        <Button
          variant="primary"
          size={28}
          icon="noteTab"
          isPending={creatingNote}
          onPress={() => void createMeetingNote()}
          data-testid="meeting-create-note"
        >
          Create note
        </Button>
      </div>
    </>
  );
}

function TitleInput({ meeting }: { meeting: Meeting }) {
  const update = useUpdateMeeting();
  const [value, setValue] = useState(meeting.title ?? '');
  useEffect(() => setValue(meeting.title ?? ''), [meeting.title]);
  const save = () => {
    const next = value.trim();
    if (next === (meeting.title ?? '')) return;
    update.mutate(
      { meetingId: meeting.id, title: next },
      {
        onError: (e) => toast.error({ title: 'Failed to rename the meeting', description: errorEnvelopeOf(e).message }),
      },
    );
  };
  return (
    <input
      className={s.titleInput}
      value={value}
      placeholder="Meeting title"
      aria-label="Meeting title"
      data-testid="meeting-title-input"
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function DescriptionInput({ meeting }: { meeting: Meeting }) {
  const update = useUpdateMeeting();
  const [value, setValue] = useState(meeting.description ?? '');
  useEffect(() => setValue(meeting.description ?? ''), [meeting.description]);
  return (
    <textarea
      className={s.descriptionInput}
      value={value}
      rows={Math.max(1, Math.min(6, value.split('\n').length))}
      placeholder="Add a description"
      aria-label="Description"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (meeting.description ?? '')) {
          update.mutate(
            { meetingId: meeting.id, description: value },
            { onError: (e) => toast.error({ title: 'Failed to save', description: errorEnvelopeOf(e).message }) },
          );
        }
      }}
    />
  );
}

function CallIntelligence({ meeting }: { meeting: Meeting }) {
  const { workspace } = useWorkspace();
  const recordings = useRecordings(meeting.id, meeting.callRecordingIds.length > 0);
  const list = recordings.data ?? [];
  return (
    <section className={s.section} aria-label="Call intelligence" data-testid="meeting-call-intelligence">
      <div className={s.sectionHead}>Call intelligence</div>
      {meeting.callRecordingIds.length > 0 ? (
        list.map((r) => (
          <div key={r.id} className={s.callRow} data-testid="meeting-recording">
            <Icon icon="recording" size={16} />
            <a
              className={s.link}
              href={`/${workspace.slug}/calls/${meeting.id}/${r.id}/transcript`}
              data-testid="meeting-recording-link"
            >
              Call recording
            </a>
            <span className={s.email}>{r.status}</span>
          </div>
        ))
      ) : (
        <div className={s.callLine} data-testid="meeting-recording-state">
          <Icon icon="recording" size={16} />
          {meeting.conferenceUrl ? (
            <>
              <span>No recording</span>
              <a className={s.link} href={meeting.conferenceUrl} target="_blank" rel="noreferrer">
                Open conference
              </a>
            </>
          ) : (
            <span>Meeting not recorded (No conference set up)</span>
          )}
        </div>
      )}
    </section>
  );
}

/** One participant: a member by name, a person by their record name, else the given name or address. */
function ParticipantRow({ participant: p, past }: { participant: Meeting['participants'][number]; past: boolean }) {
  const { href } = useWorkspace();
  const navigate = useNavigate();
  const nameOf = useParticipantName();
  const record = useRecordTitle(p.personId && !p.memberId && !p.name ? 'people' : '', p.personId ?? '');
  const name = record.title || nameOf(p);
  const path = p.personId ? href(`person/${p.personId}`) : p.companyId ? href(`company/${p.companyId}`) : null;
  return (
    <div className={s.person} data-testid="meeting-participant">
      <ParticipantAvatar name={name} memberId={p.memberId} seed={p.emailAddress} />
      {path ? (
        <a
          className={s.personNameLink}
          href={path}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            void navigate({ href: path });
          }}
        >
          {name}
        </a>
      ) : (
        <span className={s.personName}>{name}</span>
      )}
      {p.isOrganizer && <span className={s.hostTag}>Host</span>}
      {p.emailAddress && p.emailAddress !== name && <span className={s.email}>{p.emailAddress}</span>}
      <span className={s.personRight}>
        <RsvpPill status={p.status} past={past} />
      </span>
    </div>
  );
}

/** The participants section (also the Meeting tab of the call page, which lists everyone: `limit` null). */
export function Participants({
  meeting,
  past,
  limit = SHOWN_PARTICIPANTS,
}: {
  meeting: Meeting;
  past: boolean;
  limit?: number | null;
}) {
  const [all, setAll] = useState(false);
  const sorted = [...meeting.participants].sort((a, b) => Number(b.isOrganizer) - Number(a.isOrganizer));
  const shown = all || limit === null ? sorted : sorted.slice(0, limit);
  return (
    <section className={s.section} aria-label="Participants" data-testid="meeting-participants">
      <div className={s.sectionHead}>
        Participants <span className={s.sectionCount}>{meeting.participants.length}</span>
      </div>
      {shown.map((p) => (
        <ParticipantRow key={p.id} participant={p} past={past} />
      ))}
      {limit !== null && meeting.participants.length > limit && (
        <button type="button" className={s.showAll} aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : 'Show all'}
          <Icon icon={all ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      )}
    </section>
  );
}

/** The linked records section ( "+" adds through a record picker, × removes). */
export function LinkedRecords({
  meeting,
  onChange,
}: {
  meeting: Meeting;
  onChange: (records: RecordRefInput[], mode: 'append' | 'replace') => void;
}) {
  const selected = meeting.linkedRecords.map((r) => ({
    entityDefinitionId: r.entityDefinitionId,
    entityInstanceId: r.entityInstanceId,
  }));
  const picker = (
    <div style={{ width: 320 }}>
      <RecordPicker
        entityDefinitionIds={null}
        multiple
        selected={selected}
        placeholder="Search records..."
        label="Linked records"
        onSelect={(record, isSelected) => {
          if (isSelected) {
            onChange(
              selected.filter((r) => r.entityInstanceId !== record.entityInstanceId),
              'replace',
            );
          } else onChange([record], 'append');
        }}
      />
    </div>
  );
  return (
    <section className={s.section} aria-label="Linked records" data-testid="meeting-linked-records">
      <div className={s.sectionHead}>
        Linked records <span className={s.sectionCount}>{selected.length}</span>
        <span className={s.sectionSpacer} />
        {selected.length > 0 && (
          <Popover
            aria-label="Link records"
            placement="bottom end"
            padding={0}
            trigger={<IconButton icon="add" size={20} aria-label="Add record" tooltip="Add record" />}
          >
            {picker}
          </Popover>
        )}
      </div>
      {selected.length === 0 ? (
        <Popover
          aria-label="Link records"
          placement="bottom start"
          padding={0}
          trigger={
            <AriaButton className={s.linkRecords} data-testid="meeting-link-records">
              <Icon icon="add" size={16} />
              Link records
            </AriaButton>
          }
        >
          {picker}
        </Popover>
      ) : (
        <div className={s.linked}>
          {selected.map((r) => (
            <span key={r.entityInstanceId} className={s.linkedItem} data-testid="meeting-linked-record">
              <RecordChip entityDefinitionId={r.entityDefinitionId} entityInstanceId={r.entityInstanceId} />
              <IconButton
                icon="close"
                size={20}
                aria-label="Remove linked record"
                onPress={() =>
                  onChange(
                    selected.filter((x) => x.entityInstanceId !== r.entityInstanceId),
                    'replace',
                  )
                }
              />
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
