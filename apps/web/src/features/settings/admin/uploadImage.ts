// Avatar and logo uploads (J workspace-admin §1–2: "We only support PNGs, JPEGs and GIFs under 10MB"): the three-step
// record file flow to the uploader's own member record, answering the storage entry id the profile / workspace points at.
import { IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from '@agentic-crm/contracts';
import { api, inWorkspace, noteAcceptAfter, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';

export const IMAGE_ERROR = 'An error occurred while processing your file';
export const IMAGE_HINT = 'We only support PNGs, JPEGs and GIFs under 10MB';

/** Null when the file is an acceptable image. */
export function imageProblem(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type)) return IMAGE_HINT;
  if (file.size > IMAGE_MAX_BYTES) return IMAGE_HINT;
  return null;
}

const EXTENSION: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

/** Uploads an image to the member's own record (the server only accepts avatars and logos from there). */
export async function uploadMemberImage(
  workspace: WorkspaceRef,
  memberId: string,
  file: File,
  kind: 'avatar' | 'logo' = 'avatar',
): Promise<string> {
  const problem = imageProblem(file);
  if (problem) throw new Error(problem);
  // Names are unique per record: every upload is its own entry (earlier avatars stay in the member's files).
  const filename = `${kind}-${Date.now().toString(36)}.${EXTENSION[file.type] ?? 'png'}`;
  const session = await api.files.createUploadSession.mutate(
    {
      id: newId(),
      entityDefinitionId: 'workspace_members',
      entityInstanceId: memberId,
      parentFolderId: null,
      filename,
      contentType: file.type,
      contentSize: file.size,
    },
    inWorkspace(workspace),
  );
  const response = await fetch(session.upload.url, {
    method: session.upload.method,
    headers: session.upload.headers,
    body: file,
  }).catch(() => null);
  if (!response?.ok) throw new Error(IMAGE_ERROR);
  const done = await api.files.complete.mutate({ sessionId: session.session.id }, inWorkspace(workspace));
  noteAcceptAfter(workspace.id, done.seq);
  return done.entry.id;
}
