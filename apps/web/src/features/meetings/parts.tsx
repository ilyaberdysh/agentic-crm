// Small pieces shared by the meeting modal, the New meeting dialog, the Activity cards and the Home widget.
import type { MeetingParticipantStatus } from '@agentic-crm/contracts';
import { Avatar } from '@agentic-crm/ui';
import { useEffect, useState } from 'react';
import { useMembers } from '../attributes';
import { memberName } from '../attributes/format/formatValue';
import * as s from './meetings.css';
import { rsvpOf } from './model';

/** Re-evaluates every minute (a meeting turns from "Attending" into "Attended" while the page is open). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The status pill: a coloured dot and "Attended" / "Attending" / "Maybe" / "Declined" / "Pending". */
export function RsvpPill({ status, past }: { status: MeetingParticipantStatus; past: boolean }) {
  const rsvp = rsvpOf(status, past);
  return (
    <span className={s.pill} data-testid="meeting-rsvp" data-status={status}>
      <span className={s.dot} data-tone={rsvp.tone} aria-hidden="true" />
      {rsvp.label}
    </span>
  );
}

interface ParticipantLike {
  name: string | null;
  emailAddress: string | null;
  memberId: string | null;
}

/** What a participant is called: the member's name, else the given name, else the address. */
export function useParticipantName(): (p: ParticipantLike) => string {
  const members = useMembers();
  return (p) => {
    const member = p.memberId ? members.find((m) => m.id === p.memberId) : undefined;
    return (member ? memberName(member) : '') || p.name || p.emailAddress || 'Unknown';
  };
}

export function ParticipantAvatar({
  name,
  memberId,
  seed,
  size = 20,
}: {
  name: string;
  memberId: string | null;
  seed?: string | null;
  size?: 16 | 20 | 24;
}) {
  return <Avatar name={name} kind={memberId ? 'member' : 'person'} size={size} seed={memberId ?? seed ?? name} />;
}
