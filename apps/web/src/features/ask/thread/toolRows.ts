// Tool rows of the transcript (ask-agentic-internals §4.4): a 24 px row with an icon, a verb phrase (present tense while
// the call runs, past tense with the result count afterwards), the call's main argument muted, and a stack of the
// records it returned. Write tools waiting for approval read "Create task: <title>".
import { AI_TOOL_LABELS, type AiToolPart } from '@agentic-crm/contracts';
import type { IconName } from '@agentic-crm/ui';

const ICONS: Record<string, IconName> = {
  'search-records': 'search',
  'list-records': 'filter',
  'get-records': 'record',
  'list-attributes': 'columns',
  'list-lists': 'list',
  'list-list-entries': 'list',
  'list-tasks': 'tasks',
  'list-notes': 'notes',
  'get-notes': 'notes',
  'list-workspace-members': 'people',
  'search-meetings': 'meeting',
  'get-meeting': 'meeting',
  'get-call-recording': 'recording',
  'search-emails': 'emails',
  'get-emails': 'emails',
  'search-web': 'search',
  'create-record': 'add',
  'update-record': 'edit',
  'create-task': 'tasks',
  'update-task': 'tasks',
  'create-note': 'notes',
};

/** Write tools: the verb of the row and of the approval card title. */
export const WRITE_VERBS: Record<string, string> = {
  'create-record': 'Create record',
  'update-record': 'Update record',
  'create-task': 'Create task',
  'update-task': 'Update task',
  'create-note': 'Create note',
  'search-web': 'Search web',
};

export interface ToolRow {
  icon: IconName;
  label: string;
  /** Muted argument after the label (`"query"`, the task title). */
  detail: string | null;
  /** "3 results" */
  result: string | null;
  /** Records the call returned (avatar stack). */
  records: { entityDefinitionId: string; entityInstanceId: string }[];
  /** The label shimmers: the call is still being generated or executed. */
  active: boolean;
  tone: 'normal' | 'denied' | 'failed';
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The main argument of a call, for the muted part of the row. */
export function toolDetail(part: Pick<AiToolPart, 'tool' | 'input' | 'inputAmendment'>): string | null {
  const input = obj(part.inputAmendment ?? part.input);
  switch (part.tool) {
    case 'search-records':
    case 'search-emails':
      return str(input.query) ? `"${str(input.query)}"` : null;
    case 'search-web': {
      const queries = Array.isArray(input.search_queries) ? input.search_queries : [];
      const first = str(queries[0]) ?? str(input.objective);
      return first ? `"${first}"` : null;
    }
    case 'create-task':
    case 'update-task':
      return str(input.body);
    case 'create-note':
      return str(input.title);
    case 'create-record':
    case 'update-record':
      return str(input.object);
    case 'list-records':
      return str(input.object);
    default:
      return null;
  }
}

function digestCount(digest: Record<string, unknown> | null): number | null {
  const d = obj(digest);
  if (typeof d.count === 'number') return d.count;
  if (Array.isArray(d.results)) return d.results.length;
  return null;
}

function digestRecords(digest: Record<string, unknown> | null) {
  const records = obj(digest).records;
  if (!Array.isArray(records)) return [];
  return records.flatMap((r) => {
    const o = obj(r);
    return typeof o.entityDefinitionId === 'string' && typeof o.entityInstanceId === 'string'
      ? [{ entityDefinitionId: o.entityDefinitionId, entityInstanceId: o.entityInstanceId }]
      : [];
  });
}

export function toolRow(part: AiToolPart): ToolRow {
  const labels = AI_TOOL_LABELS[part.tool];
  const icon = ICONS[part.tool] ?? 'bot';
  const detail = toolDetail(part);
  const waiting = part.toolStatus === 'awaiting-approval';
  const terminal = part.toolStatus === 'completed';
  const denied = part.toolStatus === 'canceled';
  const failed = part.toolStatus === 'failed' || part.status === 'failed';
  const generating = part.status === 'streaming';

  if (waiting) {
    return {
      icon,
      label: WRITE_VERBS[part.tool] ?? labels?.running ?? part.tool,
      detail,
      result: null,
      records: [],
      active: false,
      tone: 'normal',
    };
  }
  if (denied) {
    return {
      icon,
      label: labels?.denied ?? 'Action discarded',
      detail: null,
      result: null,
      records: [],
      active: false,
      tone: 'denied',
    };
  }
  if (failed) {
    return {
      icon,
      label: `${labels?.running ?? part.tool} failed`,
      detail,
      result: null,
      records: [],
      active: false,
      tone: 'failed',
    };
  }
  if (terminal) {
    const count = digestCount(part.outputDigest);
    const write = labels?.write === true;
    return {
      icon,
      label: labels?.done ?? part.tool,
      detail: write ? detail : null,
      result: write || count === null ? null : `${count} ${count === 1 ? 'result' : 'results'}`,
      records: digestRecords(part.outputDigest),
      active: false,
      tone: 'normal',
    };
  }
  return {
    icon,
    label: labels?.running ?? part.tool,
    detail: generating ? null : detail,
    result: null,
    records: [],
    active: true,
    tone: 'normal',
  };
}

/** "7 tools used" / "1 tool used". */
export function toolsUsedLabel(count: number): string {
  return `${count} ${count === 1 ? 'tool' : 'tools'} used`;
}
