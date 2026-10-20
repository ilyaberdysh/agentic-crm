// Building blocks of attribute Views and Editors: option tags, status chips, record and member chips, rating stars,
// the checkbox mark and the overflow-aware chip row.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { Avatar, cx, Icon, type IconName, Tag, toHue } from '@agentic-crm/ui';
import { useNavigate } from '@tanstack/react-router';
import {
  Children,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAttributeEnv } from '../data/env';
import { useRecordTitle } from '../data/queries';
import { actorTypeLabel, memberName } from '../format/formatValue';
import type { Member, PipelineStage, SelectOption } from '../types';
import * as s from './ui.css';

// ---- options -------------------------------------------------------------------------------------------------------

/** A select option as a 22 px tag in its pastel hue (C1 cells.md: radius 7, padding 0 4). */
export function OptionTag({ option, title, className }: { option?: SelectOption; title?: string; className?: string }) {
  return (
    <Tag size={22} color={option?.color ?? 'grey'} className={cx(s.tag22, className)}>
      {option?.title ?? title ?? ''}
    </Tag>
  );
}

/** A pipeline stage: 8 px dot in its block hue + title. */
export function StatusChip({
  stage,
  className,
  style,
}: {
  stage?: PipelineStage;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={cx(s.status, className)} style={style}>
      <span className={cx(s.statusDot, s.statusDotHue[toHue(stage?.color ?? 'grey')])} aria-hidden="true" />
      <span className={s.truncate}>{stage?.title ?? ''}</span>
    </span>
  );
}

// ---- records -------------------------------------------------------------------------------------------------------

function PersonGlyph({ size }: { size: number }) {
  // Head + shoulders, drawn for this project on a 16 grid.
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="6.25" y="3.5" width="3.5" height="3.5" rx="1.2" fill="currentColor" />
      <path d="M4.5 12.5c0-2.1 1.4-3.6 3.5-3.6s3.5 1.5 3.5 3.6v.5h-7v-.5Z" fill="currentColor" />
    </svg>
  );
}

function BuildingGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.2 3.2h5.6c.5 0 .8.3.8.8v8.8H4.4V4c0-.5.3-.8.8-.8Zm1.3 2v1h3v-1h-3Zm0 2.3v1h3v-1h-3Zm.9 2.6v2.7h1.2v-2.7H7.4Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export type RecordKind = 'person' | 'company' | 'deal' | 'user' | 'workspace' | 'object';

export function recordKind(
  definition: Pick<EntityDefinition, 'entityType' | 'standardObjectType'> | undefined,
): RecordKind {
  if (!definition) return 'object';
  if (definition.entityType === 'person-record') return 'person';
  if (definition.entityType === 'company-record') return 'company';
  if (definition.entityType === 'standard-object' && definition.standardObjectType)
    return definition.standardObjectType;
  return 'object';
}

const KIND_ICON: Record<RecordKind, IconName> = {
  person: 'person',
  company: 'company',
  deal: 'deal',
  user: 'user',
  workspace: 'workspace',
  object: 'object',
};

/** Entity placeholder avatar (components.md §5): person round, everything else a 30 % box. */
export function RecordAvatar({ kind, size = 16 }: { kind: RecordKind; size?: number }) {
  const glyph =
    kind === 'person' ? (
      <PersonGlyph size={size} />
    ) : kind === 'company' ? (
      <BuildingGlyph size={size} />
    ) : (
      <Icon icon={KIND_ICON[kind]} size={Math.round(size * 0.62)} strokeWidth={2.5} />
    );
  return (
    <span
      className={cx(s.placeholderAvatar, kind === 'person' ? s.placeholderRound : s.placeholderBox)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}

/** App path of a record page (B README routes; `/person/<id>`, `/company/<id>`, `/<std>/record/<id>`, custom). */
export function recordPath(workspaceSlug: string, definition: EntityDefinition | undefined, id: string): string | null {
  if (!definition || !workspaceSlug) return null;
  if (definition.entityType === 'person-record') return `/${workspaceSlug}/person/${id}`;
  if (definition.entityType === 'company-record') return `/${workspaceSlug}/company/${id}`;
  if (definition.entityType === 'custom-record') return `/${workspaceSlug}/custom/${definition.apiSlug}/record/${id}`;
  return `/${workspaceSlug}/${definition.apiSlug}/record/${id}`;
}

/** A record reference: placeholder avatar + display name (underlined link; click opens the record). */
export function RecordChip({
  entityDefinitionId,
  entityInstanceId,
  title: knownTitle,
  interactive = true,
  className,
}: {
  entityDefinitionId: string;
  entityInstanceId: string;
  title?: string;
  interactive?: boolean;
  className?: string;
}) {
  const { workspace } = useAttributeEnv();
  const { title, definition } = useRecordTitle(entityDefinitionId, knownTitle ? '' : entityInstanceId);
  const navigate = useNavigate();
  const href = interactive ? recordPath(workspace.slug, definition, entityInstanceId) : null;
  const label = knownTitle ?? title;
  const onClick = (e: MouseEvent) => {
    if (!href || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    void navigate({ href });
  };
  const inner = (
    <>
      <RecordAvatar kind={recordKind(definition)} />
      <span className={s.recordChipTitle}>{label || ' '}</span>
    </>
  );
  if (!href)
    return (
      <span className={cx(s.recordChip, className)} style={{ cursor: 'default' }} data-record-id={entityInstanceId}>
        {inner}
      </span>
    );
  return (
    <a
      href={href}
      className={cx(s.recordChip, className)}
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      data-record-id={entityInstanceId}
    >
      {inner}
    </a>
  );
}

// ---- members and actors ----------------------------------------------------------------------------------------------

export function MemberAvatar({ member, size = 16 }: { member: Member | undefined; size?: 16 | 20 | 24 }) {
  const name = memberName(member) || '?';
  return <Avatar name={name} seed={member?.id ?? name} size={size} kind="member" />;
}

/** Workspace member: 16 px avatar + name. */
export function MemberChip({ member, className }: { member: Member | undefined; className?: string }) {
  return (
    <span className={cx(s.memberChip, className)}>
      <MemberAvatar member={member} />
      <span className={s.truncate}>{memberName(member) || 'Unknown member'}</span>
    </span>
  );
}

/** Non-member actor (API token, workflow, system): purple initial tile + label (evidence/C1/00-2 "Created by"). */
export function ActorChip({ type, label, className }: { type: string; label?: string; className?: string }) {
  const text = label ?? actorTypeLabel(type);
  return (
    <span className={cx(s.memberChip, className)}>
      <span className={s.actorTile} style={{ width: 16, height: 16, fontSize: 10 }} aria-hidden="true">
        {(text[0] ?? '?').toUpperCase()}
      </span>
      <span className={s.truncate}>{text}</span>
    </span>
  );
}

// ---- rating ------------------------------------------------------------------------------------------------------------

function StarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.6c.2 0 .4.1.5.3l1.4 2.9 3.2.5c.5.1.6.6.3.9l-2.3 2.2.5 3.2c.1.5-.4.8-.8.6L8 11.7l-2.8 1.5c-.4.2-.9-.1-.8-.6l.5-3.2-2.3-2.2c-.3-.3-.2-.8.3-.9l3.2-.5 1.4-2.9c.1-.2.3-.3.5-.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Five 16 px stars, 2 px apart; filled = interactive.primary, empty = surface.tintStrong (components.md Rating). */
export function Stars({
  value,
  onChange,
  label = 'Rating',
}: {
  value: number;
  /** Clicking a star sets it; clicking the current value clears it. */
  onChange?: (next: number) => void;
  label?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <span className={s.stars} role="group" aria-label={label} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= shown;
        const cls = cx(s.star, on && (hover !== null ? s.starPreview : s.starOn), onChange && s.starButton);
        return onChange ? (
          <button
            key={n}
            type="button"
            className={cls}
            data-filled={on || undefined}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            aria-pressed={n <= value}
            onMouseEnter={() => setHover(n)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              onChange(n === value ? 0 : n);
            }}
            tabIndex={-1}
          >
            <StarGlyph />
          </button>
        ) : (
          <span key={n} className={cls} data-filled={on || undefined}>
            <StarGlyph />
          </span>
        );
      })}
    </span>
  );
}

// ---- checkbox ----------------------------------------------------------------------------------------------------------

export function CheckboxMark({ checked }: { checked: boolean }) {
  return (
    <span className={cx(s.checkboxBox, checked && s.checkboxOn)} aria-hidden="true">
      {checked && (
        <svg width="9" height="8" viewBox="0 0 9 8" fill="none">
          <path
            d="M1.25 4.25 3.5 6.5 7.75 1.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}

// ---- chip rows -------------------------------------------------------------------------------------------------------

/**
 * Multi-value chips in one line. `clip` (table cells): clipped at the edge, no counter (C1 cells.md §1). `count`
 * (record fields, chips): as many as fit, then "+N" (D overview: "[seed] Jane Cooper +1").
 */
export function ChipRow({ children, overflow }: { children: ReactNode; overflow: 'clip' | 'count' }) {
  const items = Children.toArray(children);
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(items.length);

  useLayoutEffect(() => {
    if (overflow !== 'count') return;
    const el = ref.current;
    if (!el) return;
    // Hidden chips stay mounted (absolute, invisible) so their widths can be measured on every resize.
    const measure = () => {
      const kids = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-chip]'));
      const width = el.clientWidth;
      const reserve = 28; // "+N"
      let x = 0;
      let fit = 0;
      for (const [i, kid] of kids.entries()) {
        x += (i > 0 ? 6 : 0) + kid.offsetWidth;
        const limit = i === kids.length - 1 ? width : width - reserve;
        if (x <= limit + 0.5) fit = i + 1;
        else break;
      }
      setVisible(Math.max(1, fit));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [overflow, items.length]);

  const hidden = overflow === 'count' ? Math.max(0, items.length - visible) : 0;
  return (
    <span ref={ref} className={s.chipList} style={{ flex: 1, position: 'relative' }}>
      {items.map((item, i) => (
        <span
          key={i}
          data-chip
          style={
            hidden && i >= visible
              ? { display: 'inline-flex', position: 'absolute', visibility: 'hidden', flex: 'none' }
              : { display: 'inline-flex', minWidth: 0, flex: 'none' }
          }
        >
          {item}
        </span>
      ))}
      {hidden > 0 && <span className={s.more}>+{hidden}</span>}
    </span>
  );
}
