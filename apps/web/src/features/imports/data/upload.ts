// After "Next", parsed rows upload in chunks and in order while
// the user maps columns; steps after Map columns wait for it ("We're still uploading your CSV file…"). "Start over"
// cancels it. State is a tiny external store keyed by import id.
import { useSyncExternalStore } from 'react';
import { queryClient } from '../../../data/queryClient';
import type { WorkspaceRef } from '../../../data/trpc';
import { importKeys, importsBackend } from './backend';

export const UPLOAD_CHUNK_ROWS = 1000;

export interface UploadState {
  jobId: string;
  total: number;
  sent: number;
  state: 'uploading' | 'done' | 'failed' | 'canceled';
  error: string | null;
}

const uploads = new Map<string, UploadState>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

function set(state: UploadState): void {
  uploads.set(state.jobId, state);
  emit();
}

export function startUpload(ws: WorkspaceRef, jobId: string, rows: string[][]): void {
  const initial: UploadState = { jobId, total: rows.length, sent: 0, state: 'uploading', error: null };
  set(initial);
  void (async () => {
    try {
      const backend = await importsBackend(ws);
      for (let start = 0; start < rows.length; start += UPLOAD_CHUNK_ROWS) {
        if (uploads.get(jobId)?.state === 'canceled') return;
        await backend.uploadRows({
          jobId,
          start,
          rows: rows.slice(start, start + UPLOAD_CHUNK_ROWS),
          final: start + UPLOAD_CHUNK_ROWS >= rows.length,
        });
        set({ ...initial, sent: Math.min(rows.length, start + UPLOAD_CHUNK_ROWS) });
      }
      set({ ...initial, sent: rows.length, state: 'done' });
    } catch (error) {
      set({ ...initial, state: 'failed', error: error instanceof Error ? error.message : 'Failed to upload file' });
    } finally {
      await queryClient.invalidateQueries({ queryKey: importKeys.job(ws.id, jobId) });
    }
  })();
}

export function cancelUpload(jobId: string): void {
  const s = uploads.get(jobId);
  if (s && s.state === 'uploading') set({ ...s, state: 'canceled' });
}

export function useUpload(jobId: string | null): UploadState | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (jobId ? uploads.get(jobId) : undefined),
  );
}

/** "Uploading file… 42%". */
export function uploadPercent(s: UploadState | undefined): number {
  if (!s || s.total === 0) return 100;
  return Math.floor((s.sent / s.total) * 100);
}
