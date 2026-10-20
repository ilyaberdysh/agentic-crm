// Comments (BACKLOG 3.16). E3 for the record page: <RecordCommentsPanel recordRef/> (320 px, full height) and the
// comment count for its header button; the deep-link params (`useCommentDeepLink`) open the panel on a thread.
export { COMMENTS_PANEL_WIDTH, ObjectCommentsPanel, RecordCommentsPanel } from './CommentsPanel';
export { useCommentCounts, useThreads } from './data';
export { CommentDeepLink, type CommentDeepLinkParams, useCommentDeepLink, useObjectCommentsPanel } from './deepLink';
export { MentionInput } from './mentions/MentionInput';
