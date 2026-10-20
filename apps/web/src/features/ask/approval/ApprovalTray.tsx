// Approval tray (ask-agentic §8, internals §4.3): while a turn has write tools (or a web search) waiting, the composer is
// replaced by a card for the first of them — an editable input for create / update task, record and note, a permission
// card for web search, a generic Deny / Allow card for any other tool. ⌘↵ takes the primary action. Several waiting
// calls are paged with ‹ n/m ›.
import type { AiToolPart, AiTurn } from '@agentic-crm/contracts';
import { Button, Icon, IconButton, Menu, MenuItem, MenuTrigger, Popover } from '@agentic-crm/ui';
import { useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useObjects } from '../../../data/objects';
import { useMembers, useRecordTitle } from '../../attributes/data/queries';
import { MemberAvatar } from '../../attributes/ui/primitives';
import { useWorkspace } from '../../shell/workspaceContext';
import { useAction } from '../../shortcuts/catalog';
import { allowWebSearch, approveTool, denyTool } from '../actions';
import { RecordPill } from '../markdown/RecordPill';
import { toolDetail, WRITE_VERBS } from '../thread/toolRows';
import * as s from './approval.css';
import {
  editedValue,
  type NoteDraft,
  noteDraftFrom,
  noteInputFrom,
  recordInputFrom,
  type TaskDraft,
  taskDraftFrom,
  taskInputFrom,
  type ValueRow,
  valueRowsOf,
  valueText,
} from './inputs';

export interface PendingApproval {
  turn: AiTurn;
  part: AiToolPart;
}

type CardProps = PendingApproval & {
  /** The card's actions, bound to ⌘↵ and the buttons. */
  busy: boolean;
  run: <T>(task: () => Promise<T>) => Promise<T>;
};

function formatDue(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y as number, (m as number) - 1, d as number);
  const sameYear = dt.getFullYear() === new Date().getFullYear();
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

// ---- frame ---------------------------------------------------------------------------------------------------------------------------

function Frame({
  title,
  description,
  pager,
  children,
  secondary,
  primary,
  note,
}: {
  title: string;
  description?: string;
  pager?: React.ReactNode;
  children?: React.ReactNode;
  secondary: React.ReactNode;
  primary: React.ReactNode;
  note?: string | null;
}) {
  return (
    <div className={s.card} role="group" aria-label={title} data-testid="ask-approval-card">
      <div className={s.header}>
        <span className={s.label}>{title}</span>
        {pager}
      </div>
      {description && <div className={s.description}>{description}</div>}
      {children}
      <div className={s.footer}>
        {note && <span className={s.footerNote}>{note}</span>}
        {secondary}
        {primary}
      </div>
    </div>
  );
}

function PrimaryButton({
  children,
  onPress,
  isDisabled,
  busy,
  testId,
}: {
  children: React.ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
  busy?: boolean;
  testId: string;
}) {
  return (
    <Button
      variant="primary"
      size={28}
      shortcut={['mod', 'enter']}
      isDisabled={isDisabled}
      isPending={busy}
      onPress={onPress}
      data-testid={testId}
    >
      {children}
    </Button>
  );
}

// ---- tasks ---------------------------------------------------------------------------------------------------------------------------

function TaskCard({ turn, part, busy, run, pager }: CardProps & { pager: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const members = useMembers();
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const update = part.tool === 'update-task';
  const [draft, setDraft] = useState<TaskDraft>(() => taskDraftFrom(part.input, timeZone));
  const empty = draft.body.trim() === '';
  const assigned = draft.assignees.map((id) => members.find((m) => m.id === id)).filter((m) => Boolean(m));
  const submit = () => {
    if (empty || busy) return;
    void run(() => approveTool(ws, turn, part, taskInputFrom(part.input, draft)));
  };
  useAction('dialog-save', submit);
  return (
    <Frame
      title={update ? 'Update task' : 'Create task'}
      pager={pager}
      secondary={
        <Button
          variant="ghost"
          size={28}
          onPress={() => void run(() => denyTool(ws, turn, part))}
          data-testid="ask-approval-discard"
        >
          Discard
        </Button>
      }
      primary={
        <PrimaryButton onPress={submit} isDisabled={empty} busy={busy} testId="ask-approval-approve">
          {update ? 'Update' : 'Create'}
        </PrimaryButton>
      }
    >
      <textarea
        className={s.field}
        rows={1}
        value={draft.body}
        aria-label="Task title"
        data-testid="ask-approval-title"
        autoFocus
        onChange={(e) => setDraft({ ...draft, body: e.target.value.replace(/\n/g, ' ') })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault();
        }}
      />
      <div className={s.chips}>
        <MenuTrigger>
          <AriaButton className={s.chip} aria-label="Assignees" data-testid="ask-approval-assignees">
            {assigned.length > 0 ? (
              assigned.map((m) => (
                <span key={m?.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <MemberAvatar member={m} size={16} />
                  {m?.id === workspace.membership.id ? 'You' : `${m?.firstName ?? ''} ${m?.lastName ?? ''}`.trim()}
                </span>
              ))
            ) : (
              <>
                <Icon icon="person" size={12} /> Assignee
              </>
            )}
          </AriaButton>
          <Menu
            width={240}
            aria-label="Assignees"
            selectionMode="multiple"
            selectedKeys={draft.assignees}
            onSelectionChange={(keys) => setDraft({ ...draft, assignees: [...(keys as Set<string>)].map(String) })}
          >
            {members.map((m) => (
              <MenuItem key={m.id} id={m.id} icon={<MemberAvatar member={m} size={16} />}>
                {`${m.firstName ?? ''} ${m.lastName ?? ''}`.trim() || m.emailAddress}
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
        <Popover
          placement="top start"
          aria-label="Due date"
          trigger={
            <AriaButton className={s.chip} aria-label="Due date" data-testid="ask-approval-due">
              <Icon icon="calendarDays" size={12} />
              {draft.due ? formatDue(draft.due) : 'Due date'}
            </AriaButton>
          }
        >
          {({ close }) => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
              <input
                type="date"
                className={s.dateInput}
                aria-label="Due date"
                value={draft.due ?? ''}
                onChange={(e) => setDraft({ ...draft, due: e.target.value || null })}
              />
              <Button
                variant="secondary"
                size={28}
                onPress={() => {
                  setDraft({ ...draft, due: null });
                  close();
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </Popover>
        {draft.linked.map((r) => (
          <span key={r.entityInstanceId} className={`${s.chip} ${s.chipStatic}`}>
            <RecordPill entityDefinitionId={r.entityDefinitionId} entityInstanceId={r.entityInstanceId} />
            <button
              type="button"
              className={s.chipRemove}
              aria-label="Remove linked record"
              onClick={() =>
                setDraft({ ...draft, linked: draft.linked.filter((x) => x.entityInstanceId !== r.entityInstanceId) })
              }
            >
              <Icon icon="close" size={12} />
            </button>
          </span>
        ))}
      </div>
    </Frame>
  );
}

// ---- records -------------------------------------------------------------------------------------------------------------------------

function RecordCard({ turn, part, busy, run, pager }: CardProps & { pager: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const objects = useObjects(workspace).data ?? [];
  const update = part.tool === 'update-record';
  const input = (part.input ?? {}) as { object?: string; record_id?: string };
  const needle = String(input.object ?? '').toLowerCase();
  const def = objects.find(
    (o) =>
      o.id === input.object ||
      o.apiSlug.toLowerCase() === needle ||
      o.singularNoun.toLowerCase() === needle ||
      o.pluralNoun.toLowerCase() === needle,
  );
  const target = useRecordTitle(def?.id ?? '', update ? (input.record_id ?? '') : '');
  const [rows, setRows] = useState<ValueRow[]>(() => valueRowsOf(part.input));
  const total = valueRowsOf(part.input).length;
  const empty = rows.length === 0;
  const submit = () => {
    if (empty || busy) return;
    void run(() => approveTool(ws, turn, part, recordInputFrom(part.input, rows)));
  };
  useAction('dialog-save', submit);
  const title = update
    ? `Update ${target.title || def?.singularNoun?.toLowerCase() || 'record'}`
    : `Create ${def?.singularNoun?.toLowerCase() ?? 'record'}`;
  return (
    <Frame
      title={title}
      pager={pager}
      note={empty ? `Please select at least one attribute to ${update ? 'update' : 'create'} the record` : null}
      secondary={
        <Button
          variant="ghost"
          size={28}
          onPress={() => void run(() => denyTool(ws, turn, part))}
          data-testid="ask-approval-discard"
        >
          {update && rows.length === total && total > 1 ? 'Discard all' : 'Discard'}
        </Button>
      }
      primary={
        <PrimaryButton onPress={submit} isDisabled={empty} busy={busy} testId="ask-approval-approve">
          {update ? `Update (${rows.length})` : 'Create'}
        </PrimaryButton>
      }
    >
      <div className={s.rows} data-testid="ask-approval-rows">
        {rows.map((r) => (
          <div key={r.key} className={s.row} data-testid="ask-approval-row">
            <span className={s.rowKey}>{r.key}</span>
            {r.editable ? (
              <input
                className={s.rowInput}
                aria-label={r.key}
                value={String(r.value)}
                onChange={(e) =>
                  setRows(
                    rows.map((x) => (x.key === r.key ? { ...x, value: editedValue(r.value, e.target.value) } : x)),
                  )
                }
              />
            ) : (
              <span className={s.rowValue}>{valueText(r.value)}</span>
            )}
            <IconButton
              icon="close"
              size={20}
              aria-label={`Remove ${r.key}`}
              onPress={() => setRows(rows.filter((x) => x.key !== r.key))}
            />
          </div>
        ))}
      </div>
    </Frame>
  );
}

// ---- notes ---------------------------------------------------------------------------------------------------------------------------

function NoteCard({ turn, part, busy, run, pager }: CardProps & { pager: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const [draft, setDraft] = useState<NoteDraft>(() => noteDraftFrom(part.input));
  const submit = () => {
    if (busy) return;
    void run(() => approveTool(ws, turn, part, noteInputFrom(part.input, draft)));
  };
  useAction('dialog-save', submit);
  return (
    <Frame
      title="Create note"
      pager={pager}
      secondary={
        <Button
          variant="ghost"
          size={28}
          onPress={() => void run(() => denyTool(ws, turn, part))}
          data-testid="ask-approval-discard"
        >
          Discard
        </Button>
      }
      primary={
        <PrimaryButton onPress={submit} busy={busy} testId="ask-approval-approve">
          Create
        </PrimaryButton>
      }
    >
      <input
        className={s.field}
        value={draft.title}
        placeholder="Untitled note"
        aria-label="Note title"
        autoFocus
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <textarea
        className={`${s.field} ${s.textarea}`}
        value={draft.content}
        aria-label="Note content"
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
      />
      {draft.parent && (
        <div className={s.chips}>
          <span className={`${s.chip} ${s.chipStatic}`}>
            <RecordPill
              entityDefinitionId={draft.parent.entityDefinitionId}
              entityInstanceId={draft.parent.entityInstanceId}
            />
          </span>
        </div>
      )}
    </Frame>
  );
}

// ---- web search and unknown tools -----------------------------------------------------------------------------------------------

function WebSearchCard({ turn, part, busy, run, pager }: CardProps & { pager: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const query = toolDetail(part)?.replace(/^"|"$/g, '') ?? '';
  const allow = () => void run(() => allowWebSearch(ws, turn, false));
  useAction('dialog-save', allow);
  return (
    <Frame
      title="Search web"
      pager={pager}
      secondary={
        <>
          <Button
            variant="ghost"
            size={28}
            onPress={() => void run(() => denyTool(ws, turn, part))}
            data-testid="ask-approval-deny"
          >
            Deny
          </Button>
          <Button
            variant="secondary"
            size={28}
            isDisabled={busy}
            onPress={() => void run(() => allowWebSearch(ws, turn, true))}
            data-testid="ask-approval-always"
          >
            Always allow
          </Button>
        </>
      }
      primary={
        <PrimaryButton onPress={allow} busy={busy} testId="ask-approval-allow">
          Allow
        </PrimaryButton>
      }
    >
      <div>
        <span className={s.labelStrong}>Search web: </span>
        <span className={s.labelStrong} style={{ fontWeight: 400, color: 'inherit' }}>
          {query}
        </span>
      </div>
      <div className={s.description}>Do you want to allow Ask AI to search the web for this information?</div>
    </Frame>
  );
}

function GenericCard({ turn, part, busy, run, pager }: CardProps & { pager: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const ws = useMemo(() => ({ id: workspace.id, slug: workspace.slug }), [workspace.id, workspace.slug]);
  const broken = part.input === null || part.input === undefined;
  const allow = () => {
    if (!broken) void run(() => approveTool(ws, turn, part));
  };
  useAction('dialog-save', allow);
  if (broken) {
    return (
      <Frame
        title="This action couldn't be generated."
        pager={pager}
        secondary={null}
        primary={
          <Button variant="secondary" size={28} onPress={() => void run(() => denyTool(ws, turn, part))}>
            Skip
          </Button>
        }
      />
    );
  }
  return (
    <Frame
      title={WRITE_VERBS[part.tool] ?? 'Approve tool'}
      description="Do you want to allow Ask AI to call this tool?"
      pager={pager}
      secondary={
        <Button variant="ghost" size={28} onPress={() => void run(() => denyTool(ws, turn, part))}>
          Deny
        </Button>
      }
      primary={
        <PrimaryButton onPress={allow} busy={busy} testId="ask-approval-allow">
          Allow
        </PrimaryButton>
      }
    >
      <pre className={s.code}>{JSON.stringify(part.input, null, 2)}</pre>
    </Frame>
  );
}

// ---- tray -------------------------------------------------------------------------------------------------------------------------------

export function ApprovalTray({ items }: { items: PendingApproval[] }) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const current = items[Math.min(index, items.length - 1)];
  if (!current) return null;
  const run = async <T,>(task: () => Promise<T>): Promise<T> => {
    if (busyRef.current) return undefined as T;
    busyRef.current = true;
    setBusy(true);
    try {
      return await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const pager =
    items.length > 1 ? (
      <span className={s.pager}>
        <IconButton
          icon="chevronLeft"
          size={20}
          aria-label="Previous"
          isDisabled={index === 0}
          onPress={() => setIndex(index - 1)}
        />
        {Math.min(index, items.length - 1) + 1}/{items.length}
        <IconButton
          icon="chevronRight"
          size={20}
          aria-label="Next"
          isDisabled={index >= items.length - 1}
          onPress={() => setIndex(index + 1)}
        />
      </span>
    ) : null;
  const props = { ...current, busy, run, pager };
  const key = current.part.toolCallId;
  switch (current.part.tool) {
    case 'create-task':
    case 'update-task':
      return <TaskCard key={key} {...props} />;
    case 'create-record':
    case 'update-record':
      return <RecordCard key={key} {...props} />;
    case 'create-note':
      return <NoteCard key={key} {...props} />;
    case 'search-web':
      return <WebSearchCard key={key} {...props} />;
    default:
      return <GenericCard key={key} {...props} />;
  }
}
