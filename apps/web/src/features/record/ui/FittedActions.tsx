// A row of 28 px secondary buttons that keeps as many labels as fit and collapses the rest, from the end, to
// icon-only buttons with tooltips (b: "Compose email" + 4 icons at 358 px, three labels at 454 px).
import { Button, type IconName, Tooltip } from '@agentic-crm/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import * as s from '../details/details.css';

export interface FittedAction {
  id: string;
  label: string;
  icon: IconName;
  onPress?: () => void;
}

const ICON_ONLY = 28;
const GAP = 8;

/** How many leading actions keep their label within `available` px (pure; unit-tested). */
export function labelledCount(widths: readonly number[], available: number, iconOnly = ICON_ONLY, gap = GAP): number {
  let k = widths.length;
  while (k > 0) {
    const used = widths.slice(0, k).reduce((a, b) => a + b, 0) + (widths.length - k) * iconOnly;
    if (used + gap * Math.max(0, widths.length - 1) <= available) break;
    k--;
  }
  return k;
}

export function FittedActions({ actions, testId }: { actions: FittedAction[]; testId?: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [labelled, setLabelled] = useState(actions.length);
  const key = actions.map((a) => `${a.id}:${a.label}`).join();

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const fit = () => {
      const widths = [...measure.children].map((c) => (c as HTMLElement).offsetWidth);
      setLabelled(labelledCount(widths, row.clientWidth));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [key]);

  return (
    <div className={s.actionsRow} ref={rowRef} data-testid={testId}>
      <div className={s.actionsMeasure} ref={measureRef} aria-hidden="true">
        {actions.map((a) => (
          <Button key={a.id} variant="secondary" size={28} icon={a.icon} excludeFromTabOrder>
            {a.label}
          </Button>
        ))}
      </div>
      {actions.map((a, i) =>
        i < labelled ? (
          <Button
            key={a.id}
            variant="secondary"
            size={28}
            icon={a.icon}
            onPress={a.onPress}
            className={labelled < actions.length ? s.actionGrow : undefined}
          >
            {a.label}
          </Button>
        ) : (
          <Tooltip key={a.id} content={a.label}>
            <Button variant="secondary" size={28} icon={a.icon} iconOnly aria-label={a.label} onPress={a.onPress} />
          </Tooltip>
        ),
      )}
    </div>
  );
}
