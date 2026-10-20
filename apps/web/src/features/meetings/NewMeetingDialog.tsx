// The "New meeting" dialog of the Activity tab's "Add meeting" (BACKLOG 7.04; D README §3.8; evidence
// D/D-add-meeting-dialog.png): a centred 808 px dialog over a dimmed page with a borderless title and description,
// "Date and time" (date button + start / end time + duration), "Participants" (the current member as Host, "+" adds
// members, people and typed addresses, "Make host"), "Linked records" (the record pre-linked) and the footer
// "Cancel ESC" / "Create meeting ⌘↵". A meeting needs two participants. The meeting id is minted here (I3).
import type { RecordRefInput } from '@agentic-crm/contracts';
import { Button, cx, DialogHeader, Icon, IconButton, Modal, Popover, toast } from '@agentic-crm/ui';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { errorEnvelopeOf } from '../../data/trpc';
import { newId } from '../../lib/ids';
import { RecordAvatar, RecordPicker, useMembers, useRecordTitle } from '../attributes';
import { memberName } from '../attributes/format/formatValue';
import { recordKind } from '../attributes/ui/primitives';
import { openWindow } from '../overlays';
import { useWorkspace } from '../shell/workspaceContext';
import { useCalendar } from '../tasks';
import { DeadlinePicker } from '../tasks/DeadlinePicker';
import { deadlineChipLabel } from '../tasks/deadline';
import { useCreateMeeting } from './data';
import * as s from './meetings.css';
import {
  type ClockTime,
  defaultMeetingTimes,
  draftDuration,
  draftInstants,
  formatClockTime,
  type MeetingDraftTimes,
  parseClockTime,
  participantsError,
  shiftEnd,
} from './model';
import { ParticipantPicker, type PickedParticipant } from './ParticipantPicker';
import { ParticipantAvatar } from './parts';

interface DraftParticipant extends PickedParticipant {
  isHost: boolean;
}

export interface NewMeetingDialogProps {
  /** The record the dialog was opened on (pre-linked). */
  record?: RecordRefInput;
  onClose: () => void;
}

export function NewMeetingDialog({ record, onClose }: NewMeetingDialogProps) {
  const { workspace } = useWorkspace();
  const members = useMembers();
  const calendar = useCalendar();
  const create = useCreateMeeting();
  const meetingId = useRef(newId());
  const me = members.find((m) => m.id === workspace.membership.id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [times, setTimes] = useState<MeetingDraftTimes>(() => defaultMeetingTimes(Date.now(), calendar.timeZone));
  const [participants, setParticipants] = useState<DraftParticipant[]>(() => [
    {
      key: `m:${workspace.membership.id}`,
      memberId: workspace.membership.id,
      emailAddress: null,
      name: null,
      personId: null,
      isHost: true,
    },
  ]);
  const [linked, setLinked] = useState<RecordRefInput[]>(() => (record ? [record] : []));
  const [error, setError] = useState<string | null>(null);

  const taken = useMemo(() => new Set(participants.map((p) => p.key)), [participants]);
  const addParticipant = useCallback((p: PickedParticipant) => {
    setParticipants((list) => (list.some((x) => x.key === p.key) ? list : [...list, { ...p, isHost: false }]));
    setError(null);
  }, []);

  const submit = () => {
    if (create.isPending) return;
    const problem = participantsError(participants.length);
    if (problem) {
      setError(problem);
      return;
    }
    const instants = draftInstants(times, calendar.timeZone);
    create.mutate(
      {
        id: meetingId.current,
        title: title.trim(),
        description,
        start: { datetime: instants.start, timezone: calendar.timeZone },
        end: { datetime: instants.end, timezone: calendar.timeZone },
        isAllDay: false,
        participants: participants.map((p) => ({
          ...(p.memberId ? { memberId: p.memberId } : { emailAddress: p.emailAddress as string }),
          ...(p.name && !p.memberId ? { name: p.name } : {}),
          isOrganizer: p.isHost,
        })),
        linkedRecords: linked,
      },
      {
        onSuccess: (meeting) => {
          toast({
            title: 'Meeting created',
            action: { label: 'View meeting', onAction: () => openWindow('meeting', meeting.id, {}) },
          });
          onClose();
        },
        onError: (e) => toast.error({ title: 'Failed to create the meeting', description: errorEnvelopeOf(e).message }),
      },
    );
  };

  const nameOf = (p: DraftParticipant) =>
    (p.memberId ? memberName(members.find((m) => m.id === p.memberId)) : '') || p.name || p.emailAddress || 'Unknown';
  const addressOf = (p: DraftParticipant) =>
    p.memberId ? (members.find((m) => m.id === p.memberId)?.emailAddress ?? null) : p.emailAddress;

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} size={808} overlay aria-label="New meeting" isDismissable>
      <div
        data-testid="new-meeting-dialog"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader title="New meeting" icon={<Icon icon="calendar" size={16} />} onClose={onClose} />
        <div className={s.newBody}>
          <div className={s.newHead}>
            <input
              className={s.newTitle}
              placeholder="Meeting title"
              aria-label="Meeting title"
              data-testid="new-meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <textarea
              className={s.newDescription}
              placeholder="Add a description"
              aria-label="Description"
              data-testid="new-meeting-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <section className={cx(s.newSection, s.whenSection)} aria-label="Date and time">
            <div className={s.newLabelRow}>Date and time</div>
            <div className={s.whenRow} data-testid="new-meeting-when">
              <Popover
                aria-label="Date"
                placement="bottom start"
                padding={0}
                trigger={
                  <AriaButton className={s.dateButton} data-testid="new-meeting-date">
                    {deadlineChipLabel({ date: times.date, time: null }, calendar.today(), calendar.locale)}
                  </AriaButton>
                }
              >
                {({ close }) => (
                  <DeadlinePicker
                    value={{ date: times.date, time: null }}
                    calendar={calendar}
                    onChange={(d) => {
                      if (d) setTimes((t) => ({ ...t, date: d.date }));
                      close();
                    }}
                  />
                )}
              </Popover>
              <span className={s.whenDivider} aria-hidden="true" />
              <TimeField
                label="Start time"
                value={times.start}
                onCommit={(t) => setTimes((cur) => shiftEnd(cur, t))}
                testId="new-meeting-start"
              />
              <Icon icon="arrowRight" size={16} className={s.arrow} />
              <TimeField
                label="End time"
                value={times.end}
                onCommit={(t) => setTimes((cur) => ({ ...cur, end: t }))}
                testId="new-meeting-end"
              />
              <span className={s.duration} data-testid="new-meeting-duration">
                ({draftDuration(times)})
              </span>
            </div>
          </section>

          <section className={cx(s.newSection, s.peopleSection)} aria-label="Participants">
            <div className={s.newLabelRow}>
              Participants
              <Popover
                aria-label="Add participant"
                placement="bottom end"
                padding={0}
                trigger={
                  <IconButton
                    icon="add"
                    size={20}
                    aria-label="Add participant"
                    tooltip="Add participant"
                    data-testid="new-meeting-add-participant"
                  />
                }
              >
                {({ close }) => (
                  <div className={s.pickerBox}>
                    <ParticipantPicker
                      taken={taken}
                      onPick={(p) => {
                        addParticipant(p);
                        close();
                      }}
                    />
                  </div>
                )}
              </Popover>
            </div>
            {error && (
              <div className={s.newError} role="alert" data-testid="new-meeting-error">
                {error}
              </div>
            )}
            {participants.map((p, i) => (
              <div
                key={p.key}
                className={cx(s.newPerson, i === 0 && !error && s.firstRow)}
                data-testid="new-meeting-participant"
              >
                <ParticipantAvatar name={nameOf(p)} memberId={p.memberId} seed={p.emailAddress} />
                <span style={{ fontWeight: 500 }}>{nameOf(p)}</span>
                {p.isHost && <span className={s.hostTag}>Host</span>}
                {addressOf(p) && addressOf(p) !== nameOf(p) && <span className={s.email}>{addressOf(p)}</span>}
                {!p.isHost && (
                  <span className={s.personRight}>
                    <span className={s.reveal} data-reveal="">
                      <Button
                        variant="ghost"
                        size={20}
                        onPress={() => setParticipants((list) => list.map((x) => ({ ...x, isHost: x.key === p.key })))}
                      >
                        Make host
                      </Button>
                      <IconButton
                        icon="close"
                        size={20}
                        aria-label={`Remove ${nameOf(p)}`}
                        onPress={() => setParticipants((list) => list.filter((x) => x.key !== p.key))}
                      />
                    </span>
                  </span>
                )}
              </div>
            ))}
          </section>

          <section className={cx(s.newSection, s.linkedSection)} aria-label="Linked records">
            <div className={s.newLabelRow}>
              Linked records
              <Popover
                aria-label="Add record"
                placement="bottom end"
                padding={0}
                trigger={
                  <IconButton
                    icon="add"
                    size={20}
                    aria-label="Add record"
                    tooltip="Add record"
                    data-testid="new-meeting-add-record"
                  />
                }
              >
                <div className={s.pickerBox}>
                  <RecordPicker
                    entityDefinitionIds={null}
                    multiple
                    selected={linked.map((r) => ({
                      entityDefinitionId: String(r.entityDefinitionId),
                      entityInstanceId: r.entityInstanceId,
                    }))}
                    placeholder="Search records..."
                    label="Linked records"
                    onSelect={(r, isSelected) =>
                      setLinked((list) =>
                        isSelected
                          ? list.filter((x) => x.entityInstanceId !== r.entityInstanceId)
                          : [
                              ...list,
                              { entityDefinitionId: r.entityDefinitionId, entityInstanceId: r.entityInstanceId },
                            ],
                      )
                    }
                  />
                </div>
              </Popover>
            </div>
            {linked.map((r, i) => (
              <div
                key={r.entityInstanceId}
                className={cx(s.newPerson, i === 0 && s.recordRow)}
                data-testid="new-meeting-linked"
              >
                <LinkedRecord entityDefinitionId={String(r.entityDefinitionId)} entityInstanceId={r.entityInstanceId} />
                <span className={s.personRight}>
                  <span className={s.reveal} data-reveal="">
                    <IconButton
                      icon="close"
                      size={20}
                      aria-label="Remove linked record"
                      onPress={() => setLinked((list) => list.filter((x) => x.entityInstanceId !== r.entityInstanceId))}
                    />
                  </span>
                </span>
              </div>
            ))}
          </section>
        </div>
        <div className={s.newFooter}>
          <Button variant="secondary" size={28} shortcut={['esc']} onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size={28}
            shortcut={['mod', 'enter']}
            isPending={create.isPending}
            onPress={submit}
            data-testid="new-meeting-create"
          >
            Create meeting
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** A time field: "11:00 PM"; commits on blur or ⏎ when it parses, otherwise reverts. */
function TimeField({
  label,
  value,
  onCommit,
  testId,
}: {
  label: string;
  value: ClockTime;
  onCommit: (time: ClockTime) => void;
  testId: string;
}) {
  const shown = formatClockTime(value);
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (text === null) return;
    const parsed = parseClockTime(text);
    if (parsed) {
      onCommit(parsed);
      setInvalid(false);
      setText(null);
    } else {
      setInvalid(true);
      setText(null);
      setTimeout(() => setInvalid(false), 1200);
    }
  };
  return (
    <input
      className={s.timeInput}
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-testid={testId}
      value={text ?? shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          commit();
        }
      }}
    />
  );
}

/** A linked record row: its avatar (20 px) and display name, as in the capture (no chip chrome). */
function LinkedRecord({
  entityDefinitionId,
  entityInstanceId,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
}) {
  const { title, definition } = useRecordTitle(entityDefinitionId, entityInstanceId);
  return (
    <>
      <RecordAvatar kind={recordKind(definition)} size={20} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {title || entityInstanceId}
      </span>
    </>
  );
}
