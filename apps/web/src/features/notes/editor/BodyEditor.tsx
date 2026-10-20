// The one adapter between note / template windows and the rich-text editor (contract E1, packages/editor):
// <RichTextEditor> on the collab server (`/collab`, proxied by the web dev server; document name = document id,
// session cookie auth), mention search over members and records (B.8 search), the current member as the caret
// owner. The windows talk to it through the handle; the empty-note template launcher gets ↑ / ↓ / Enter first while
// the body is empty.
import {
  type EditorHandle,
  type EditorStatus,
  type MentionItem,
  type MentionSearch,
  type PresenceUser,
  RichTextEditor,
} from '@agentic-crm/editor';
import { useCallback, useMemo, useRef } from 'react';
import { useObjects } from '../../../data/objects';
import { api, inWorkspace } from '../../../data/trpc';
import { useWorkspace } from '../../shell/workspaceContext';

export type { EditorHandle, PresenceUser };

export function collabUrl(): string {
  return `${window.location.origin.replace(/^http/, 'ws')}/collab`;
}

/** Members first ("Users"), then records ("Records"), 10 each (editor.md §5). */
export function useMentionSearch(): MentionSearch {
  const { workspace } = useWorkspace();
  const objects = useObjects(workspace).data;
  return useCallback<MentionSearch>(
    async (query) => {
      const ws = { id: workspace.id, slug: workspace.slug };
      const [members, records] = await Promise.all([
        api.search.members.query({ query, limit: 10 }, inWorkspace(ws)),
        api.search.records.query({ query, limit: 10 }, inWorkspace(ws)),
      ]);
      const out: MentionItem[] = members.hits.map((m) => ({
        kind: 'member',
        id: m.id,
        label: `${m.firstName} ${m.lastName}`.trim() || m.emailAddress,
        secondary: m.emailAddress.split('@')[1] ?? null,
      }));
      for (const r of records.hits) {
        const object = objects?.find((o) => o.id === r.entityDefinitionId);
        out.push({
          kind: 'record',
          id: r.entityInstanceId,
          entityDefinitionId: r.entityDefinitionId,
          label: r.title ?? 'Untitled record',
          secondary: r.subtitle ?? null,
          objectName: object?.singularNoun ?? null,
          shape: object?.entityType === 'person-record' ? 'round' : 'box',
        });
      }
      return out;
    },
    [workspace.id, workspace.slug, objects],
  );
}

export interface BodyEditorProps {
  documentId: string;
  docType: 'note' | 'note-template';
  placeholder?: string;
  readOnly?: boolean;
  autofocus?: boolean;
  onReady?: (handle: EditorHandle) => void;
  onChange?: (state: { isEmpty: boolean }) => void;
  onAwarenessChange?: (users: PresenceUser[]) => void;
  onStatusChange?: (status: EditorStatus) => void;
  /** Keyboard navigation of the empty-note template launcher (↑ / ↓ / Enter while the body is empty). */
  onLauncherKey?: (key: 'ArrowUp' | 'ArrowDown' | 'Enter') => boolean;
  className?: string;
}

export function BodyEditor({
  documentId,
  docType,
  placeholder,
  readOnly,
  autofocus,
  onReady,
  onChange,
  onAwarenessChange,
  onStatusChange,
  onLauncherKey,
  className,
}: BodyEditorProps) {
  const { me, workspace } = useWorkspace();
  const mentionSearch = useMentionSearch();
  const handle = useRef<EditorHandle | null>(null);
  const user = useMemo(
    () => ({ id: me.user.id, memberId: workspace.membership.id, name: me.user.name || me.user.email }),
    [me.user.id, me.user.name, me.user.email, workspace.membership.id],
  );
  const ready = useCallback(
    (h: EditorHandle) => {
      handle.current = h;
      onReady?.(h);
    },
    [onReady],
  );
  const status = useCallback((s: EditorStatus) => onStatusChange?.(s), [onStatusChange]);
  return (
    // Capture phase: the launcher sees the keys before ProseMirror does.
    <div
      className={className}
      data-editor="collab"
      data-document-id={documentId}
      onKeyDownCapture={(e) => {
        if (!onLauncherKey || !handle.current?.isEmpty()) return;
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'Enter') return;
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        if (onLauncherKey(e.key)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <RichTextEditor
        documentId={documentId}
        docType={docType}
        collabUrl={collabUrl()}
        user={user}
        readOnly={readOnly}
        placeholder={placeholder}
        autofocus={autofocus ? 'end' : undefined}
        onReady={ready}
        mentionSearch={mentionSearch}
        onAwarenessChange={onAwarenessChange}
        onStatusChange={status}
        onChange={onChange}
      />
    </div>
  );
}
