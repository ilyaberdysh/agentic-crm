// Shared pieces of the calls UI: the call icon, the speaker chip (members with their name and avatar, X-28; persons as
// record chips with a hover card; unknown speakers with the provided name), participant stacks.
import type { CallSpeaker } from '@agentic-crm/contracts';
import { Avatar, AvatarGroup, HoverCard, hueForSeed, Icon } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import { recordPath, useMembers, useRecordTitle } from '../attributes';
import { MemberAvatar } from '../attributes/ui/primitives';
import { useWorkspace } from '../shell/workspaceContext';
import * as s from './parts.css';

/** A rounded square in a hue hashed from the recording id (I calls) with the camera glyph. */
export function CallIcon({ id, size = 24 }: { id?: string; size?: number }) {
  const hue = id ? hueForSeed(id) : null;
  return (
    <span
      className={`${s.callIcon} ${hue ? s.callIconHue[hue as keyof typeof s.callIconHue] : s.callIconNeutral}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon icon="meeting" size={Math.round(size * 0.58)} />
    </span>
  );
}

interface ParticipantLike {
  id: string;
  name: string | null;
  emailAddress: string | null;
  memberId: string | null;
}

/** Stacked participant avatars (members with their name and image, others by name / address). */
export function ParticipantStack({
  participants,
  size = 20,
  max = 3,
}: {
  participants: readonly ParticipantLike[];
  size?: 16 | 20 | 24;
  max?: number;
}) {
  const members = useMembers();
  const items = participants.map((p) => {
    const member = p.memberId ? members.find((m) => m.id === p.memberId) : undefined;
    const name =
      (member ? [member.firstName, member.lastName].filter(Boolean).join(' ') || member.emailAddress : '') ||
      p.name ||
      p.emailAddress ||
      '?';
    return {
      id: p.id,
      name,
      kind: member ? ('member' as const) : ('person' as const),
      seed: p.memberId ?? p.emailAddress ?? name,
    };
  });
  return (
    <span className={s.stack} data-testid="participant-stack">
      <AvatarGroup items={items} size={size} max={max} />
    </span>
  );
}

/** Hover card of a speaker's person record: avatar, name, address, a link to the record. */
function PersonCard({ speaker, href }: { speaker: CallSpeaker; href: string | null }) {
  return (
    <div className={s.hoverCard} data-testid="speaker-hover-card">
      <div className={s.hoverHead}>
        <Avatar name={speaker.name} kind="person" size={32} seed={speaker.person?.entityInstanceId ?? speaker.name} />
        <div className={s.hoverTexts}>
          <span className={s.hoverTitle}>{speaker.name}</span>
          {speaker.emailAddress && <span className={s.hoverSub}>{speaker.emailAddress}</span>}
        </div>
      </div>
      {href && (
        <a className={s.hoverOpen} href={href}>
          Open record
        </a>
      )}
    </div>
  );
}

/**
 * One speaker: members show their name and avatar, people show a record chip with a hover card, and other speakers
 * keep the name provided by the importer.
 */
export function SpeakerChip({ speaker, interactive = true }: { speaker: CallSpeaker | null; interactive?: boolean }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const members = useMembers();
  const person = speaker?.person ?? null;
  const { definition } = useRecordTitle(person?.entityDefinitionId ?? '', '');
  if (!speaker) {
    return (
      <span className={s.speaker} data-testid="speaker-chip" data-kind="unknown">
        <Avatar name="Unknown" size={16} seed="unknown" color="grey" />
        <span className={s.speakerName} data-testid="speaker-name">
          Unknown
        </span>
      </span>
    );
  }
  if (speaker.kind === 'member') {
    const member = speaker.memberId ? members.find((m) => m.id === speaker.memberId) : undefined;
    return (
      <span className={s.speaker} data-testid="speaker-chip" data-kind="member">
        {member ? (
          <MemberAvatar member={member} size={16} />
        ) : (
          <Avatar name={speaker.name} kind="member" size={16} seed={speaker.memberId ?? speaker.name} />
        )}
        <span className={s.speakerName} data-testid="speaker-name">
          {speaker.name}
        </span>
      </span>
    );
  }
  if (speaker.kind === 'person' && person) {
    const href = interactive ? recordPath(workspace.slug, definition, person.entityInstanceId) : null;
    const open = (e: MouseEvent) => {
      if (!href || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      void navigate({ href });
    };
    const chip = (
      <a
        className={`${s.speaker} ${href ? s.speakerLink : ''}`}
        href={href ?? undefined}
        onClick={open}
        data-testid="speaker-chip"
        data-kind="person"
        data-record-id={person.entityInstanceId}
      >
        <span className={s.personGlyph} aria-hidden="true">
          <Icon icon="person" size={10} />
        </span>
        <span className={s.speakerName} data-testid="speaker-name">
          {speaker.name}
        </span>
      </a>
    );
    return interactive ? (
      <HoverCard content={<PersonCard speaker={speaker} href={href} />} width={280} placement="bottom-start">
        {chip}
      </HoverCard>
    ) : (
      chip
    );
  }
  return (
    <span className={s.speaker} data-testid="speaker-chip" data-kind={speaker.kind}>
      <Avatar name={speaker.name} kind="person" size={16} seed={speaker.emailAddress ?? speaker.name} />
      <span className={s.speakerName} data-testid="speaker-name">
        {speaker.name}
      </span>
    </span>
  );
}
