// A dialog another part of the app wants open on a record page that is about to mount ("Merge record with…" from the
// command palette navigates to the record and opens the merge modal there). The record page takes the request for its
// own record once on mount; a request for another record is dropped.
export type PendingRecordDialog = 'merge';

let pending: { recordId: string; dialog: PendingRecordDialog } | null = null;

export function requestRecordDialog(recordId: string, dialog: PendingRecordDialog): void {
  pending = { recordId, dialog };
}

export function takeRecordDialog(recordId: string): PendingRecordDialog | null {
  const request = pending;
  pending = null;
  return request && request.recordId === recordId ? request.dialog : null;
}
