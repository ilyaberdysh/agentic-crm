// CSV import / export icons: skip value, learn-more cards, the CSV file badge of
// the review rail, sort direction. Kept in their own map (spread into iconMap) so parallel slices add icons without
// touching the same lines.
import {
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Ban,
  Columns3,
  FileSpreadsheet,
  GraduationCap,
  Rows3,
} from 'lucide-react';
import type { IconGlyph } from './types';

export const importIconMap = {
  /** ⊘ skip value / skipped (review values, preview outcome). */
  skip: Ban,
  /** "Learn more" cards (academy / help articles). */
  learn: GraduationCap,
  /** A CSV file column (review values rail). */
  csvFile: FileSpreadsheet,
  columnsFound: Columns3,
  rowsFound: Rows3,
  sortAscending: ArrowUpNarrowWide,
  sortDescending: ArrowDownNarrowWide,
} satisfies Record<string, IconGlyph>;
