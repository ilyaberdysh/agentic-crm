import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  type Placement,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react';
import { type CSSProperties, cloneElement, isValidElement, type ReactElement, type ReactNode, useState } from 'react';
import { useThemeClassName } from '../../theme/ThemeProvider';
import { density } from '../../tokens';
import { cx } from '../../utils/cx';
import * as s from './HoverCard.css';

export interface HoverCardProps {
  /** The trigger element; must accept a ref and DOM event props. */
  children: ReactElement;
  content: ReactNode;
  /** Default 360. */
  width?: number;
  placement?: Placement;
  /** Open delay in ms (default 450). */
  openDelay?: number;
  /** Close delay in ms (default 100). */
  closeDelay?: number;
  /** `tooltip`: floating dark surface + e1 instead of the elevated card. */
  variant?: 'card' | 'tooltip';
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * Hover card on floating-ui: opens after 450 ms, closes 100 ms after the pointer leaves (a safe
 * polygon keeps it open while moving into the card), offset 8, collision padding 32, radius 12, e2.
 * Also opens on keyboard focus; Esc closes.
 */
export function HoverCard({
  children,
  content,
  width = 360,
  placement = 'bottom-start',
  openDelay = density.hoverCardDelayMs.open,
  closeDelay = density.hoverCardDelayMs.close,
  variant = 'card',
  isOpen: controlledOpen,
  onOpenChange,
  className,
  style,
}: HoverCardProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });

  const {
    refs,
    floatingStyles,
    context,
    placement: resolved,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 32 }), shift({ padding: 32 })],
  });

  const hover = useHover(context, { delay: { open: openDelay, close: closeDelay }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  const side = resolved.split('-')[0];
  const { isMounted, styles: transition } = useTransitionStyles(context, {
    duration: 80,
    initial: {
      opacity: 0,
      transform: `scale(0.97) ${side === 'top' ? 'translateY(1px)' : side === 'bottom' ? 'translateY(-1px)' : side === 'left' ? 'translateX(1px)' : 'translateX(-1px)'}`,
    },
  });

  if (!isValidElement(children)) return null;
  const trigger = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: refs.setReference,
    ...getReferenceProps((children.props ?? {}) as Record<string, unknown>),
  });

  return (
    <>
      {trigger}
      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={themeClass}
            style={{ ...floatingStyles, zIndex: 2147483646 }}
            {...getFloatingProps()}
          >
            <div
              className={cx(s.card, variant === 'tooltip' && s.tooltip, className)}
              style={{ width, ...transition, ...style }}
            >
              {content}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
