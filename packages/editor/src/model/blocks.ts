// The flat block model of a document body: an ordered list of blocks, each with its plain text,
// inline style ranges and mention references over that text. This is the server projection of the Yjs document
// (documents.blocks), the input of previews (<RichTextPreview>), markdown, search and AI.
//
// Differences from the wire form (kept deliberately small): camelCase names, one `mentions` array for actor and
// entity references, no per-block ids / sort orders / revisions (the Yjs document is the source of truth), and
// STRIKETHROUGH is not paired with the extra SUBTLE style. Positions are UTF-16 offsets into `text`.
import { z } from 'zod';

export const BLOCK_TYPES = ['unstyled', 'h1', 'h2', 'h3', 'ul', 'ol', 'image-embed'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const INLINE_STYLES = ['BOLD', 'ITALIC', 'STRIKETHROUGH', 'LINK', 'COLORED', 'HIGHLIGHTED'] as const;
export type InlineStyle = (typeof INLINE_STYLES)[number];

/** Image alignment within the editor column (default centre). */
export const IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type ImageAlignment = (typeof IMAGE_ALIGNMENTS)[number];

/** Deepest list indent the model supports. The editor currently creates at most eight levels. */
export const MAX_INDENT = 8;

const position = z.number().int().min(0);

export const styleRangeSchema = z.object({
  start: position,
  length: z.number().int().min(1),
  style: z.enum(INLINE_STYLES),
  /** LINK only. */
  link: z.string().optional(),
  /** COLORED (`block_*`) and HIGHLIGHTED (`pastel_*`) only. */
  color: z.string().optional(),
});
export type StyleRange = z.infer<typeof styleRangeSchema>;

export const mentionRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('member'),
    start: position,
    length: z.number().int().min(1),
    /** Workspace member id (actor_references, referenced_actor_type workspace-member). */
    id: z.string(),
  }),
  z.object({
    type: z.literal('record'),
    start: position,
    length: z.number().int().min(1),
    /** Entity instance id (entity_references). */
    id: z.string(),
    entityDefinitionId: z.string(),
  }),
]);
export type MentionRef = z.infer<typeof mentionRefSchema>;

/**
 * Placeholder variable (CROSS-DOMAIN B.11; F composer): occupies exactly one `_` character of the block
 * text at `start`. `path` walks attributes from the recipient record (each step an attribute id or api slug, with
 * the definition it belongs to when known); `field` picks a sub-field (e.g. `first_name` of a personal name);
 * `fallback` is used when the merged value is empty.
 */
export const variableRefSchema = z.object({
  start: position,
  length: z.literal(1),
  path: z
    .array(
      z.object({
        entityDefinitionId: z.string().nullable().optional(),
        attributeDefinitionId: z.string().min(1),
      }),
    )
    .min(1)
    .max(5),
  field: z.string().nullable(),
  fallback: z.string().max(1000).nullable(),
  /** Chip label at insertion time ("Name › First"). */
  label: z.string().max(500).optional(),
});
export type VariableRef = z.infer<typeof variableRefSchema>;

/** The character a variable occupies in `text`. */
export const VARIABLE_PLACEHOLDER = '_';

export const imageEmbedSchema = z.object({
  src: z.string().nullable(),
  /** File/asset id from the upload flow (S3 upload session); the stable reference when `src` is a signed URL. */
  assetId: z.string().nullable(),
  width: z.number().positive().nullable(),
  height: z.number().positive().nullable(),
  alignment: z.enum(IMAGE_ALIGNMENTS),
  caption: z.string().max(256).nullable(),
});
export type ImageEmbed = z.infer<typeof imageEmbedSchema>;

export const blockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  /** List nesting depth (0..MAX_INDENT); always 0 for non-list blocks. */
  indent: z.number().int().min(0).max(MAX_INDENT),
  /** Plain text; mentions appear as `@Name`, line breaks inside a block as `\n`; '' for images. */
  text: z.string(),
  styles: z.array(styleRangeSchema),
  mentions: z.array(mentionRefSchema),
  /** Placeholder variables (email bodies and templates); absent = none. */
  variables: z.array(variableRefSchema).optional(),
  /** image-embed only. */
  image: imageEmbedSchema.optional(),
});
export type Block = z.infer<typeof blockSchema>;

export const blocksSchema = z.array(blockSchema);

export function isListBlock(block: Pick<Block, 'type'>): boolean {
  return block.type === 'ul' || block.type === 'ol';
}

/** A text block with defaults filled in. */
export function textBlock(type: Exclude<BlockType, 'image-embed'>, text: string, extra: Partial<Block> = {}): Block {
  return { type, indent: 0, text, styles: [], mentions: [], ...extra };
}

export function imageBlock(image: Partial<ImageEmbed> & Pick<ImageEmbed, 'src'>): Block {
  return {
    type: 'image-embed',
    indent: 0,
    text: '',
    styles: [],
    mentions: [],
    image: { assetId: null, width: null, height: null, alignment: 'center', caption: null, ...image },
  };
}

/** Plain text of a document: one line per block, images as empty lines (the content_plaintext). */
export function blocksToPlaintext(blocks: readonly Block[]): string {
  return blocks.map((b) => (b.type === 'image-embed' ? '' : b.text)).join('\n');
}

/** Text used for full-text search: block texts plus image captions. */
export function blocksToSearchText(blocks: readonly Block[]): string {
  return blocks
    .map((b) => (b.type === 'image-embed' ? (b.image?.caption ?? '') : b.text))
    .filter((t) => t.trim() !== '')
    .join('\n');
}

/** Member and record mentions of a document, de-duplicated (the public `tags[]`). */
export function mentionsOf(
  blocks: readonly Block[],
): Array<{ type: 'member'; id: string } | { type: 'record'; id: string; entityDefinitionId: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: 'member'; id: string } | { type: 'record'; id: string; entityDefinitionId: string }> = [];
  for (const block of blocks) {
    for (const m of block.mentions) {
      const key = `${m.type}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        m.type === 'member'
          ? { type: 'member', id: m.id }
          : { type: 'record', id: m.id, entityDefinitionId: m.entityDefinitionId },
      );
    }
  }
  return out;
}

/** True when the document has no visible content (no text and no images). */
export function isEmptyBlocks(blocks: readonly Block[]): boolean {
  return blocks.every((b) => b.type !== 'image-embed' && b.text.trim() === '');
}
