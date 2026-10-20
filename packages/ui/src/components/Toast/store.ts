// Toast store (system-ui §1): a tiny external store so any module can raise a toast
// (`toast.success('Saved')`) and <Toaster /> renders the stack.
import type { ReactNode } from 'react';
import type { IconName } from '../../icons/iconMap';
import type { IconGlyph } from '../../icons/types';
import { density } from '../../tokens';

export type ToastVariant = 'neutral' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: ReactNode;
  onAction: () => void;
  /** `link` (12 px link-style, default) or `button` (secondary 20 px). */
  style?: 'link' | 'button';
}

export interface ToastOptions {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  /** Default 4000 ms; `Infinity` keeps the toast until dismissed. */
  durationMs?: number;
  /** Shows the close button (default true). */
  dismissable?: boolean;
  /** Overrides the variant icon. */
  icon?: IconName | IconGlyph;
  /** 0–1: draws the 2 px progress bar. */
  progress?: number;
  onDismiss?: () => void;
}

export interface ToastRecord extends ToastOptions {
  id: string;
  variant: ToastVariant;
  createdAt: number;
}

type Listener = () => void;

let counter = 0;

export class ToastStore {
  private toasts: ToastRecord[] = [];
  private listeners = new Set<Listener>();

  /** Newest first. */
  getSnapshot = (): ToastRecord[] => this.toasts;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  add(variant: ToastVariant, options: ToastOptions): string {
    const id = options.id ?? `toast-${Date.now().toString(36)}-${(counter++).toString(36)}`;
    const record: ToastRecord = {
      durationMs: density.toastDurationMs,
      dismissable: true,
      ...options,
      id,
      variant,
      createdAt: Date.now(),
    };
    this.toasts = [record, ...this.toasts.filter((t) => t.id !== id)];
    this.emit();
    return id;
  }

  update(id: string, patch: Partial<ToastOptions>): void {
    this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.emit();
  }

  dismiss(id: string): void {
    const found = this.toasts.find((t) => t.id === id);
    if (!found) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    found.onDismiss?.();
    this.emit();
  }

  clear(): void {
    this.toasts = [];
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

export const toastStore = new ToastStore();

type ToastInput = ReactNode | ToastOptions;

function normalize(input: ToastInput, extra?: Omit<ToastOptions, 'title'>): ToastOptions {
  if (input && typeof input === 'object' && 'title' in (input as object))
    return { ...(input as ToastOptions), ...extra };
  return { title: input as ReactNode, ...extra };
}

/**
 * Raise a toast. `toast('Copied to clipboard')`, `toast.error('Failed', { description })`,
 * `toast.success({ title, action: { label: 'Undo', onAction } })`. Returns the toast id.
 */
export const toast = Object.assign(
  (input: ToastInput, extra?: Omit<ToastOptions, 'title'>) => toastStore.add('neutral', normalize(input, extra)),
  {
    neutral: (input: ToastInput, extra?: Omit<ToastOptions, 'title'>) =>
      toastStore.add('neutral', normalize(input, extra)),
    success: (input: ToastInput, extra?: Omit<ToastOptions, 'title'>) =>
      toastStore.add('success', normalize(input, extra)),
    warning: (input: ToastInput, extra?: Omit<ToastOptions, 'title'>) =>
      toastStore.add('warning', normalize(input, extra)),
    error: (input: ToastInput, extra?: Omit<ToastOptions, 'title'>) => toastStore.add('error', normalize(input, extra)),
    update: (id: string, patch: Partial<ToastOptions>) => toastStore.update(id, patch),
    dismiss: (id: string) => toastStore.dismiss(id),
    clear: () => toastStore.clear(),
  },
);
