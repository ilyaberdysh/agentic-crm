// Block appearance and palette grouping (block-catalog §2–4, README §2.3): a glyph per catalogue slug, a tint per
// category (icon tiles are light tinted squares with a coloured glyph), palette groups in category order with triggers
// before steps, and the catalogue lookups the editor needs. Pure.
import {
  BLOCK_CATEGORY_LABELS,
  type BlockCategory,
  type BlockDefinition,
  blockCategories,
  blockDefinition,
} from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';

const ICONS: Record<string, IconName> = {
  'on-record-action': 'wfRecordAction',
  'on-record-created': 'wfRecordCreated',
  'on-record-updated': 'wfRecordUpdated',
  'on-list-entry-action': 'wfEntryAction',
  'on-list-entry-created': 'wfEntryCreated',
  'on-list-entry-updated': 'wfEntryUpdated',
  'on-attribute-invalidated': 'wfAttributeChanged',
  'on-task-created': 'wfTaskCreated',
  'on-note-action': 'wfNoteAction',
  'on-note-created': 'wfNoteCreated',
  'on-call-recording-created': 'wfCallRecording',
  'on-inbound-webhook': 'wfWebhook',
  'on-manual-run': 'wfManualRun',
  'on-recurring-schedule': 'wfSchedule',
  'on-activity-created': 'wfActivity',
  'on-activity-updated': 'wfActivity',
  'run-custom-ai-agent': 'wfAgent',
  'research-entity': 'wfWebAgent',
  'classify-entity': 'wfClassifyRecord',
  'classify-text': 'wfClassifyText',
  'summarize-entity': 'wfSummarize',
  'create-record': 'wfCreateRecord',
  'assert-record': 'wfAssertRecord',
  'update-record': 'wfRecordUpdated',
  'find-records': 'wfFindRecords',
  'create-list-entry': 'wfEntryCreated',
  'update-list-entry': 'wfEntryUpdated',
  'delete-list-entry': 'wfDeleteEntry',
  'find-list-entries': 'wfFindEntries',
  'enroll-in-sequence': 'wfEnroll',
  'exit-from-sequence': 'wfExit',
  'complete-task': 'wfCompleteTask',
  'create-task': 'wfCreateTask',
  'find-tasks': 'wfFindTasks',
  'update-task': 'wfUpdateTask',
  'create-note': 'wfCreateNote',
  'link-record-to-meeting': 'wfLinkMeeting',
  'create-activity': 'wfActivity',
  'assert-activity': 'wfActivity',
  'update-activity': 'wfActivity',
  'find-activities': 'wfActivity',
  'execute-code': 'wfCode',
  'query-particle-sql': 'wfSql',
  formula: 'wfFormula',
  'adjust-timestamp': 'wfAdjustTime',
  'aggregate-values': 'wfAggregate',
  'generate-random-number': 'wfRandom',
  guard: 'wfFilter',
  branch: 'wfIf',
  switch: 'wfSwitch',
  delay: 'wfDelay',
  'delay-until': 'wfDelayUntil',
  'round-robin': 'wfRoundRobin',
  'send-workspace-celebration': 'wfCelebration',
  'send-workspace-toast': 'wfBroadcast',
  'for-each': 'wfLoop',
  'parse-json': 'wfParseJson',
  'send-http-request': 'wfHttp',
  'send-notification': 'notifications',
  'send-request': 'notifications',
  'internal-everything-bagel': 'wfInternal',
  'internal-noop': 'wfInternal',
  repeat: 'wfLoop',
};

/** Glyph colours per category (the tile background is the same hue at low alpha). */
export const CATEGORY_HUE: Record<BlockCategory, string> = {
  agents: '#c43ad6',
  ai: '#5c5e63',
  records: '#266df0',
  lists: '#0e9fb5',
  sequences: '#4f5bd5',
  data: '#02ad6e',
  tasks: '#0b8fd6',
  notes: '#d97706',
  meetings: '#6d5ef5',
  activities: '#5c5e63',
  calculations: '#02ad6e',
  conditions: '#9b51e0',
  delays: '#e8710a',
  workspace: '#e0457b',
  utilities: '#c98a00',
  notifications: '#eb3b3b',
  misc: '#5c5e63',
  internal: '#5c5e63',
};

export interface BlockLook {
  icon: IconName;
  hue: string;
  title: string;
  categoryLabel: string;
}

export function blockLook(slug: string): BlockLook {
  const def = blockDefinition(slug);
  const category = def?.category ?? 'misc';
  return {
    icon: ICONS[slug] ?? 'workflows',
    hue: CATEGORY_HUE[category],
    title: def?.title ?? slug,
    categoryLabel: BLOCK_CATEGORY_LABELS[category],
  };
}

export interface PaletteGroup {
  category: BlockCategory;
  label: string;
  blocks: BlockDefinition[];
}

export type PaletteFilter = 'all' | 'triggers' | 'steps';

/**
 * Palette groups (README §2.3): categories in enum order, triggers before steps inside a category; flag-gated and
 * internal blocks are hidden. `query` matches titles and keywords (case-insensitive).
 */
export function paletteGroups(
  catalog: { triggers: BlockDefinition[]; steps: BlockDefinition[] },
  filter: PaletteFilter,
  query = '',
): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const pool = [
    ...(filter === 'steps' ? [] : catalog.triggers),
    ...(filter === 'triggers' ? [] : catalog.steps),
  ].filter((d) => d.inPalette);
  const matches = (d: BlockDefinition) =>
    !q ||
    d.title.toLowerCase().includes(q) ||
    d.keywords.some((k) => k.toLowerCase().includes(q)) ||
    BLOCK_CATEGORY_LABELS[d.category].toLowerCase().includes(q);
  return blockCategories
    .map((category) => ({
      category,
      label: BLOCK_CATEGORY_LABELS[category],
      blocks: pool.filter((d) => d.category === category && matches(d)),
    }))
    .filter((g) => g.blocks.length > 0);
}

/** Workflow tile colours (index rows, overview): a stable hue per workflow id. */
const WORKFLOW_HUES = ['#e0457b', '#c98a00', '#9b51e0', '#266df0', '#02ad6e', '#0e9fb5', '#e8710a', '#6d5ef5'];

export function workflowHue(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return WORKFLOW_HUES[h % WORKFLOW_HUES.length] as string;
}
