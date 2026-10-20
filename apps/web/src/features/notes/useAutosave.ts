// Debounced autosave of a text field (E README §3.1: note titles PATCH ~500 ms after typing stops). Local state is
// the source of truth while dirty; a server value arriving later only replaces an untouched field. Pending saves
// flush on blur and on unmount.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Autosave {
  value: string;
  set: (next: string) => void;
  /** Saves now if dirty. */
  flush: () => Promise<void>;
  /** Drops a pending save (deleting the item). */
  cancel: () => void;
  /** Replaces the value without saving (the server already has it). */
  reset: (next: string) => void;
}

export function useAutosave(
  serverValue: string,
  save: (value: string) => Promise<unknown>,
  { delayMs = 500, onError }: { delayMs?: number; onError?: (error: unknown) => void } = {},
): Autosave {
  const [value, setValue] = useState(serverValue);
  const dirty = useRef(false);
  const latest = useRef(serverValue);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!dirty.current) {
      latest.current = serverValue;
      setValue(serverValue);
    }
  }, [serverValue]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    try {
      await saveRef.current(latest.current);
    } catch (error) {
      onErrorRef.current?.(error);
    }
  }, []);

  const set = useCallback(
    (next: string) => {
      latest.current = next;
      dirty.current = true;
      setValue(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
  }, []);

  const reset = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    latest.current = next;
    setValue(next);
  }, []);

  useEffect(() => () => void flush(), [flush]);

  return { value, set, flush, cancel, reset };
}
