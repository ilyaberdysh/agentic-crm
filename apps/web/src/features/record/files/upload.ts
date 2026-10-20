// Three-step record file upload (D README §4.4; contract E5; CROSS-DOMAIN B.23): createUploadSession (client-minted
// session id, idempotent) → PUT the bytes to the presigned URL → complete (the server verifies the object and creates
// the file entry). Sizes and names are checked before anything is sent.
import { MAX_FILE_BYTES } from '@agentic-crm/contracts';
import { api, errorEnvelopeOf, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';

export interface UploadTarget {
  entityDefinitionId: string;
  entityInstanceId: string;
  parentFolderId: string | null;
}

export class UploadError extends Error {}

/** "28 bytes", "1.2 KB", "3.4 MB" (Files tab rows, D §3.9). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Client-side checks before an upload session is requested. */
export function validateUpload(file: Pick<File, 'name' | 'size'>): string | null {
  if (file.size > MAX_FILE_BYTES) return `"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)}`;
  if (/[/\\]/.test(file.name)) return 'Names cannot contain slashes';
  if (!file.name.trim()) return 'The file needs a name';
  return null;
}

export type UploadStatus = 'Uploading' | 'Syncing' | 'Complete' | 'Failed';

export async function uploadFile(
  workspace: WorkspaceRef,
  target: UploadTarget,
  file: File,
  onStatus?: (status: UploadStatus) => void,
): Promise<void> {
  const problem = validateUpload(file);
  if (problem) throw new UploadError(problem);
  onStatus?.('Uploading');
  let session: Awaited<ReturnType<typeof api.files.createUploadSession.mutate>>;
  try {
    session = await api.files.createUploadSession.mutate(
      {
        id: newId(),
        entityDefinitionId: target.entityDefinitionId,
        entityInstanceId: target.entityInstanceId,
        parentFolderId: target.parentFolderId,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        contentSize: file.size,
      },
      inWorkspace(workspace),
    );
  } catch (error) {
    onStatus?.('Failed');
    const { message, code } = errorEnvelopeOf(error);
    throw new UploadError(code === 'NAME_IN_USE' ? 'A file with this name already exists' : (message ?? 'Failed'));
  }
  const response = await fetch(session.upload.url, {
    method: session.upload.method,
    headers: session.upload.headers,
    body: file,
  }).catch(() => null);
  if (!response?.ok) {
    onStatus?.('Failed');
    throw new UploadError('Failed to upload file');
  }
  onStatus?.('Syncing');
  try {
    const done = await api.files.complete.mutate({ sessionId: session.session.id }, inWorkspace(workspace));
    noteAcceptAfter(workspace.id, done.seq);
  } catch (error) {
    onStatus?.('Failed');
    throw new UploadError(errorEnvelopeOf(error).message ?? 'Failed to upload file');
  }
  onStatus?.('Complete');
}
