// Clicking a link in the editor opens a small popover: Open, Edit, Unlink ("Link interactions").
// There is no URL unfurl / preview card.
import { useThemeClassName } from '@agentic-crm/ui';
import { autoUpdate, FloatingPortal, flip, offset, shift, useFloating } from '@floating-ui/react';
import { useEffect, useLayoutEffect } from 'react';
import * as s from './menus.css.ts';

export interface LinkTarget {
  href: string;
  /** Anchor element in the editor. */
  element: HTMLElement;
}

export function LinkPopover({
  target,
  editable,
  onClose,
  onEdit,
  onUnlink,
}: {
  target: LinkTarget;
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onUnlink: () => void;
}) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const { refs, floatingStyles, elements } = useFloating({
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const { setReference } = refs;
  useLayoutEffect(() => {
    setReference(target.element);
  }, [target.element, setReference]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && (elements.floating?.contains(node) || target.element.contains(node))) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [elements.floating, target.element, onClose]);

  const button = (label: string, onPress: () => void) => (
    <button type="button" className={s.toolbarButton} onMouseDown={(e) => e.preventDefault()} onClick={onPress}>
      {label}
    </button>
  );

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        className={`${themeClass} ${s.linkPopover}`}
        role="dialog"
        aria-label="Link"
        data-testid="link-popover"
      >
        <span className={s.linkHref} title={target.href}>
          {target.href}
        </span>
        {button('Open', () => {
          window.open(target.href, '_blank', 'noopener,noreferrer');
          onClose();
        })}
        {editable ? button('Edit', onEdit) : null}
        {editable ? button('Unlink', onUnlink) : null}
      </div>
    </FloatingPortal>
  );
}
