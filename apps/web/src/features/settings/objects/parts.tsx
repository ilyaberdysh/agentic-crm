// Small shared pieces of the objects settings screens: info tooltips (ⓘ), the 808 px dialog footer
// ("Cancel ESC" + primary "… ⌘ ↵"), ⌘+Enter submit, object tiles and type pills.
import type { EntityDefinition } from '@agentic-crm/contracts';
import { Badge, Button, Icon, IconTile, Tooltip } from '@agentic-crm/ui';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { objectTile } from './objectIcon';
import * as s from './objects.css';

/** ⓘ with a hover/focus tooltip (constraint help, slug help, attribute descriptions). */
export function InfoTip({ content, label = 'More information' }: { content: ReactNode; label?: string }) {
  return (
    <Tooltip content={content} placement="top" delay={0}>
      <AriaButton aria-label={label} className={s.infoIcon} style={{ border: 'none', background: 'none', padding: 0 }}>
        <Icon icon="info" size={12} />
      </AriaButton>
    </Tooltip>
  );
}

/** ⌘/Ctrl + Enter submits the dialog. */
export function submitOnModEnter(submit: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };
}

export function DialogActions({
  onCancel,
  onSubmit,
  submitLabel,
  isPending,
  isDisabled,
  showCancel = true,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  isPending?: boolean;
  isDisabled?: boolean;
  showCancel?: boolean;
}) {
  return (
    <>
      {showCancel && (
        <Button variant="secondary" size={28} shortcut={['esc']} onPress={onCancel}>
          Cancel
        </Button>
      )}
      <Button
        variant="primary"
        size={28}
        shortcut={['mod', 'enter']}
        isPending={isPending}
        isDisabled={isDisabled}
        onPress={onSubmit}
      >
        {submitLabel}
      </Button>
    </>
  );
}

export function ObjectTile({
  object,
  size = 16,
}: {
  object: Pick<EntityDefinition, 'entityType' | 'standardObjectType' | 'icon'>;
  size?: 16 | 20 | 24 | 28 | 32 | 40 | 56;
}) {
  const look = objectTile(object);
  return <IconTile icon={look.icon} color={look.color} size={size} />;
}

/** "Custom" (accent) or "Standard" (grey) pill. */
export function ObjectTypePill({
  object,
  size = 16,
}: {
  object: Pick<EntityDefinition, 'entityType'>;
  size?: 16 | 20;
}) {
  const custom = object.entityType === 'custom-record';
  return (
    <Badge variant={custom ? 'secondary' : 'tertiary'} size={size}>
      {custom ? 'Custom' : 'Standard'}
    </Badge>
  );
}

export function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.sectionHeader}>
      <div>
        <h2 className={s.sectionTitle}>{title}</h2>
        {description && <p className={s.sectionDescription}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Copies text and confirms with the observed toast. */
export async function copyToClipboard(text: string, toastFn: (title: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable (insecure context); the toast still confirms the action by design.
  }
  toastFn('Copied to clipboard');
}
