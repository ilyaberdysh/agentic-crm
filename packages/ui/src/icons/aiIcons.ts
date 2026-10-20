// Formula editor and AI attribute icons (slice 10, I formulas §4, ai-attributes §2–5) → Lucide glyphs.
// Kept in their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import {
  Braces,
  Coins,
  Globe,
  MessageSquareText,
  PanelBottomClose,
  PanelBottomOpen,
  Redo2,
  Sparkle,
  Square,
  SquareFunction,
  Tags,
  TextQuote,
  WandSparkles,
} from 'lucide-react';
import type { IconGlyph } from './types';

export const aiIconMap = {
  /** The "fx" marker of formula attributes (record page labels, column headers). */
  formulaFx: SquareFunction,
  /** "Add variable" / "Use variable" (inserts `{` and opens the attribute picker). */
  variable: Braces,
  redo: Redo2,
  /** "Cancel generation" (stop square). */
  stop: Square,
  helperHide: PanelBottomClose,
  helperShow: PanelBottomOpen,
  credits: Coins,
  /** "Run AI autofill" / "Recalculate with AI". */
  aiRun: WandSparkles,
  /** The AI "Fix" button of the formula editor. */
  aiFix: Sparkle,
  aiSummarize: TextQuote,
  aiClassify: Tags,
  aiPrompt: MessageSquareText,
  aiWeb: Globe,
} satisfies Record<string, IconGlyph>;
