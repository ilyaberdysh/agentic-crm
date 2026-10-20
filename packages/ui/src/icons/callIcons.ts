// Call intelligence icons (I calls): call-page tabs, template editor and preset gallery → Lucide glyphs.
// Kept in their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import {
  Archive,
  ArchiveRestore,
  AudioLines,
  Bot,
  ChartLine,
  ClipboardList,
  Globe,
  HeartHandshake,
  Landmark,
  LayoutGrid,
  List,
  Play,
  Rocket,
  Type,
  Users,
} from 'lucide-react';
import type { IconGlyph } from './types';

export const callIconMap = {
  /** Call page "Transcript" tab. */
  transcript: AudioLines,
  /** Call page "Summary" tab (narrow) and the Summary heading. */
  summaryTab: ClipboardList,
  /** Insight template list tile and breadcrumb. */
  insightTemplate: ClipboardList,
  /** Section format: "List" and "Text". */
  formatList: List,
  formatText: Type,
  /** Archive template / Restore template. */
  archive: Archive,
  unarchive: ArchiveRestore,
  /** Presets gallery use-case chips (General, Sales, Success, Product, Marketing, Recruiting, Fundraising, Investing). */
  presetGeneral: LayoutGrid,
  presetSales: ChartLine,
  presetSuccess: HeartHandshake,
  presetProduct: Rocket,
  presetMarketing: Globe,
  presetRecruiting: Users,
  presetFundraising: Landmark,
  presetInvesting: ChartLine,
  /** Speakers tab: start focus mode (the × exits it). */
  focusPlay: Play,
  /** Preview source picker. */
  previewBot: Bot,
} satisfies Record<string, IconGlyph>;
