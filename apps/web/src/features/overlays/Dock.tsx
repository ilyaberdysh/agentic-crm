// Dock of detached windows (E README §2.2 "Minimize"; F composer §2.11): 32 px round bubbles at the bottom right, one
// per minimised or floating window — the kind's icon (note, template, composer, …), the parent record's object as a
// corner badge, a small ✕ on hover and the title as a tooltip on the left. Clicking a minimised bubble floats the
// window; clicking the floating window's bubble minimises it.
import { Icon, type IconGlyph, type IconName, Tooltip } from '@agentic-crm/ui';
import { Button } from 'react-aria-components';
import { useWindowSummary, WindowBubbleBadge } from '../notes/summary';
import type { DetachedWindow } from './model';
import * as s from './overlays.css';
import { getWindowOptions, type WindowSummary } from './registry';
import { closeWindow, floatWindow, minimizeWindow } from './store';

function BubbleView({
  window: w,
  summary,
  icon,
  untitled,
}: {
  window: DetachedWindow;
  summary: WindowSummary;
  icon: IconName | IconGlyph;
  untitled: string;
}) {
  const title = summary.title || untitled;
  return (
    <div className={s.bubbleWrap} data-testid="dock-bubble" data-window-id={w.id} data-kind={w.kind} data-mode={w.mode}>
      <Tooltip content={title} placement="left">
        <Button
          className={s.bubble}
          aria-label={w.mode === 'floating' ? `Minimize ${title}` : `Open ${title}`}
          data-active={w.mode === 'floating' || undefined}
          onPress={() => (w.mode === 'floating' ? minimizeWindow(w.kind, w.id) : floatWindow(w.kind, w.id))}
        >
          <Icon icon={icon} size={16} />
          {summary.record && (
            <span className={s.bubbleBadge}>
              <WindowBubbleBadge record={summary.record} />
            </span>
          )}
        </Button>
      </Tooltip>
      <Button className={s.bubbleClose} aria-label={`Close ${title}`} onPress={() => closeWindow(w.kind, w.id)}>
        <Icon icon="close" size={12} />
      </Button>
    </div>
  );
}

function BuiltInBubble({ window: w }: { window: DetachedWindow }) {
  const summary = useWindowSummary(w.kind, w.id);
  return (
    <BubbleView
      window={w}
      summary={summary}
      icon={w.kind === 'note-template' ? 'noteTemplate' : 'notes'}
      untitled={w.kind === 'note-template' ? 'Untitled Template' : 'Untitled note'}
    />
  );
}

/** A registered kind (composer, …): its own summary hook, always the same one for a given bubble. */
function RegisteredBubble({
  window: w,
  useSummary,
}: {
  window: DetachedWindow;
  useSummary: (id: string) => WindowSummary;
}) {
  const options = getWindowOptions(w.kind);
  const summary = useSummary(w.id);
  return (
    <BubbleView window={w} summary={summary} icon={options.icon ?? 'notes'} untitled={options.untitled ?? 'Window'} />
  );
}

function Bubble({ window: w }: { window: DetachedWindow }) {
  const useSummary = getWindowOptions(w.kind).useSummary;
  return useSummary ? <RegisteredBubble window={w} useSummary={useSummary} /> : <BuiltInBubble window={w} />;
}

export function Dock({ windows }: { windows: DetachedWindow[] }) {
  if (windows.length === 0) return null;
  return (
    <div className={s.dock} data-testid="window-dock">
      {windows.map((w) => (
        <Bubble key={`${w.kind}:${w.id}`} window={w} />
      ))}
    </div>
  );
}
