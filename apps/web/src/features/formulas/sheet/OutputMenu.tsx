// "Output" selector: ghost 28 px button "Output: Auto" / "Output: <Type>"; menu (min 300 px) with
// "Auto" followed by the inferred type in secondary text, a separator, then the 8 overrides with their type icons.
import type { OutputKind, OutputOverride } from '@agentic-crm/formula';
import { Button, CheckCircleFilled, Menu, MenuItem, MenuSeparator, MenuTrigger } from '@agentic-crm/ui';
import { OUTPUT_ICONS, OUTPUT_LABELS, OVERRIDE_ORDER, outputButtonLabel } from '../model/output';
import * as s from './sheet.css';

const check = <CheckCircleFilled size={16} style={{ color: 'var(--ar-color-content-accent)' }} />;

export function OutputMenu({
  override,
  inferred,
  onChange,
  isDisabled,
}: {
  override: OutputOverride | null;
  inferred: OutputKind | null;
  onChange: (override: OutputOverride | null) => void;
  isDisabled?: boolean;
}) {
  return (
    <MenuTrigger>
      <Button variant="ghost" size={28} chevron isDisabled={isDisabled} aria-label="Output type">
        {outputButtonLabel(override)}
      </Button>
      <Menu
        aria-label="Output type"
        width={300}
        maxHeight={400}
        onAction={(key) => onChange(key === 'auto' ? null : (key as OutputOverride))}
      >
        <MenuItem id="auto" textValue="Auto" trailing={override === null ? check : null}>
          Auto
          {inferred && <span className={s.outputAuto}>{OUTPUT_LABELS[inferred]}</span>}
        </MenuItem>
        <MenuSeparator />
        {OVERRIDE_ORDER.map((kind) => (
          <MenuItem
            key={kind}
            id={kind}
            icon={OUTPUT_ICONS[kind]}
            textValue={OUTPUT_LABELS[kind]}
            trailing={override === kind ? check : null}
          >
            {OUTPUT_LABELS[kind]}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
