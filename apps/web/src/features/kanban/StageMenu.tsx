// Stage header menu:
// kanban-stage-track-time.png): a 276 px popover over the column header — colour dot (4×3 swatch grid) + "Stage name"
// (rename inline), "Track time in stage" (+ Target time with Days / Months / Years, saved after 1.5 s), "Confetti"
// (plays a burst when switched on), then Collapse stage, Hide stage and Delete stage (archives, X-08, after "Are you
// sure?"). The "No stage" column offers Collapse and Hide only. Stage edits change the attribute's option, i.e. every
// view using it. Select options have no target time or confetti.
import type { AttributeDefinition } from '@agentic-crm/contracts';
import {
  AlertDialog,
  Icon,
  Menu,
  MenuItem,
  MenuTrigger,
  PopoverPanel,
  StatusDot,
  Switch,
  toast,
  toHue,
  vars,
} from '@agentic-crm/ui';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { errorEnvelopeOf, type WorkspaceRef } from '../../data/trpc';
import { fireConfetti } from './confetti';
import { updateStage } from './data';
import * as s from './kanban.css';
import { type BoardStage, formatTargetTime, NO_STAGE, parseTargetTime, type TargetUnit } from './model';

/** The 12 swatches of the colour grid, in the evidence's 4 × 3 order (red … grey). */
export const STAGE_SWATCHES = [
  'block_red',
  'block_orange',
  'block_yellow',
  'block_light-green',
  'block_green',
  'block_teal',
  'block_blue',
  'block_violet',
  'block_purple',
  'block_magenta',
  'block_brown',
  'block_grey',
] as const;
const OPTION_SWATCHES = STAGE_SWATCHES.map((c) => c.replace('block_', 'pastel_'));

const UNIT_LABEL: Record<TargetUnit, string> = { days: 'Days', months: 'Months', years: 'Years' };
const SAVE_DELAY_MS = 1500;

export interface StageMenuProps {
  workspace: WorkspaceRef;
  attribute: AttributeDefinition | undefined;
  stage: BoardStage;
  stages: readonly BoardStage[];
  triggerRef: RefObject<Element | null>;
  isOpen: boolean;
  onOpenChange(open: boolean): void;
  onCollapse(): void;
  onHide(): void;
}

function failed(title: string, error: unknown) {
  toast.error({ title, description: errorEnvelopeOf(error).message, durationMs: 8000 });
}

export function StageMenu(props: StageMenuProps) {
  const { stage, isOpen, onOpenChange, triggerRef } = props;
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <PopoverPanel
        triggerRef={triggerRef}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        placement="bottom start"
        offset={-48}
        crossOffset={-12}
        padding={0}
        className={s.menuPanel}
      >
        <Dialog aria-label={`${stage.title} stage`} style={{ outline: 'none' }} data-testid="kanban-stage-menu">
          {stage.key === NO_STAGE ? (
            <div className={s.menuSection}>
              <div className={s.switchRow} style={{ fontWeight: 600 }}>
                No stage
              </div>
            </div>
          ) : (
            <StageEditor {...props} />
          )}
          <div className={s.menuSection}>
            <MenuButton
              icon="collapseStage"
              onPress={() => {
                onOpenChange(false);
                props.onCollapse();
              }}
            >
              Collapse stage
            </MenuButton>
            <MenuButton
              icon="hide"
              onPress={() => {
                onOpenChange(false);
                props.onHide();
              }}
            >
              Hide stage
            </MenuButton>
            {stage.key !== NO_STAGE && (
              <MenuButton
                icon="delete"
                danger
                onPress={() => {
                  onOpenChange(false);
                  setConfirming(true);
                }}
              >
                Delete stage
              </MenuButton>
            )}
          </div>
        </Dialog>
      </PopoverPanel>
      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title="Are you sure?"
        description="This stage will be deleted from the list entirely."
        confirmLabel="Delete stage"
        onConfirm={() => {
          setConfirming(false);
          if (!props.attribute || !stage.id) return;
          updateStage(props.workspace, props.attribute, stage.id, { isArchived: true }).catch((error) =>
            failed('Failed to delete stage', error),
          );
        }}
      />
    </>
  );
}

function MenuButton({
  icon,
  danger,
  onPress,
  children,
}: {
  icon: 'collapseStage' | 'hide' | 'delete';
  danger?: boolean;
  onPress(): void;
  children: string;
}) {
  return (
    <AriaButton className={s.menuItem} data-danger={danger || undefined} onPress={onPress}>
      <Icon icon={icon} size={16} />
      {children}
    </AriaButton>
  );
}

function StageEditor({ workspace, attribute, stage, stages, onOpenChange }: StageMenuProps) {
  const isPipeline = attribute?.type === 'pipeline';
  const [name, setName] = useState(stage.title);
  const [error, setError] = useState<string | null>(null);
  const colorRef = useRef<HTMLButtonElement>(null);
  const [colorsOpen, setColorsOpen] = useState(false);
  const target = parseTargetTime(stage.targetTimeInStatus);
  const [tracking, setTracking] = useState(target !== null);
  const [amount, setAmount] = useState(String(target?.value ?? 0));
  const [unit, setUnit] = useState<TargetUnit>(target?.unit ?? 'days');
  const [confetti, setConfetti] = useState(stage.celebrationEnabled);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ amount, unit });
  latest.current = { amount, unit };

  const save = (patch: Parameters<typeof updateStage>[3], failure = 'Failed to update stage') => {
    if (!attribute || !stage.id) return;
    updateStage(workspace, attribute, stage.id, patch).catch((e) => failed(failure, e));
  };

  const flushTarget = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const value = Number.parseInt(latest.current.amount, 10);
    save({
      targetTimeInStatus: formatTargetTime({ value: Number.isFinite(value) ? value : 0, unit: latest.current.unit }),
    });
  };
  const scheduleTarget = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushTarget, SAVE_DELAY_MS);
  };
  // Closing the menu saves a pending target time at once.
  useEffect(
    () => () => {
      if (saveTimer.current) flushTarget();
    },
    [],
  );

  const rename = () => {
    const title = name.trim();
    if (title === stage.title) return;
    if (!title) {
      setError('Stage name is required');
      return;
    }
    if (stages.some((s2) => s2.key !== stage.key && s2.title.toLowerCase() === title.toLowerCase())) {
      setError('This name is already in use');
      return;
    }
    setError(null);
    save({ title });
  };

  const swatches = isPipeline ? STAGE_SWATCHES : OPTION_SWATCHES;
  return (
    <>
      <div className={s.nameRow}>
        <div className={s.nameField}>
          <AriaButton
            ref={colorRef}
            className={s.colorButton}
            aria-label="Change stage colour"
            onPress={() => setColorsOpen(true)}
          >
            <StatusDot color={stage.color} size={14} />
          </AriaButton>
          <input
            className={s.nameInput}
            aria-label="Stage name"
            autoFocus
            placeholder="Stage name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                rename();
                onOpenChange(false);
              }
            }}
          />
        </div>
        {error && (
          <div className={s.stageError} style={{ paddingTop: 4 }}>
            {error}
          </div>
        )}
      </div>
      <PopoverPanel
        triggerRef={colorRef}
        isOpen={colorsOpen}
        onOpenChange={setColorsOpen}
        placement="bottom start"
        offset={8}
        crossOffset={-8}
        padding={0}
      >
        <Dialog aria-label="Stage colour" style={{ outline: 'none' }}>
          <div className={s.swatchGrid} role="listbox" aria-label="Colours">
            {swatches.map((color) => (
              <AriaButton
                key={color}
                className={s.swatch}
                aria-label={color.replace(/^(block|pastel)_/, '').replace('-', ' ')}
                data-selected={stage.color === color || undefined}
                style={{ backgroundColor: vars.color.utilities.surface[toHue(color)] }}
                onPress={() => {
                  setColorsOpen(false);
                  save({ color });
                }}
              />
            ))}
          </div>
        </Dialog>
      </PopoverPanel>
      {isPipeline && (
        <>
          <div className={s.menuSection}>
            <label className={s.switchRow}>
              <span className={s.switchLabel}>Track time in stage</span>
              <Switch
                aria-label="Track time in stage"
                isSelected={tracking}
                onChange={(on) => {
                  setTracking(on);
                  if (on) {
                    setAmount('0');
                    setUnit('days');
                    save({ targetTimeInStatus: formatTargetTime({ value: 0, unit: 'days' }) });
                  } else {
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    saveTimer.current = null;
                    save({ targetTimeInStatus: null });
                  }
                }}
              />
            </label>
            {tracking && (
              <div className={s.targetBlock}>
                <span className={s.targetLabel}>Target time</span>
                <div className={s.targetField}>
                  <input
                    className={s.targetInput}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label="Target time"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      scheduleTarget();
                    }}
                    onBlur={() => saveTimer.current && flushTarget()}
                  />
                  <MenuTrigger>
                    <AriaButton className={s.unitButton} aria-label="Target time unit">
                      {UNIT_LABEL[unit]}
                    </AriaButton>
                    <Menu
                      aria-label="Target time unit"
                      placement="bottom end"
                      width={140}
                      selectionMode="single"
                      selectedKeys={[unit]}
                      onAction={(key) => {
                        setUnit(key as TargetUnit);
                        latest.current = { ...latest.current, unit: key as TargetUnit };
                        flushTarget();
                      }}
                    >
                      <MenuItem id="days">Days</MenuItem>
                      <MenuItem id="months">Months</MenuItem>
                      <MenuItem id="years">Years</MenuItem>
                    </Menu>
                  </MenuTrigger>
                </div>
              </div>
            )}
          </div>
          <div className={s.menuSection}>
            <label className={s.switchRow}>
              <span className={s.switchLabel}>
                <Icon icon="confetti" size={16} />
                Confetti
              </span>
              <Switch
                aria-label="Confetti"
                isSelected={confetti}
                onChange={(on) => {
                  setConfetti(on);
                  save({ celebrationEnabled: on });
                  // Switching it on previews the celebration.
                  if (on) fireConfetti();
                }}
              />
            </label>
          </div>
        </>
      )}
    </>
  );
}
