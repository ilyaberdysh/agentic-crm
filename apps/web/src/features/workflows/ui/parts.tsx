// Shared workflow pieces: tinted tiles for workflows and blocks, the status chip of the index / admin / header, the
// credit pill and the run status glyph (README §2.1, §2.5; runs.md §3).
import type { RunStatus } from '@agentic-crm/contracts';
import { CheckCircleFilled, Icon, type IconName, Spinner } from '@agentic-crm/ui';
import type { CSSProperties } from 'react';
import { blockLook, workflowHue } from '../model/blocks';
import { type DisplayStatus, displayStatus, STATUS_LABELS } from '../model/list';
import type { Workflow } from '../types';
import * as s from './parts.css';

type TileSize = 16 | 20 | 24 | 28 | 32;

export function HueTile({ icon, hue, size = 24 }: { icon: IconName; hue: string; size?: TileSize }) {
  const glyph = size <= 16 ? 12 : size <= 20 ? 14 : 16;
  return (
    <span className={`${s.tile} ${s.tileSize[size]}`} style={{ '--tile-hue': hue } as CSSProperties} aria-hidden="true">
      <Icon icon={icon} size={glyph} strokeWidth={1.75} />
    </span>
  );
}

export function WorkflowTile({ workflowId, size = 24 }: { workflowId: string; size?: TileSize }) {
  return <HueTile icon="workflows" hue={workflowHue(workflowId)} size={size} />;
}

export function BlockTile({ slug, size = 24 }: { slug: string; size?: TileSize }) {
  const look = blockLook(slug);
  return <HueTile icon={look.icon} hue={look.hue} size={size} />;
}

/** "• Live" (green pill), "⏸ Paused", "Draft" (plain text), "Archived" (grey pill). `pill` = the admin / header look. */
export function StatusChip({
  workflow,
  pill = false,
}: {
  workflow: Pick<Workflow, 'status' | 'isArchived'>;
  pill?: boolean;
}) {
  const status: DisplayStatus = displayStatus(workflow);
  const variant = status === 'paused' && pill ? 'pausedPill' : status;
  return (
    <span className={`${s.status} ${s.statusVariant[variant]}`} data-testid="workflow-status" data-status={status}>
      {status === 'live' && <span className={s.liveDot} />}
      {status === 'paused' && <Icon icon="wfPaused" size={14} className={s.pauseGlyph} />}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function CreditPill({ amount, label }: { amount: number | string; label?: string }) {
  return (
    <span className={s.credit} aria-label={label ?? `${amount} credits`} data-testid="credit-pill">
      <Icon icon="wfCredits" size={12} className={s.creditIcon} />
      {amount}
    </span>
  );
}

export function RunStatusIcon({ status, size = 16 }: { status: RunStatus | 'delayed'; size?: number }) {
  switch (status) {
    case 'completed':
      return (
        <span className={s.runIcon.completed}>
          <CheckCircleFilled size={size} className={s.filledCircle} />
        </span>
      );
    case 'failed':
      return (
        <span className={s.runIcon.failed}>
          <FailedFilled size={size} />
        </span>
      );
    case 'canceled':
      return <Icon icon="wfCancel" size={size} className={s.runIcon.canceled} />;
    default:
      return <Spinner size={size} color="tertiary" label="Running" />;
  }
}

/** Solid red circle with a knocked-out ×. */
function FailedFilled({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={s.filledCircle}>
      <circle cx="8" cy="8" r="6.5" fill="currentColor" />
      <path d="M5.9 5.9 10.1 10.1M10.1 5.9 5.9 10.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
