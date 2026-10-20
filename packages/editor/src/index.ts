// @agentic-crm/editor — the note editor (contract E1, research/architecture/decisions/slice3-contracts.md).
//   <RichTextEditor documentId docType collabUrl user readOnly? placeholder? onReady? autofocus? mentionSearch?
//                   uploadImage? onAwarenessChange? />  TipTap + Yjs via HocuspocusProvider (apps/collab)
//   <RichTextPreview blocks />                           read-only render of the flat blocks projection
//   <InsertMenuButton handle />, <PresenceAvatars users />
//   blocksToMarkdown / markdownToBlocks                  shared with the server projection
// The DOM-free model (schema, blocks, markdown, Yjs) is also available as `@agentic-crm/editor/model`.
export {
  type Block,
  type BlockType,
  blocksToMarkdown,
  blocksToPlaintext,
  type CollabDenyReason,
  isEmptyBlocks,
  markdownToBlocks,
  mentionsOf,
  type StyleRange,
  textBlock,
  VARIABLE_PLACEHOLDER,
  type VariableRef,
} from './model/index.ts';
export {
  BlockEditor,
  type BlockEditorProps,
  EMAIL_TOOLBAR,
  type EmailEditorHandle,
  LineEditor,
  type LineEditorProps,
  type LineValue,
  type ToolbarOptions,
  type VariableClick,
  type VariableHooks,
  type VariableInput,
  type VariableMenuRequest,
} from './react/BlockEditor.tsx';
export { InsertMenuButton, type InsertMenuButtonProps } from './react/InsertMenu.tsx';
export { INSERT_ITEMS, type InsertItem } from './react/insert-items.tsx';
export { PresenceAvatars, type PresenceAvatarsProps } from './react/PresenceAvatars.tsx';
export { presenceUsers, RichTextEditor } from './react/RichTextEditor.tsx';
export { RichTextPreview, type RichTextPreviewProps } from './react/RichTextPreview.tsx';
export { normalizeUrl } from './react/SelectionToolbar.tsx';
export type {
  DocType,
  EditorHandle,
  EditorStatus,
  EditorUser,
  InsertItemId,
  MentionItem,
  MentionSearch,
  PresenceUser,
  RichTextEditorProps,
  UploadedImage,
  UploadImage,
} from './react/types.ts';
