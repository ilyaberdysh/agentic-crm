// Record page icons: tabs, header actions, merge, files and activity filters → Lucide glyphs.
// Kept in their own map (spread into iconMap) so parallel slices add icons without touching the same lines.
import {
  ArrowLeftRight,
  Blend,
  Equal,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  GitMerge,
  LayoutGrid,
  ListPlus,
  PanelRightOpen,
  SquareActivity,
  Unlink,
} from 'lucide-react';
import type { IconGlyph } from './types';

export const recordIconMap = {
  overview: LayoutGrid,
  activity: SquareActivity,
  relationship: Blend,
  noteTab: File,
  fileTab: Folder,
  merge: GitMerge,
  swap: ArrowLeftRight,
  equal: Equal,
  listAdd: ListPlus,
  unlink: Unlink,
  openPreview: PanelRightOpen,
  fileGeneric: File,
  fileDocument: FileText,
  fileImage: FileImage,
  fileVideo: FileVideo,
  fileAudio: FileAudio,
  fileArchive: FileArchive,
  fileCode: FileCode,
} satisfies Record<string, IconGlyph>;
