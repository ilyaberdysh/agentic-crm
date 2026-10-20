// The Transcript tab (I calls): speaker blocks (one block per run of a
// speaker, paragraphs on pauses), `m:ss` timestamp buttons, a text selection popover (Copy link to section · Copy selection
// · Ask AI), and range links `…/transcript?start=<s>&end=<s>` that scroll to the range and dim the rest. Without a
// player a timestamp highlights its block (a shareable section link) and speaker focus dims the other speakers.
import { Icon, IconButton, toast } from '@agentic-crm/ui';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { openAsk } from '../ask';
import { useWorkspace } from '../shell/workspaceContext';
import { callPath, copyText } from './actions';
import { useCallPage } from './callContext';
import { useTranscript } from './data';
import {
  blockViews,
  formatTimestamp,
  parseRange,
  quoteSelection,
  rangeIndexes,
  rangeLink,
  selectionRange,
  selectionText,
  type TimeRange,
} from './model';
import * as s from './page.css';
import { SpeakerChip } from './parts';

interface Selected {
  indexes: number[];
  x: number;
  y: number;
}

const MENU_WIDTH = 176;
const MENU_HEIGHT = 112;

/** The utterances a text selection covers and where its popover goes (below the end, above the start near the bottom). */
function readSelection(root: HTMLElement): Selected | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const covered = [...root.querySelectorAll<HTMLElement>('[data-utterance-index]')].filter((el) =>
    range.intersectsNode(el),
  );
  if (covered.length === 0) return null;
  const rects = range.getClientRects();
  const first = rects[0];
  const last = rects[rects.length - 1];
  if (!first || !last) return null;
  const below = last.bottom + 6;
  const fitsBelow = below + MENU_HEIGHT < window.innerHeight - 8;
  return {
    indexes: covered.map((el) => Number(el.dataset.utteranceIndex)),
    x: Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, last.right)),
    y: fitsBelow ? below : Math.max(8, first.top - MENU_HEIGHT - 6),
  };
}

export function TranscriptTab() {
  const { call, recordingId, meetingId, focusSpeakerId, setFocusSpeakerId } = useCallPage();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const transcript = useTranscript(recordingId);
  const search = useSearch({ strict: false }) as { start?: unknown; end?: unknown };
  const range = useMemo(() => parseRange(search.start, search.end), [search.start, search.end]);
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  const data = transcript.data;
  const views = useMemo(
    () => (data ? blockViews(data, { range, focusSpeakerId }) : []),
    [data, range?.start, range?.end, focusSpeakerId],
  );
  const plain = useMemo(() => (data ? blockViews(data) : []), [data]);

  // A range link scrolls to its first utterance (once the transcript is there).
  const rangeKey = range ? `${range.start}:${range.end}` : '';
  const loaded = data !== undefined;
  useEffect(() => {
    if (!range || !data || !root.current) return;
    const first = rangeIndexes(data.utterances, range)[0];
    if (first === undefined) return;
    const el = root.current.querySelector<HTMLElement>(`[data-utterance-index="${first}"]`);
    el?.closest<HTMLElement>('[data-block]')?.scrollIntoView({ block: 'start' });
  }, [rangeKey, loaded]);

  // Speaker focus scrolls to the speaker's first block.
  useEffect(() => {
    if (!focusSpeakerId || !root.current) return;
    root.current
      .querySelector<HTMLElement>(`[data-speaker-id="${focusSpeakerId}"]`)
      ?.scrollIntoView({ block: 'start' });
  }, [focusSpeakerId, loaded]);

  // The selection popover shows after the pointer is released (or a keyboard selection) and hides when it collapses.
  useEffect(() => {
    let dragging = false;
    const update = () => {
      const node = root.current;
      setSelected(node ? readSelection(node) : null);
    };
    const onDown = (e: MouseEvent) => {
      dragging = Boolean(root.current?.contains(e.target as Node));
      if (!(e.target as HTMLElement).closest?.('[data-selection-menu]')) setSelected(null);
    };
    const onUp = () => {
      if (dragging) setTimeout(update, 0);
      dragging = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && root.current?.contains(document.activeElement ?? null)) setTimeout(update, 0);
    };
    const onChange = () => {
      if (!dragging && window.getSelection()?.isCollapsed) setSelected(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onKey);
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keyup', onKey);
      document.removeEventListener('selectionchange', onChange);
    };
  }, []);

  const utterancesOf = (indexes: number[]) => {
    const wanted = new Set(indexes);
    return (data?.utterances ?? []).filter((u) => wanted.has(u.index));
  };

  const setRange = (next: TimeRange | null) =>
    void navigate({
      to: callPath(workspace.slug, meetingId, recordingId, 'transcript'),
      search: (next ? { start: next.start, end: next.end } : {}) as never,
      replace: true,
    });

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelected(null);
  };

  const copyLink = async () => {
    if (!selected) return;
    const sectionRange = selectionRange(utterancesOf(selected.indexes));
    if (!sectionRange) {
      toast.error({ title: 'No section selected' });
      return;
    }
    await copyText(
      rangeLink(window.location.origin, callPath(workspace.slug, meetingId, recordingId, 'transcript'), sectionRange),
    );
    clearSelection();
  };
  const copySelection = async () => {
    if (!selected) return;
    await copyText(selectionText(plain, new Set(selected.indexes)));
    clearSelection();
  };
  const ask = () => {
    if (!selected) return;
    const sectionRange = selectionRange(utterancesOf(selected.indexes));
    // A new chat about this section: the call and the range as its context chip, the selected text quoted in the composer.
    openAsk({
      context: {
        call: {
          meetingId,
          callRecordingId: recordingId,
          ...(sectionRange ? { startTime: sectionRange.start, endTime: sectionRange.end } : {}),
        },
      },
      prompt: quoteSelection(selectionText(plain, new Set(selected.indexes))),
    });
    clearSelection();
  };

  if (transcript.isError)
    return (
      <div className={s.state} data-testid="transcript-error">
        <span className={s.stateText}>The transcript could not be loaded. Refresh the page to try again.</span>
      </div>
    );
  if (!data)
    return (
      <div className={s.state} data-testid="transcript-loading">
        <span className={s.stateText}>Loading transcript...</span>
      </div>
    );
  if (data.utterances.length === 0)
    return (
      <div className={s.state} data-testid="transcript-empty">
        <span className={s.stateTitle}>
          {call.status === 'processing'
            ? 'Transcript analysis in progress...'
            : 'This call recording has no transcript'}
        </span>
        {call.status === 'processing' && <span className={s.stateText}>The transcript will be available soon</span>}
      </div>
    );

  const focusSpeaker = focusSpeakerId ? data.speakers.find((sp) => sp.id === focusSpeakerId) : null;
  return (
    <div
      ref={root}
      className={s.transcript}
      data-testid="transcript"
      onCopy={(e) => {
        const node = root.current;
        const sel = node ? readSelection(node) : null;
        if (!sel) return;
        e.clipboardData.setData('text/plain', selectionText(plain, new Set(sel.indexes)));
        e.preventDefault();
      }}
    >
      {range && (
        <div className={s.rangeBar}>
          <span className={s.focusChipInner} data-testid="transcript-range">
            <Icon icon="link" size={14} />
            Section {formatTimestamp(range.start)} – {formatTimestamp(range.end)}
            <IconButton
              icon="close"
              size={20}
              aria-label="Show full transcript"
              tooltip="Show full transcript"
              onPress={() => setRange(null)}
              data-testid="transcript-range-clear"
            />
          </span>
        </div>
      )}
      {focusSpeaker && !range && (
        <div className={s.focusChip}>
          <span className={s.focusChipInner} data-testid="transcript-focus">
            Focusing on {focusSpeaker.name}
            <IconButton
              icon="close"
              size={20}
              aria-label="Remove focus from speaker"
              tooltip="Remove focus from speaker"
              onPress={() => setFocusSpeakerId(null)}
            />
          </span>
        </div>
      )}
      {views.map((block) => (
        <div
          key={block.key}
          className={`${s.block} ${block.dimmed ? s.dimmed : ''}`}
          data-block=""
          data-testid="transcript-block"
          data-speaker-id={block.speakerId ?? undefined}
          data-dimmed={block.dimmed || undefined}
          data-start={block.start}
        >
          <div className={s.blockHead}>
            <SpeakerChip speaker={block.speaker} />
            <button
              type="button"
              className={s.timestamp}
              data-testid="transcript-timestamp"
              aria-label={`Highlight the section from ${formatTimestamp(block.start)}`}
              onClick={() => setRange({ start: block.start, end: block.end })}
            >
              {formatTimestamp(block.start)}
            </button>
          </div>
          {block.paragraphs.map((p) => (
            <p key={p.start} className={s.paragraph} data-testid="transcript-paragraph">
              {p.utterances.map((u, i) => (
                <Fragment key={u.index}>
                  <span
                    className={`${s.utterance} ${u.dimmed ? s.dimmed : ''}`}
                    data-utterance-index={u.index}
                    data-start={u.start}
                    data-end={u.end}
                    data-dimmed={u.dimmed || undefined}
                  >
                    {u.text}
                  </span>
                  {i < p.utterances.length - 1 ? ' ' : null}
                </Fragment>
              ))}
            </p>
          ))}
        </div>
      ))}
      {selected && (
        <div
          className={s.selectionMenu}
          style={{ left: selected.x, top: selected.y }}
          role="menu"
          aria-label="Selection actions"
          data-selection-menu=""
          data-testid="selection-menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className={s.selectionItem}
            onClick={() => void copyLink()}
            data-testid="selection-copy-link"
          >
            <Icon icon="link" size={16} />
            Copy link to section
          </button>
          <button
            type="button"
            role="menuitem"
            className={s.selectionItem}
            onClick={() => void copySelection()}
            data-testid="selection-copy"
          >
            <Icon icon="copy" size={16} />
            Copy selection
          </button>
          <button type="button" role="menuitem" className={s.selectionItem} onClick={ask} data-testid="selection-ask">
            <Icon icon="chat" size={16} />
            Ask AI
          </button>
        </div>
      )}
    </div>
  );
}
