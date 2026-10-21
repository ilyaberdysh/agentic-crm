import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  DialogTrigger,
  Heading,
  ModalOverlay,
  type ModalOverlayProps,
  Dialog as RACDialog,
  Modal as RACModal,
} from 'react-aria-components';
import { useThemeClassName } from '../../theme/ThemeProvider';
import { cx } from '../../utils/cx';
import { Button } from '../Button/Button';
import { IconButton } from '../Button/IconButton';
import * as s from './Dialog.css';

export type ModalSize = 'small' | 'medium' | 'large' | 'palette';

export interface ModalProps
  extends Pick<ModalOverlayProps, 'isOpen' | 'defaultOpen' | 'onOpenChange' | 'isKeyboardDismissDisabled'> {
  children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
  /** Optional trigger; without it, control `isOpen` yourself. */
  trigger?: ReactElement;
  /** small 440 · medium 720 · large 808 (create record) · palette 748 (⌘); or a px width. */
  size?: ModalSize | number;
  /** Dim the page with surface.overlay (the UI uses it for e.g. Invite members; ⌘K has none). */
  overlay?: boolean;
  /** `top` (default) sits 14vh from the top; `center` centres vertically. */
  alignment?: 'top' | 'center';
  /** Close on outside click (default true). */
  isDismissable?: boolean;
  'aria-label'?: string;
  role?: 'dialog' | 'alertdialog';
  /** Class for the inner panel. */
  className?: string;
  /** Class for the translucent outer frame. */
  frameClassName?: string;
  style?: CSSProperties;
}

/**
 * Standalone modal dialog: translucent 3 px frame with a 15 px backdrop blur and e3 around a
 * 12 px-radius panel. Compose with DialogHeader / DialogBody / DialogFooter.
 */
export function Modal({
  children,
  trigger,
  size = 'medium',
  overlay = false,
  alignment = 'top',
  isDismissable = true,
  isOpen,
  defaultOpen,
  onOpenChange,
  isKeyboardDismissDisabled,
  'aria-label': ariaLabel,
  role,
  className,
  frameClassName,
  style,
}: ModalProps) {
  // The modal is a floating layer: elevated surfaces (e.g. a selected tab reads #f6f7f7, not #fbfbfb).
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  // Sizes are the outer frame width (the UI uses create record 808, ⌘K 748), frame included.
  const frameStyle: CSSProperties | undefined = typeof size === 'number' ? { width: size } : undefined;
  const modal = (
    <ModalOverlay
      isDismissable={isDismissable}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      isOpen={trigger ? undefined : isOpen}
      defaultOpen={trigger ? undefined : defaultOpen}
      onOpenChange={trigger ? undefined : onOpenChange}
      className={cx(themeClass, s.overlay, alignment === 'center' && s.overlayCenter, overlay && s.overlayDim)}
    >
      <RACModal
        className={cx(
          s.frame,
          alignment === 'center' && s.frameCenter,
          typeof size === 'string' && s.size[size],
          frameClassName,
        )}
        style={frameStyle}
      >
        <RACDialog aria-label={ariaLabel} role={role} className={cx(s.panel, className)} style={style}>
          {children}
        </RACDialog>
      </RACModal>
    </ModalOverlay>
  );
  if (!trigger) return modal;
  return (
    <DialogTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger}
      {modal}
    </DialogTrigger>
  );
}

export interface DialogHeaderProps {
  /** Title (Body.Standard primary); also the dialog's accessible name. */
  title: ReactNode;
  /** Leading element, e.g. an IconTile. */
  icon?: ReactNode;
  /** Extra controls before the close button. */
  actions?: ReactNode;
  /** Shows the 28 px ghost close button. */
  onClose?: () => void;
  closeLabel?: string;
  className?: string;
}

/** 44 px header row + 1 px rule: icon · title · actions · close. */
export function DialogHeader({ title, icon, actions, onClose, closeLabel = 'Close', className }: DialogHeaderProps) {
  return (
    <div className={cx(s.header, className)}>
      {icon}
      <Heading slot="title" className={s.headerTitle}>
        {title}
      </Heading>
      {actions}
      {onClose && <IconButton icon="close" aria-label={closeLabel} size={28} onPress={onClose} />}
    </div>
  );
}

export function DialogBody({
  children,
  className,
  style,
}: {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx(s.body, className)} style={style}>
      {children}
    </div>
  );
}

export interface DialogFooterProps {
  children?: ReactNode;
  /** Left-aligned content (e.g. a "Create more" switch or a navigation hint). */
  start?: ReactNode;
  className?: string;
}

/** Footer: 1 px top rule, padding 8, right-aligned actions with an 8 px gap. */
export function DialogFooter({ children, start, className }: DialogFooterProps) {
  return (
    <div className={cx(s.footer, className)}>
      {start && <div className={s.footerStart}>{start}</div>}
      {children}
    </div>
  );
}

export interface AlertDialogProps extends Pick<ModalOverlayProps, 'isOpen' | 'defaultOpen' | 'onOpenChange'> {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Affirmative button label (default "Confirm"). */
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** `danger` → destructive button (default); `primary` → primary. */
  variant?: 'danger' | 'primary';
  size?: 'default' | 'small';
  onConfirm?: () => void;
  onCancel?: () => void;
  trigger?: ReactElement;
  className?: string;
}

/**
 * Confirmation dialog: centred 440 px card over a 25 % (light) / 55 % (dark) overlay. Cancel is
 * focused first; Esc and Cancel close without action.
 */
export function AlertDialog({
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  size = 'default',
  onConfirm,
  onCancel,
  trigger,
  isOpen,
  defaultOpen,
  onOpenChange,
  className,
}: AlertDialogProps) {
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const content = (
    <ModalOverlay
      isDismissable={false}
      isOpen={trigger ? undefined : isOpen}
      defaultOpen={trigger ? undefined : defaultOpen}
      onOpenChange={trigger ? undefined : onOpenChange}
      className={cx(themeClass, s.alertOverlay)}
    >
      <RACModal className={cx(s.alert, size === 'small' && s.alertSmall, className)}>
        <RACDialog role="alertdialog" className={s.alertDialog}>
          {({ close }) => (
            <>
              <div className={s.alertBody}>
                <Heading slot="title" className={s.alertTitle}>
                  {title}
                </Heading>
                {description && <p className={s.alertDescription}>{description}</p>}
                {children}
              </div>
              <div className={s.footer}>
                <Button
                  variant="secondary"
                  size={28}
                  autoFocus
                  onPress={() => {
                    onCancel?.();
                    close();
                  }}
                >
                  {cancelLabel}
                </Button>
                <Button
                  variant={variant === 'danger' ? 'destructive' : 'primary'}
                  size={28}
                  onPress={() => {
                    onConfirm?.();
                    close();
                  }}
                >
                  {confirmLabel}
                </Button>
              </div>
            </>
          )}
        </RACDialog>
      </RACModal>
    </ModalOverlay>
  );
  if (!trigger) return content;
  return (
    <DialogTrigger isOpen={isOpen} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {trigger}
      {content}
    </DialogTrigger>
  );
}
