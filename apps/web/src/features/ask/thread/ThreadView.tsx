// The scrolling transcript: user and assistant turns of the current path, sticking to the bottom while an answer
// streams (a round arrow brings you back when you scrolled up), reply suggestions under the last completed answer.
import type { AiTurn } from '@agentic-crm/contracts';
import { Icon } from '@agentic-crm/ui';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AssistantTurn, ReplySuggestions } from './AssistantTurn';
import * as s from './thread.css';
import { UserTurn } from './UserTurn';

const NEAR_BOTTOM = 80;

/** A turn in which the user discarded an action offers no reply suggestions (ask-agentic §10). */
const wasDenied = (turn: AiTurn): boolean =>
  turn.steps.some((st) => st.parts.some((p) => p.type === 'tool' && p.toolStatus === 'canceled'));

export function ThreadView({
  path,
  onReply,
  columnClass,
  scrollClass,
}: {
  path: readonly AiTurn[];
  onReply: (text: string) => void;
  columnClass: string;
  scrollClass: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const toBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Follow growth of the transcript while stuck to the bottom.
  useLayoutEffect(() => {
    const target = content.current;
    if (!target || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [toBottom]);

  // A new message of the user always scrolls to it.
  const last = path[path.length - 1];
  useEffect(() => {
    if (last?.role === 'user') {
      stick.current = true;
      toBottom();
    }
  }, [last?.id, last?.role, toBottom]);

  const lastAssistant = [...path].reverse().find((t) => t.role === 'assistant');

  return (
    <div className={scrollClass} style={{ position: 'relative' }}>
      <div
        ref={scroller}
        data-testid="ask-scroll"
        style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
          stick.current = near;
          setAtBottom(near);
        }}
      >
        <div ref={content} className={columnClass}>
          <div className={s.turns} data-testid="ask-turns">
            {path.map((turn) =>
              turn.role === 'user' ? (
                <UserTurn key={turn.id} turn={turn} />
              ) : (
                <div key={turn.id}>
                  <AssistantTurn turn={turn} isLast={turn.id === lastAssistant?.id} />
                  {turn.id === lastAssistant?.id && turn === path[path.length - 1] && !wasDenied(turn) && (
                    <ReplySuggestions turn={turn} onPick={onReply} />
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
      {!atBottom && (
        <button type="button" className={s.scrollToBottom} aria-label="Scroll to bottom" onClick={() => toBottom(true)}>
          <Icon icon="arrowDown" size={16} />
        </button>
      )}
    </div>
  );
}
