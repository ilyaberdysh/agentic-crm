// Window frames: the modal (centred 968 × 670, page visible behind, outside click and Esc close —
// Esc closes an open popover first), the floating panel pinned to the bottom right (no backdrop, the page stays
// interactive) and the top-bar controls: Minimize · Pin to screen · Close (modal), Minimize · Expand · Close
// (floating), Close only (templates).
import { cx, IconButton, useThemeClassName } from '@agentic-crm/ui';
import type { ReactNode } from 'react';
import { Dialog, ModalOverlay, Modal as RACModal } from 'react-aria-components';
import type { WindowKind } from './model';
import * as s from './overlays.css';
import { closeWindow, expandToModal, floatWindow, minimizeWindow, useOverlayState } from './store';

export function ModalWindowShell({
  label,
  onClose,
  isTop = true,
  fit = false,
  dimmed = false,
  children,
}: {
  label: string;
  onClose: () => void;
  /** Lower layers ignore Esc and outside clicks (the layer above handles them). */
  isTop?: boolean;
  /** The frame wraps its content (which sets the size) and sits 14 vh from the top. */
  fit?: boolean;
  /** Dim the page behind. */
  dimmed?: boolean;
  children: ReactNode;
}) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  return (
    <ModalOverlay
      isOpen
      isDismissable={isTop}
      isKeyboardDismissDisabled={!isTop}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className={cx(themeClass, s.modalOverlay, fit && s.modalOverlayFit, dimmed && s.modalOverlayDim)}
    >
      <RACModal className={cx(s.frame, fit && s.frameFit)}>
        <Dialog aria-label={label} className={s.panel} data-testid="window-modal">
          {children}
        </Dialog>
      </RACModal>
    </ModalOverlay>
  );
}

export function FloatingWindowShell({ label, children }: { label: string; children: ReactNode }) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const { detached } = useOverlayState();
  // Bubbles other than this window's own sit in the dock column at the right: the panel stays left of it.
  const alone = detached.length === 0;
  return (
    <section
      role="dialog"
      aria-label={label}
      className={cx(themeClass, s.floating, alone && s.floatingAlone)}
      data-testid="window-floating"
    >
      {children}
    </section>
  );
}

/** Kinds that can be minimised and pinned (notes and the composer); the others only close. */
const DETACHABLE: readonly WindowKind[] = ['note', 'composer'];

/** Top-bar buttons of a window, by mode. `canPin` = false hides "Pin to screen" (the composer in mass-send mode). */
export function WindowControls({
  kind,
  id,
  mode,
  canPin = true,
  onClose,
}: {
  kind: WindowKind;
  id: string;
  mode: 'modal' | 'floating';
  canPin?: boolean;
  /** Replaces the plain close (the composer cleans up an empty draft). */
  onClose?: () => void;
}) {
  const close = onClose ?? (() => closeWindow(kind, id));
  if (!DETACHABLE.includes(kind)) {
    return (
      <div className={s.controls}>
        <IconButton icon="close" aria-label="Close" tooltip="Close" size={28} onPress={close} />
      </div>
    );
  }
  return (
    <div className={s.controls}>
      <IconButton
        icon="minimize"
        aria-label="Minimize"
        tooltip="Minimize"
        size={28}
        onPress={() => minimizeWindow(kind, id)}
      />
      {mode === 'modal' ? (
        canPin && (
          <IconButton
            icon="pinToScreen"
            aria-label="Pin to screen"
            tooltip="Pin to screen"
            size={28}
            onPress={() => floatWindow(kind, id)}
          />
        )
      ) : (
        <IconButton
          icon="expand"
          aria-label="Expand"
          tooltip="Expand"
          size={28}
          onPress={() => expandToModal(kind, id)}
        />
      )}
      <IconButton icon="close" aria-label="Close" tooltip="Close" size={28} onPress={close} />
    </div>
  );
}

/** 48 px (modal) / 40 px (floating) bar: breadcrumb or label on the left, controls on the right. */
export function WindowTopBar({
  mode,
  start,
  controls,
}: {
  mode: 'modal' | 'floating';
  start: ReactNode;
  controls: ReactNode;
}) {
  return (
    <div className={cx(s.topBar, mode === 'floating' && s.topBarFloating)} data-testid="window-top-bar">
      <div className={s.topBarStart}>{start}</div>
      {controls}
    </div>
  );
}

export { s as windowStyles };
