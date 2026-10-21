// Record header: avatar (company squircle, person circle, object tile), the title as a ghost
// button that renames inline (Enter saves, Esc cancels; people get First / Last fields), "Edit record" and the
// favorite star; below, the layout's action buttons — as many with labels as fit, the rest icon-only with tooltips.
import type { LayoutElement } from '@agentic-crm/contracts';
import { IconButton, type IconName, toast } from '@agentic-crm/ui';
import { type KeyboardEvent, useState } from 'react';
import { ReadOnlyBadge } from '../../access/ReadOnlyBadge';
import { useEntityAccess } from '../../access/useEntityAccess';
import { RecordAvatar, useAttributeValues, useAttributeWrite } from '../../attributes';
import { recordKind } from '../../attributes/ui/primitives';
import { read } from '../../attributes/values/shapes';
import { RunWorkflowDialog, type RunWorkflowTarget } from '../../workflows/run-dialog/RunWorkflowDialog';
import { FavoriteStar, useComposeEmail, useNewNote, useNewTask } from '../adapters';
import { type RecordRef, useRecordPage } from '../context';
import { useRecordTitleText } from '../title';
import { type FittedAction, FittedActions } from '../ui/FittedActions';
import * as s from './details.css';

const ACTIONS: Partial<Record<LayoutElement['type'], { label: string; icon: IconName }>> = {
  'email-action': { label: 'Compose email', icon: 'emails' },
  'list-action': { label: 'Add to list', icon: 'listAdd' },
  'note-action': { label: 'New note', icon: 'noteTab' },
  'workflow-action': { label: 'Run workflow', icon: 'workflows' },
  'task-action': { label: 'New task', icon: 'tasks' },
  'sequence-action': { label: 'Enroll in sequence', icon: 'sequences' },
};

export function RecordHeader() {
  const { recordRef, layout } = useRecordPage();
  const actions = layout.actions.filter((a) => ACTIONS[a.type]);
  return (
    <div className={s.header} data-testid="record-header">
      <TitleRow />
      {actions.length > 0 && <ActionButtons actions={actions} recordRef={recordRef} />}
    </div>
  );
}

function TitleRow() {
  const { object, recordRef, titleAttribute, openDialog } = useRecordPage();
  const title = useRecordTitleText();
  const [renaming, setRenaming] = useState(false);
  const access = useEntityAccess(recordRef.entityDefinitionId);
  const canRename = Boolean(titleAttribute && !titleAttribute.isReadOnly) && access.canEditValues;
  return (
    <div className={s.titleRow}>
      <span className={s.avatar}>
        <RecordAvatar kind={recordKind(object)} size={32} />
      </span>
      {renaming && titleAttribute ? (
        <RenameField onDone={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          className={s.titleButton}
          data-readonly={canRename ? undefined : ''}
          data-testid="record-title"
          title={title.text}
          onClick={() => canRename && setRenaming(true)}
        >
          <span className={s.titleText}>{title.text}</span>
        </button>
      )}
      {!renaming && <span className={s.titleSpacer} />}
      {access.isReadOnly && <ReadOnlyBadge what={object.pluralNoun.toLowerCase()} />}
      {access.canEditValues && (
        <IconButton
          icon="edit"
          variant="ghost"
          size={28}
          aria-label="Edit record"
          tooltip="Edit record"
          onPress={() => openDialog('edit')}
        />
      )}
      <FavoriteStar
        favoriteType="record"
        targetId={recordRef.entityInstanceId}
        entityDefinitionId={recordRef.entityDefinitionId}
        size={28}
      />
      {/* keeps the object noun reachable for screen readers next to the title */}
      <span hidden>{object.singularNoun}</span>
    </div>
  );
}

/** Inline rename (D): a text box with "Enter {noun} name..." or First / Last name fields for people. */
function RenameField({ onDone }: { onDone: () => void }) {
  const { object, recordRef, titleAttribute } = useRecordPage();
  const attribute = titleAttribute as NonNullable<typeof titleAttribute>;
  const { values } = useAttributeValues(recordRef, attribute);
  const write = useAttributeWrite(recordRef, attribute);
  const current = values[0]?.value;
  const isName = attribute.type === 'personal-name';
  const name = isName ? read.name(current) : undefined;
  const [textValue, setTextValue] = useState(typeof current === 'string' ? current : '');
  const [first, setFirst] = useState(name?.firstName ?? '');
  const [last, setLast] = useState(name?.lastName ?? '');
  const noun = object.entityType === 'company-record' ? 'company' : object.singularNoun.toLowerCase();

  const save = () => {
    if (isName) {
      const f = first.trim();
      const l = last.trim();
      if (f !== (name?.firstName ?? '') || l !== (name?.lastName ?? '')) {
        write(f || l ? [{ value: { firstName: f, lastName: l, fullName: `${f} ${l}`.trim() } }] : []);
      }
    } else {
      const t = textValue.trim();
      if (t !== (typeof current === 'string' ? current : '')) write(t ? [{ value: t }] : []);
    }
    onDone();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    }
  };
  if (isName) {
    return (
      <div
        className={s.renameNames}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) save();
        }}
      >
        <input
          className={s.renameInput}
          autoFocus
          aria-label="First name"
          placeholder="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <input
          className={s.renameInput}
          aria-label="Last name"
          placeholder="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }
  return (
    <input
      className={s.renameInput}
      autoFocus
      aria-label={`${object.singularNoun} name`}
      placeholder={`Enter ${noun} name...`}
      value={textValue}
      onChange={(e) => setTextValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={save}
    />
  );
}

function ActionButtons({ actions, recordRef }: { actions: LayoutElement[]; recordRef: RecordRef }) {
  const { openDialog, object } = useRecordPage();
  const newNote = useNewNote();
  const newTask = useNewTask();
  const compose = useComposeEmail();
  const [runTarget, setRunTarget] = useState<RunWorkflowTarget | null>(null);
  const run = (type: LayoutElement['type']) => {
    switch (type) {
      case 'email-action':
        compose();
        return;
      case 'list-action':
        openDialog('choose-list');
        return;
      case 'note-action':
        newNote(recordRef);
        return;
      case 'task-action':
        newTask(recordRef);
        return;
      case 'workflow-action':
        setRunTarget({
          kind: 'record',
          entityDefinitionId: recordRef.entityDefinitionId,
          ids: [recordRef.entityInstanceId],
          groupLabel: object.singularNoun,
        });
        return;
      case 'sequence-action':
        toast({ title: 'Enroll in sequence', description: 'Sequences arrive with email.' });
        return;
      default:
        return;
    }
  };
  const items: FittedAction[] = actionItems(actions).map((a) => ({ ...a, onPress: () => run(a.type) }));
  return (
    <>
      <FittedActions actions={items} testId="record-actions" />
      <RunWorkflowDialog target={runTarget} onClose={() => setRunTarget(null)} />
    </>
  );
}

/** Labels and icons of the layout's header actions, in layout order (D table). */
export function actionItems(actions: readonly LayoutElement[]): (FittedAction & { type: LayoutElement['type'] })[] {
  return actions.flatMap((a) => {
    const meta = ACTIONS[a.type];
    return meta ? [{ id: a.elementId, type: a.type, ...meta }] : [];
  });
}
