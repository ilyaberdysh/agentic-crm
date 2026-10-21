// The access level dropdown of the Share popover and of Settings → Dashboards → Permissions: a
// button showing the level, a menu with the four levels (each with its one-line explanation, the current one checked)
// and, for team and member rows, a last "Remove" item. A target that effectively gets more than its own grant shows
// the effective level with an amber ⚠ and the reason in a tooltip (J permissions).
import type { AccessScope } from '@agentic-crm/contracts';
import { Button, Icon, Menu, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from '@agentic-crm/ui';
import { DASHBOARD_LEVEL_DESCRIPTION, type Inherited, LEVEL_LABEL, LEVELS } from './levels';
import * as s from './share.css';

export interface RemoveOption {
  /** "Remove team-level override" / "Remove member-level override". */
  description: string;
  onRemove: () => void;
}

export interface PermissionLevelSelectProps {
  value: AccessScope;
  onChange: (level: AccessScope) => void;
  /** Accessible name of the button ("Workspace access", "Ada Tester access"). */
  'aria-label': string;
  /** `ghost`: text and chevron (the popover); `outline`: a bordered button (settings, the add row). */
  variant?: 'ghost' | 'outline';
  size?: 28 | 32;
  isDisabled?: boolean;
  inherited?: Inherited | null;
  remove?: RemoveOption;
  /** One line under each level in the menu (default: the dashboard wording). */
  descriptions?: Record<AccessScope, string>;
  className?: string;
  'data-testid'?: string;
}

export function PermissionLevelSelect({
  value,
  onChange,
  'aria-label': ariaLabel,
  variant = 'ghost',
  size = 28,
  isDisabled,
  inherited,
  remove,
  descriptions = DASHBOARD_LEVEL_DESCRIPTION,
  className,
  'data-testid': testId,
}: PermissionLevelSelectProps) {
  const shown = inherited ? inherited.level : value;
  const button = (
    <Button
      variant={variant === 'outline' ? 'secondary' : 'ghost'}
      size={size}
      chevron
      isDisabled={isDisabled}
      aria-label={ariaLabel}
      className={`${s.levelButton} ${inherited ? s.levelInherited : ''} ${className ?? ''}`}
      data-testid={testId}
      data-level={value}
    >
      {inherited && <Icon icon="warning" size={14} className={s.levelWarning} />}
      {LEVEL_LABEL[shown]}
    </Button>
  );
  return (
    <MenuTrigger>
      {inherited ? <Tooltip content={inherited.hint}>{button}</Tooltip> : button}
      <Menu
        aria-label={ariaLabel}
        placement="bottom end"
        width={290}
        selectionMode="single"
        selectedKeys={[value]}
        disallowEmptySelection
        onAction={(key) => {
          if (key === 'remove') remove?.onRemove();
          else if (key !== value) onChange(key as AccessScope);
        }}
      >
        {LEVELS.map((level) => (
          <MenuItem key={level} id={level} description={descriptions[level]}>
            {LEVEL_LABEL[level]}
          </MenuItem>
        ))}
        {remove && (
          <>
            <MenuSeparator />
            <MenuItem id="remove" description={remove.description} variant="danger">
              Remove
            </MenuItem>
          </>
        )}
      </Menu>
    </MenuTrigger>
  );
}
