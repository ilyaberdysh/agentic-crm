// Comment deep link `/$ws/comment/$commentHeaderId` (B README §2.7; E README §1): locates the comment and redirects
// (replace) to the commented record's object view with `threadCommentId`, `commentId`, `commentEntityDefinitionId`,
// `commentEntityInstanceId`; that page opens the "All comments" panel on the thread ("Comment on ‹record›", highlighted).
// Not found / no access: toast "We can't find that comment" (5 s) and back to the workspace root.
// The same params open the thread on a record page (`useCommentDeepLink`).
import { toast } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { objectPath, useObjects } from '../../data/objects';
import { api, inWorkspace } from '../../data/trpc';
import { ContentSpinner } from '../shell/AppShell';
import { useWorkspace } from '../shell/workspaceContext';

export const COMMENT_PARAMS = [
  'comments',
  'threadCommentId',
  'commentId',
  'commentEntityDefinitionId',
  'commentEntityInstanceId',
] as const;

export interface CommentDeepLinkParams {
  threadId: string;
  commentId: string | null;
  entityDefinitionId: string | null;
  entityInstanceId: string | null;
}

export function commentSearch(params: CommentDeepLinkParams): string {
  const q = new URLSearchParams({ threadCommentId: params.threadId });
  if (params.commentId) q.set('commentId', params.commentId);
  if (params.entityDefinitionId) q.set('commentEntityDefinitionId', params.entityDefinitionId);
  if (params.entityInstanceId) q.set('commentEntityInstanceId', params.entityInstanceId);
  return `?${q.toString()}`;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** The thread a comment link asks to show on this page (null when none). */
export function useCommentDeepLink(): CommentDeepLinkParams | null {
  const search = useRouterState({ select: (st) => st.location.search }) as unknown as Record<string, unknown>;
  const threadId = str(search.threadCommentId);
  if (!threadId) return null;
  return {
    threadId,
    commentId: str(search.commentId),
    entityDefinitionId: str(search.commentEntityDefinitionId),
    entityInstanceId: str(search.commentEntityInstanceId),
  };
}

/** Open state of an object page's "All comments" panel (URL: `?comments=all` or a deep link). */
export function useObjectCommentsPanel() {
  const router = useRouter();
  const search = useRouterState({ select: (st) => st.location.search }) as unknown as Record<string, unknown>;
  const link = useCommentDeepLink();
  const open = Boolean(link) || search.comments === 'all';
  const setSearch = (next: Record<string, string> | null) => {
    const location = router.state.location;
    const params = new URLSearchParams(location.searchStr.replace(/^\?/, ''));
    for (const key of COMMENT_PARAMS) params.delete(key);
    for (const [k, v] of Object.entries(next ?? {})) params.set(k, v);
    const qs = params.toString();
    void router.navigate({ href: `${location.pathname}${qs ? `?${qs}` : ''}`, replace: true });
  };
  return {
    open,
    link,
    toggle: () => setSearch(open ? null : { comments: 'all' }),
    close: () => setSearch(null),
  };
}

export function CommentDeepLink({ commentId }: { commentId: string }) {
  const { workspace, href } = useWorkspace();
  const navigate = useNavigate();
  const objects = useObjects(workspace);
  const ws = { id: workspace.id, slug: workspace.slug };
  const located = useQuery({
    queryKey: ['ws', ws.id, 'comment-locate', commentId],
    queryFn: () => api.comments.locate.query({ commentId }, inWorkspace(ws)),
    retry: false,
  });

  useEffect(() => {
    if (located.isError) {
      toast.error({
        title: "We can't find that comment",
        description: 'The comment or its parent record may have been deleted.',
        durationMs: 5000,
      });
      void navigate({ href: href(), replace: true });
      return;
    }
    if (!located.data || !objects.data) return;
    const { target, parentRecord, threadId } = located.data;
    const record = target.kind === 'record' ? target : parentRecord;
    const object = record ? objects.data.find((o) => o.id === record.entityDefinitionId) : undefined;
    if (!object || !record) {
      void navigate({ href: href(), replace: true });
      return;
    }
    const search = commentSearch({
      threadId,
      commentId: located.data.commentId,
      entityDefinitionId: record.entityDefinitionId,
      entityInstanceId: record.entityInstanceId,
    });
    void navigate({ href: `${href(objectPath(object))}${search}`, replace: true });
  }, [located.isError, located.data, objects.data, navigate, href]);

  return <ContentSpinner />;
}
