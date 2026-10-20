// @agentic-crm/editor/model — the document model shared by the browser editor, the collab server and the domain:
// flat blocks (the server content model), markdown, the ProseMirror schema and Yjs conversions.
// No React and no DOM: safe to import from Node services.
export { DOCUMENT_FRAGMENT, getDocumentSchema, schemaExtensions } from '../extensions/schema.ts';
export {
  BLOCK_TYPES,
  type Block,
  type BlockType,
  blockSchema,
  blocksSchema,
  blocksToPlaintext,
  blocksToSearchText,
  IMAGE_ALIGNMENTS,
  type ImageAlignment,
  type ImageEmbed,
  INLINE_STYLES,
  type InlineStyle,
  imageBlock,
  isEmptyBlocks,
  isListBlock,
  MAX_INDENT,
  type MentionRef,
  mentionsOf,
  type StyleRange,
  textBlock,
  VARIABLE_PLACEHOLDER,
  type VariableRef,
  variableRefSchema,
} from './blocks.ts';
export { type CollabAwarenessUser, CollabCloseCode, type CollabDenyReason } from './collab.ts';
export {
  ALL_HIGHLIGHT_COLORS,
  ALL_TEXT_COLORS,
  HIGHLIGHT_COLORS,
  type HighlightColorKey,
  hueOfColorKey,
  isHighlightColor,
  isTextColor,
  PRESENCE_HUES,
  type PresenceHue,
  presenceColor,
  presenceHue,
  TEXT_COLORS,
  type TextColorKey,
} from './colors.ts';
export { blocksToMarkdown, markdownToBlocks, normalizeStyles, parseInlineMarkdown } from './markdown.ts';
export { listNumbers, type NumberingItem } from './numbering.ts';
export { blocksToPmJson, type PMMarkJSON, type PMNodeJSON, pmJsonToBlocks } from './pm.ts';
export {
  appendYDocContent,
  blocksToState,
  type DocumentProjection,
  projectBlocks,
  projectState,
  projectYDoc,
  replaceYDocContent,
  stateToBlocks,
  yDocFromState,
  yDocToBlocks,
  yDocToPmJson,
} from './yjs.ts';
