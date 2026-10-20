// Tool inputs of the write tools as the approval cards edit them (packages/domain ai/tools/catalog.ts): the model's
// call is parsed into a draft the card edits, and the draft is written back as the `input` sent with approve.
// Everything the card does not edit is carried over unchanged.

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

export interface RecordRefDraft {
  entityDefinitionId: string;
  entityInstanceId: string;
}

function refsOf(v: unknown): RecordRefDraft[] {
  return (Array.isArray(v) ? v : []).flatMap((r) => {
    const o = obj(r);
    return typeof o.entity_definition_id === 'string' && typeof o.entity_instance_id === 'string'
      ? [{ entityDefinitionId: o.entity_definition_id, entityInstanceId: o.entity_instance_id }]
      : [];
  });
}

// ---- tasks ------------------------------------------------------------------------------------------------------------------------

export interface TaskDraft {
  body: string;
  /** `YYYY-MM-DD` (the card edits dates) or null. */
  due: string | null;
  assignees: string[];
  linked: RecordRefDraft[];
}

/** `YYYY-MM-DD` of a model-provided due date (a date or an ISO timestamp, read in the given zone). */
export function dueDateOf(value: unknown, timeZone?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
}

export function taskDraftFrom(input: unknown, timeZone?: string): TaskDraft {
  const o = obj(input);
  return {
    body: typeof o.body === 'string' ? o.body : '',
    due: dueDateOf(o.due_date, timeZone),
    assignees: (Array.isArray(o.assignee_member_ids) ? o.assignee_member_ids : []).filter(
      (id): id is string => typeof id === 'string',
    ),
    linked: refsOf(o.linked_records),
  };
}

/** The input to approve with: the original call with the draft's edits applied. */
export function taskInputFrom(original: unknown, draft: TaskDraft): Obj {
  return {
    ...obj(original),
    body: draft.body.trim(),
    due_date: draft.due,
    assignee_member_ids: draft.assignees,
    linked_records: draft.linked.map((r) => ({
      entity_definition_id: r.entityDefinitionId,
      entity_instance_id: r.entityInstanceId,
    })),
  };
}

// ---- records ----------------------------------------------------------------------------------------------------------------------

export interface ValueRow {
  key: string;
  value: unknown;
  /** Text and numbers can be edited in the card; everything else is shown and kept or removed as a whole. */
  editable: boolean;
}

export function valueRowsOf(input: unknown): ValueRow[] {
  return Object.entries(obj(obj(input).values)).map(([key, value]) => ({
    key,
    value,
    editable: typeof value === 'string' || typeof value === 'number',
  }));
}

/** The input to approve with: the kept rows (edited values) replace `values`. */
export function recordInputFrom(original: unknown, rows: ValueRow[]): Obj {
  return { ...obj(original), values: Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

/** A value as one line of text for the diff rows. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined) return 'Empty';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  const o = obj(value);
  if (typeof o.entity_instance_id === 'string') return 'Linked record';
  return JSON.stringify(value);
}

/** Keeps a number a number when the edited text still reads as one. */
export function editedValue(previous: unknown, text: string): unknown {
  if (typeof previous === 'number') {
    const n = Number(text);
    return text.trim() !== '' && Number.isFinite(n) ? n : text;
  }
  return text;
}

// ---- notes --------------------------------------------------------------------------------------------------------------------------

export interface NoteDraft {
  title: string;
  content: string;
  parent: RecordRefDraft | null;
}

export function noteDraftFrom(input: unknown): NoteDraft {
  const o = obj(input);
  const [parent] = refsOf([o.parent_record]);
  return {
    title: typeof o.title === 'string' ? o.title : '',
    content: typeof o.content === 'string' ? o.content : '',
    parent: parent ?? null,
  };
}

export function noteInputFrom(original: unknown, draft: NoteDraft): Obj {
  return { ...obj(original), title: draft.title, content: draft.content };
}
