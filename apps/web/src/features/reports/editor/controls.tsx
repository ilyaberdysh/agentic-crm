// Small controls of the editor panel (builder §2): the popover select button, switch rows, the dashed "add" chips and
// the included-stages / included-values multi-select popover (builder §3.2 "Included stages", §8).
import { Icon, type IconName, Popover, StatusDot, Switch } from '@agentic-crm/ui';
import { type ReactNode, useMemo, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import * as e from './editor.css';

/** A select-looking button that opens a popover with `children` (a picker, a menu list …). */
export function PopoverSelect({
  icon,
  leading,
  label,
  isPlaceholder,
  width = 'trigger',
  isDisabled,
  isOpen,
  onOpenChange,
  className,
  'aria-label': ariaLabel,
  'data-testid': testId,
  children,
}: {
  icon?: IconName | React.ComponentProps<typeof Icon>['icon'];
  leading?: ReactNode;
  label: ReactNode;
  isPlaceholder?: boolean;
  width?: 'trigger' | number;
  isDisabled?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  children: (close: () => void) => ReactNode;
}) {
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      width={width}
      padding={0}
      aria-label={ariaLabel}
      trigger={
        <AriaButton
          className={`${e.selectButton} ${className ?? ''}`}
          isDisabled={isDisabled}
          data-placeholder={isPlaceholder || undefined}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {icon && <Icon icon={icon} size={16} />}
          {leading}
          <span className={e.selectLabel}>{label}</span>
          <Icon icon="chevronDown" size={16} className={e.selectChevron} />
        </AriaButton>
      }
    >
      {({ close }) => children(close)}
    </Popover>
  );
}

export function SwitchRow({
  label,
  isSelected,
  onChange,
  isDisabled,
  compact,
  'data-testid': testId,
}: {
  label: string;
  isSelected: boolean;
  onChange: (value: boolean) => void;
  isDisabled?: boolean;
  /** A 20 px row instead of the 32 px one (inside a card, under a select). */
  compact?: boolean;
  'data-testid'?: string;
}) {
  return (
    <div className={compact ? e.switchRowCompact : e.switchRow}>
      <Switch size={20} isSelected={isSelected} onChange={onChange} isDisabled={isDisabled} data-testid={testId}>
        {label}
      </Switch>
    </div>
  );
}

/** The dashed ghost chip that adds a section ("Group by", "Segment by", "Add filter"). */
export function GhostAdd({
  icon,
  children,
  onPress,
  isDisabled,
  'data-testid': testId,
}: {
  icon: React.ComponentProps<typeof Icon>['icon'];
  children: ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  'data-testid'?: string;
}) {
  return (
    <AriaButton className={e.ghostDashed} onPress={onPress} isDisabled={isDisabled} data-testid={testId}>
      <Icon icon={icon} size={16} />
      {children}
    </AriaButton>
  );
}

// ---- included stages / values ------------------------------------------------------------------------------------------

export interface StageOption {
  id: string;
  label: string;
  /** Stage (`block_*`) or select option (`pastel_*`) colour. */
  color: string | null;
}

export function ColorDots({ colors }: { colors: (string | null)[] }) {
  return (
    <span className={e.dotsIcon} aria-hidden="true">
      {colors.slice(0, 3).map((c, i) => (
        <span key={i} className={e.dotsIconDot}>
          <StatusDot color={c ?? 'grey'} size={10} />
        </span>
      ))}
    </span>
  );
}

export interface StageSelectProps {
  options: StageOption[];
  /** Chosen ids; null = every one ("All"). */
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  /** The "No stage" / "No {attribute}" row (grouping only). */
  noneLabel?: string;
  noneChecked?: boolean;
  onNoneChange?: (checked: boolean) => void;
  /** The funnel's "All records" pseudo-stage, first in the list. */
  allRecordsChecked?: boolean;
  onAllRecordsChange?: (checked: boolean) => void;
  /** Explicit lists only (funnels): selecting everything stores every id instead of null. */
  explicit?: boolean;
  searchPlaceholder: string;
  isDisabled?: boolean;
  'data-testid'?: string;
}

/**
 * "All", `All excluding "Done"`, "Discovery, Build, Review, Done" or "All records, Discovery, Build, +2" (builder §3.2,
 * §8). `explicit` lists (funnels) never say "All".
 */
export function summariseSelection(
  options: StageOption[],
  value: string[] | null,
  extra?: { allRecords?: boolean; noneLabel?: string; noneChecked?: boolean; explicit?: boolean },
): string {
  const chosen = options.filter((o) => value === null || value.includes(o.id));
  const noneApplicable = extra?.noneLabel !== undefined;
  const noneChecked = extra?.noneChecked ?? true;
  const excluded = [
    ...options.filter((o) => !chosen.includes(o)).map((o) => o.label),
    ...(noneApplicable && !noneChecked ? [extra?.noneLabel as string] : []),
  ];
  if (!extra?.explicit && excluded.length === 0) return 'All';
  if (!extra?.explicit && excluded.length === 1 && chosen.length > 0) return `All excluding "${excluded[0]}"`;
  const parts = [
    ...(extra?.allRecords ? ['All records'] : []),
    ...chosen.map((o) => o.label),
    ...(noneApplicable && noneChecked && excluded.length > 0 ? [extra?.noneLabel as string] : []),
  ];
  if (parts.length === 0) return 'None';
  // Attio lists what fits the select ("Discovery, Build, Review, Done"; "All records, Discovery, Build, +2").
  const shown: string[] = [];
  for (const part of parts) {
    if (shown.length > 0 && [...shown, part].join(', ').length > LIST_BUDGET) break;
    shown.push(part);
  }
  const rest = parts.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, +${rest}` : shown.join(', ');
}

/** Characters of the comma list that fit a 170 px select before it collapses into "+N". */
const LIST_BUDGET = 31;

export function StageSelect(props: StageSelectProps) {
  const { options, value, onChange, searchPlaceholder, explicit } = props;
  const [query, setQuery] = useState('');
  const chosen = useMemo(() => new Set(value ?? options.map((o) => o.id)), [value, options]);
  const allChosen = chosen.size === options.length && (props.noneChecked ?? true) && (props.allRecordsChecked ?? true);
  const visible = options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()));

  const toggle = (id: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    const ordered = options.filter((o) => next.has(o.id)).map((o) => o.id);
    onChange(!explicit && ordered.length === options.length ? null : ordered);
  };
  const setAll = (on: boolean) => {
    onChange(on ? (explicit ? options.map((o) => o.id) : null) : []);
    props.onNoneChange?.(on);
    props.onAllRecordsChange?.(on);
  };

  const label = summariseSelection(options, value, {
    allRecords: props.allRecordsChecked,
    noneLabel: props.noneLabel,
    noneChecked: props.noneChecked,
    explicit,
  });
  const dots = options.filter((o) => chosen.has(o.id)).map((o) => o.color);
  return (
    <Popover
      width="trigger"
      padding={0}
      aria-label={searchPlaceholder}
      trigger={
        <AriaButton className={e.selectButton} isDisabled={props.isDisabled} data-testid={props['data-testid']}>
          <ColorDots colors={dots.length ? dots : [null]} />
          <span className={e.selectLabel}>{label}</span>
          <Icon icon="chevronDown" size={16} className={e.selectChevron} />
        </AriaButton>
      }
    >
      <div data-testid="stage-select-popover">
        <div className={e.stageHeader}>
          <Icon icon="search" size={16} />
          <input
            className={e.stageSearch}
            placeholder={searchPlaceholder}
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            aria-label={searchPlaceholder}
            autoFocus
          />
          <button
            type="button"
            className={e.stageToggleAll}
            onClick={() => setAll(!allChosen)}
            data-testid="stage-toggle-all"
          >
            {allChosen ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div className={e.stageList}>
          {props.onAllRecordsChange && (
            <Row
              label="All records"
              leading={<Icon icon="record" size={16} />}
              checked={props.allRecordsChecked ?? false}
              onChange={props.onAllRecordsChange}
            />
          )}
          {props.onNoneChange && props.noneLabel && query.trim() === '' && (
            <Row
              label={props.noneLabel}
              leading={<span className={e.stageDot} style={{ border: '1px dashed currentColor', opacity: 0.6 }} />}
              checked={props.noneChecked ?? true}
              onChange={props.onNoneChange}
            />
          )}
          {visible.map((o) => (
            <Row
              key={o.id}
              label={o.label}
              leading={<StatusDot color={o.color ?? 'grey'} size={8} />}
              checked={chosen.has(o.id)}
              onChange={(on) => toggle(o.id, on)}
            />
          ))}
        </div>
      </div>
    </Popover>
  );
}

function Row({
  label,
  leading,
  checked,
  onChange,
}: {
  label: string;
  leading: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={e.stageRow} data-testid="stage-row" data-label={label}>
      {leading}
      <span className={e.stageName}>{label}</span>
      <Switch size={20} isSelected={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}
