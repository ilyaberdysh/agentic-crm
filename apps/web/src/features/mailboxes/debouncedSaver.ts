// Debounced autosave: `schedule(value)` keeps only the latest value and saves it once `delayMs` passed without a
// newer one; `flush()` saves a pending value now (blur, switching signatures, unmount). The class is plain so it is
// unit-tested with fake timers; `useDebouncedSaver` wraps it for components and flushes when the component unmounts.
import { useEffect, useRef } from 'react';

export class DebouncedSaver<T> {
  private pending: { value: T } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private save: (value: T) => Promise<unknown> | void,
    private readonly delayMs: number,
  ) {}

  setSave(save: (value: T) => Promise<unknown> | void): void {
    this.save = save;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  schedule(value: T): void {
    this.pending = { value };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Saves the pending value now (if any). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) await this.save(pending.value);
  }

  /** Drops the pending value (the item is gone). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

export function useDebouncedSaver<T>(save: (value: T) => Promise<unknown> | void, delayMs: number): DebouncedSaver<T> {
  const ref = useRef<DebouncedSaver<T> | null>(null);
  if (!ref.current) ref.current = new DebouncedSaver(save, delayMs);
  ref.current.setSave(save);
  const saver = ref.current;
  useEffect(() => () => void saver.flush(), [saver]);
  return saver;
}
