// Device-local persisted client state (B-shell README §4). Every key is prefixed `ar:` (Attio prefixes `agentic-crm:`);
// reads and writes never throw (private mode, quota, disabled storage).
import { useCallback, useEffect, useState } from 'react';

export const STORAGE_PREFIX = 'ar:';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRaw(key: string): string | null {
  try {
    return storage()?.getItem(STORAGE_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string | null): void {
  try {
    const s = storage();
    if (!s) return;
    if (value === null) s.removeItem(STORAGE_PREFIX + key);
    else s.setItem(STORAGE_PREFIX + key, value);
  } catch {
    // quota or disabled storage: the state simply is not persisted
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeRaw(key, value === undefined ? null : JSON.stringify(value));
}

/**
 * `useState` persisted as JSON under `ar:<key>`, kept in sync across tabs through `storage` events (Attio's
 * JSON-state hook behaves the same way).
 */
export function usePersistentState<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readJson(key, fallback));

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_PREFIX + key) return;
      if (e.newValue === null) setValue(fallback);
      else {
        try {
          setValue(JSON.parse(e.newValue) as T);
        } catch {
          // ignore malformed values written by someone else
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // `fallback` is a constant at every call site.
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        writeJson(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
