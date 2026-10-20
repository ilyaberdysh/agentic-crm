// The Speakers tab (I calls §3.7; evidence/I/call-page-speakers.png, call-page-speakers-focus.png): one row per speaker
// with talk share and time, and a 4 px timeline of the speaker's utterances. The round button turns on focus mode —
// the other rows dim and the Transcript tab shows only that speaker in full; it works without a player. A segment
// opens the transcript at that moment.
import { hueForSeed, Icon } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useWorkspace } from '../shell/workspaceContext';
import { callPath } from './actions';
import { useCallPage } from './callContext';
import { useSpeakerStats } from './data';
import { barSegments, formatTalkShare, formatTalkTime, timelineEnd } from './model';
import * as s from './page.css';
import { SpeakerChip } from './parts';

export function SpeakersTab() {
  const { call, recordingId, meetingId, focusSpeakerId, setFocusSpeakerId } = useCallPage();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const speakers = useSpeakerStats(recordingId);

  if (speakers.isError)
    return (
      <div className={s.state}>
        <span className={s.stateText}>The speakers could not be loaded. Refresh the page to try again.</span>
      </div>
    );
  if (!speakers.data)
    return (
      <div className={s.state}>
        <span className={s.stateText}>Loading speakers...</span>
      </div>
    );
  if (speakers.data.length === 0)
    return (
      <div className={s.state} data-testid="speakers-empty">
        <span className={s.stateTitle}>This call recording has no speakers</span>
      </div>
    );

  const total = timelineEnd(
    speakers.data.flatMap((sp) => sp.segments),
    call.transcriptDurationSeconds,
  );
  const completed = call.status === 'completed';

  return (
    <div className={s.speakers} data-testid="speakers">
      {speakers.data.map((sp) => {
        const focused = focusSpeakerId === sp.id;
        const hue = hueForSeed(sp.id) as keyof typeof s.segmentHue;
        return (
          <div
            key={sp.id}
            className={s.speakerRow}
            data-testid="speaker-row"
            data-speaker-id={sp.id}
            data-focused={focused || undefined}
            data-dimmed={focusSpeakerId !== null && !focused}
          >
            <div className={s.speakerHead}>
              {completed && (
                <button
                  type="button"
                  className={s.focusButton}
                  aria-label={focused ? 'Exit focus mode' : 'Start focus mode'}
                  title="Focus on speaker"
                  aria-pressed={focused}
                  data-testid="speaker-focus"
                  onClick={() => setFocusSpeakerId(focused ? null : sp.id)}
                >
                  <Icon icon={focused ? 'close' : 'focusPlay'} size={12} />
                </button>
              )}
              <div className={s.speakerHeadChip}>
                <SpeakerChip speaker={sp} />
              </div>
              <span className={s.speakerFigure} data-testid="speaker-share">
                {formatTalkShare(sp.talkShare)}
              </span>
              <span className={s.speakerFigure} data-testid="speaker-time">
                {formatTalkTime(sp.talkTimeSeconds)}
              </span>
            </div>
            <div className={s.timeline} data-testid="speaker-timeline">
              {barSegments(sp.segments, total).map((seg) => (
                <button
                  key={seg.start}
                  type="button"
                  className={`${s.segment} ${s.segmentHue[hue]}`}
                  style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                  aria-label={`Open the transcript at ${Math.floor(seg.start / 60)}:${String(Math.floor(seg.start % 60)).padStart(2, '0')}`}
                  disabled={!completed}
                  data-testid="speaker-segment"
                  onClick={() => {
                    setFocusSpeakerId(null);
                    void navigate({
                      to: callPath(workspace.slug, meetingId, recordingId, 'transcript'),
                      search: { start: seg.start, end: seg.end } as never,
                    });
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
