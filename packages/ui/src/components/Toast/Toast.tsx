import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, type Ref, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button as RACButton } from 'react-aria-components';
import { createPortal } from 'react-dom';
import { Icon } from '../../icons/Icon';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { useThemeClassName } from '../../theme/ThemeProvider';
import { cx } from '../../utils/cx';
import { Button } from '../Button/Button';
import { type ToastAction, type ToastRecord, type ToastStore, type ToastVariant, toastStore } from './store';
import * as s from './Toast.css';

const VARIANT_ICON: Record<ToastVariant, IconName> = {
  neutral: 'info',
  success: 'success',
  warning: 'warning',
  error: 'warning',
};

export interface ToastCardProps {
  variant?: ToastVariant;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  dismissable?: boolean;
  icon?: IconName | IconGlyph;
  progress?: number;
  onDismiss?: () => void;
  className?: string;
  /** Receives the inner content row (used by Toaster to measure natural height). */
  contentRef?: Ref<HTMLDivElement>;
}

/** The toast card itself (static); <Toaster /> stacks and animates these. */
export function ToastCard({
  variant = 'neutral',
  title,
  description,
  action,
  dismissable = true,
  icon,
  progress,
  onDismiss,
  className,
  contentRef,
}: ToastCardProps) {
  return (
    <div className={cx(s.card, className)} data-variant={variant}>
      <div ref={contentRef} className={s.content}>
        <span className={cx(s.iconBox, s.iconTone[variant])} aria-hidden="true">
          <Icon icon={icon ?? VARIANT_ICON[variant]} size={12} />
        </span>
        <div className={s.textBlock}>
          <div className={s.title}>{title}</div>
          {description && <div className={s.description}>{description}</div>}
          {action &&
            (action.style === 'button' ? (
              <Button
                variant="secondary"
                size={20}
                className={s.actionButton}
                onPress={() => {
                  action.onAction();
                  onDismiss?.();
                }}
              >
                {action.label}
              </Button>
            ) : (
              <RACButton
                className={s.actionLink}
                onPress={() => {
                  action.onAction();
                  onDismiss?.();
                }}
              >
                {action.label}
              </RACButton>
            ))}
        </div>
        {dismissable && (
          <RACButton className={s.close} aria-label="Dismiss" onPress={onDismiss}>
            <Icon icon="close" size={16} />
          </RACButton>
        )}
      </div>
      {progress !== undefined && (
        <div className={s.progressTrack}>
          <div className={s.progressFill} style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

// CSS `ease`, used by Attio's toast transitions.
const EASE = [0.25, 0.1, 0.25, 1] as const;
const STACK_OFFSET = 8;
const GAP = 8;

interface ItemLayout {
  y: number;
  scale: number;
  height: number;
  hidden: boolean;
  contentVisible: boolean;
  /** Collapsed toasts behind the front one take its width so the stack lines up. */
  width?: number;
}

function ToastItem({
  record,
  layout,
  zIndex,
  paused,
  onMeasure,
  store,
}: {
  record: ToastRecord;
  layout: ItemLayout;
  zIndex: number;
  paused: boolean;
  onMeasure: (id: string, height: number, width: number | null) => void;
  store: ToastStore;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const forced = useRef(layout.width !== undefined);
  forced.current = layout.width !== undefined;
  const remaining = useRef(record.durationMs ?? 4000);
  const startedAt = useRef(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // Natural card height = content row + 2 × 10 px padding; width only while not forced.
    const measure = () =>
      onMeasure(record.id, el.offsetHeight + 20, forced.current ? null : (el.parentElement?.offsetWidth ?? null));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [record.id, onMeasure]);

  // Auto-dismiss: pauses while the stack is hovered/focused and resumes with the remaining time.
  useEffect(() => {
    if (paused || !Number.isFinite(remaining.current)) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => store.dismiss(record.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, record.id, store]);

  return (
    <motion.li
      className={s.item}
      role={record.variant === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      style={{ zIndex, width: layout.width }}
      initial={{ opacity: 0, y: layout.y - 24, scale: layout.scale, height: layout.height }}
      animate={{ opacity: layout.hidden ? 0 : 1, y: layout.y, scale: layout.scale, height: layout.height }}
      exit={{ opacity: 0, transition: { duration: 0.3, ease: EASE } }}
      transition={{
        y: { duration: 0.4, ease: EASE },
        scale: { duration: 0.4, ease: EASE },
        height: { duration: 0.3, ease: EASE },
        opacity: { duration: 0.4, ease: EASE },
      }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.6 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 80 || info.velocity.x > 500) store.dismiss(record.id);
      }}
    >
      {/* Behind the front toast only the content fades (0.4 s); the card chrome stays visible. */}
      <div style={{ height: '100%' }}>
        <ToastCard
          contentRef={contentRef}
          className={cx(
            s.cardFill,
            layout.width !== undefined && s.cardForced,
            !layout.contentVisible && s.contentHidden,
          )}
          variant={record.variant}
          title={record.title}
          description={record.description}
          action={record.action}
          dismissable={record.dismissable}
          icon={record.icon}
          progress={record.progress}
          onDismiss={() => store.dismiss(record.id)}
        />
      </div>
    </motion.li>
  );
}

export interface ToasterProps {
  store?: ToastStore;
  /** Toasts visible in the collapsed stack (default 3). */
  visibleCount?: number;
}

/**
 * Renders the toast stack top-right. Collapsed: newest in front, older ones 8 px lower per level,
 * scaled 1 − 0.05·level and clipped to the front toast; hovering expands to a list with 8 px gaps.
 * F8 focuses the region. Mount once near the app root.
 */
export function Toaster({ store = toastStore, visibleCount = 3 }: ToasterProps) {
  const toasts = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const ref = useRef<HTMLElement>(null);
  const themeClass = useThemeClassName({ surfaceMode: 'elevated' });
  const expanded = hovered || focused;

  const onMeasure = useRef((id: string, h: number, w: number | null) => {
    setHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
    if (w !== null) setWidths((prev) => (prev[id] === w ? prev : { ...prev, [id]: w }));
  }).current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F8') {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }, [toasts.length]);

  if (typeof document === 'undefined') return null;

  const front = toasts[0];
  const frontHeight = front ? (heights[front.id] ?? 40) : 0;
  const frontWidth = front ? widths[front.id] : undefined;
  let offset = 0;
  const layouts: ItemLayout[] = toasts.map((t, i) => {
    const h = heights[t.id] ?? 40;
    const layout: ItemLayout = expanded
      ? { y: offset, scale: 1, height: h, hidden: false, contentVisible: true }
      : {
          y: i * STACK_OFFSET,
          scale: 1 - 0.05 * Math.min(i, visibleCount),
          height: frontHeight,
          hidden: i >= visibleCount,
          contentVisible: i === 0,
          width: i === 0 ? undefined : frontWidth,
        };
    offset += h + GAP;
    return layout;
  });
  const height = expanded
    ? Math.max(0, offset - GAP)
    : frontHeight + Math.max(0, Math.min(toasts.length, visibleCount) - 1) * STACK_OFFSET;

  return createPortal(
    <section
      ref={ref}
      aria-label="Notifications (F8)"
      tabIndex={-1}
      className={cx(themeClass, s.viewport)}
      style={{ height }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', position: 'relative', height: '100%' }}>
        <AnimatePresence initial={false}>
          {toasts.map((t, i) => (
            <ToastItem
              key={t.id}
              record={t}
              layout={layouts[i] as ItemLayout}
              zIndex={toasts.length - i}
              paused={expanded}
              onMeasure={onMeasure}
              store={store}
            />
          ))}
        </AnimatePresence>
      </ol>
    </section>,
    document.body,
  );
}
