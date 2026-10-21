// One attribute of the details panel: label (type icon + title) and the value drawn by the
// attribute registry in `field` density. Click edits in place (the registry's editor anchored to the value), a
// checkbox / rating toggles in place, record chips navigate. A spinner "Validating change" shows while a write of
// this attribute is queued or in flight. Right-click: Copy · Paste · View edit history · Clear value.

import type { AttributeDefinition } from '@agentic-crm/contracts';
import { ContextMenu, Icon, MenuItem, MenuSeparator, Skeleton, Spinner, Tooltip, toast } from '@agentic-crm/ui';
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEntityAccess } from '../../access/useEntityAccess';
import { AnnotatedValue, AttributeKindMarker, RunAiAction, useAiRunDialog } from '../../ai-attributes';
import {
  type CommitInput,
  type CommitMeta,
  getAttributeUi,
  isAttributeEditable,
  setPlaceholder,
  useAttributeEnv,
  useAttributeValues,
  useAttributeWrite,
  ValueHistoryPopover,
} from '../../attributes';
import { attributeIcon } from '../../settings/objects/attributes/typeCatalog';
import type { RecordRef } from '../context';
import * as s from './details.css';

/** In-place interactions of the value itself (checkbox toggles, rating stars). */
const IN_PLACE = new Set(['checkbox', 'rating']);

export interface AttributeRowProps {
  attribute: AttributeDefinition;
  recordRef: RecordRef;
  /** Edit record modal: label above a bordered box ("Title (optional)"). */
  variant?: 'row' | 'form';
  /** Called when a write of this attribute has settled (the page refreshes its activity). */
  onSettled?: () => void;
}

export function AttributeRow({ attribute, recordRef, variant = 'row', onSettled }: AttributeRowProps) {
  const ui = getAttributeUi(attribute.type);
  const { values, isPending, isHeld, isLoading } = useAttributeValues(recordRef, attribute);
  const write = useAttributeWrite(recordRef, attribute);
  const access = useEntityAccess(recordRef.entityDefinitionId);
  const { workspace } = useAttributeEnv();
  const aiRun = useAiRunDialog(workspace);
  const aiEnabled = Boolean(attribute.aiAutofillConfiguration?.isEnabled);
  const editable = isAttributeEditable(attribute) && access.canEditValues;
  const inPlace = IN_PLACE.has(attribute.type);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [history, setHistory] = useState(false);
  const valueRef = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending) onSettled?.();
    wasPending.current = isPending;
  }, [isPending, onSettled]);

  const commit = useCallback(
    (next: CommitInput, meta?: CommitMeta) => {
      if (!sameValues(next, values)) write(next, meta);
      if (meta?.keepOpen) return;
      done.current = true;
      setEditing(false);
      requestAnimationFrame(() => valueRef.current?.focus({ preventScroll: true }));
    },
    [write, values],
  );
  const cancel = useCallback(() => {
    done.current = true;
    setEditing(false);
  }, []);

  const startEditing = () => {
    if (!editable || inPlace || editing) return;
    done.current = false;
    setEditing(true);
  };

  const onValueClick = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    // Links inside the value (record chips, emails, domains) keep their own behaviour.
    if ((e.target as HTMLElement).closest('a')) return;
    startEditing();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      startEditing();
    }
  };

  const copy = async () => {
    const textValue = ui.copyText(values, attribute);
    try {
      await navigator.clipboard.writeText(textValue);
      toast({ title: 'Copied to clipboard!', icon: 'copy' });
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const paste = async () => {
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      toast.error('You have denied access to your clipboard');
      return;
    }
    const next = ui.pasteValue?.(clip, attribute) ?? null;
    if (!next) {
      toast.error(`Invalid value for ${attribute.title}`);
      return;
    }
    write(next);
  };

  const { View, Editor } = ui;
  // In the Edit record modal, text-like editors render in place: an overlay portalled to <body> would sit outside
  // the modal's focus scope and lose focus at once.
  const inForm = variant === 'form' && ui.editorKind === 'inline';
  const placeholder = setPlaceholder(attribute.title);
  const view = isLoading ? (
    <div className={s.valueSkeleton}>
      <Skeleton width={96} height={12} />
    </div>
  ) : (
    // Formula / AI values: "Calculating...", "AI is thinking...", errors (features/ai-attributes).
    <AnnotatedValue
      workspace={workspace}
      attribute={attribute}
      recordId={recordRef.entityInstanceId}
      hasValue={values.length > 0}
      density="field"
    >
      <View
        attribute={attribute}
        values={values}
        density="field"
        recordRef={recordRef}
        placeholder={editable ? placeholder : undefined}
        onCommit={inPlace && editable ? (next, meta) => commit(next, { ...meta, keepOpen: true }) : undefined}
      />
    </AnnotatedValue>
  );

  const valueBox = (
    <div
      ref={valueRef}
      className={variant === 'form' ? s.editBox : s.value}
      role="button"
      tabIndex={0}
      aria-label={`${attribute.title} value`}
      data-readonly={!editable || inPlace ? '' : undefined}
      data-editing={editing ? '' : undefined}
      data-testid="attribute-value"
      onClick={onValueClick}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {view}
      {isHeld && (
        <span className={s.pending} data-testid="held-change">
          <Tooltip content="Updates required: this change is on hold">
            <span>
              <Icon icon="warning" size={12} color="warning" />
            </span>
          </Tooltip>
        </span>
      )}
      {aiEnabled && access.canEditValues && variant === 'row' && (
        <RunAiAction
          onRun={() => aiRun.open(attribute, { type: 'records', entityInstanceIds: [recordRef.entityInstanceId] })}
        />
      )}
      {isPending && (
        <span className={s.pending} data-testid="validating-change">
          <Tooltip content="Validating change">
            <span>
              <Spinner size={12} />
            </span>
          </Tooltip>
        </span>
      )}
    </div>
  );

  return (
    <>
      {variant === 'form' ? (
        <div className={s.editField} data-attribute={attribute.apiSlug}>
          <span className={s.editLabel}>
            {attribute.title} {attribute.isRequired ? '(required)' : '(optional)'}
          </span>
          {editing && inForm ? (
            <Editor
              attribute={attribute}
              values={values}
              density="field"
              recordRef={recordRef}
              onCommit={commit}
              onCancel={cancel}
              liveCommit
            />
          ) : (
            valueBox
          )}
        </div>
      ) : (
        <div className={s.row} data-attribute={attribute.apiSlug} data-testid="attribute-row">
          <div className={s.label} title={attribute.title}>
            {/* Formula attributes show their output type's icon and an fx marker. */}
            <Icon
              icon={attributeIcon({ ...attribute, formulaConfiguration: null })}
              size={16}
              className={s.labelIcon}
            />
            <span className={s.labelText}>{attribute.title}</span>
            <AttributeKindMarker attribute={attribute} />
          </div>
          {valueBox}
        </div>
      )}
      {editing && !inForm && valueRef.current && (
        <Editor
          attribute={attribute}
          values={values}
          anchor={valueRef.current}
          density="field"
          recordRef={recordRef}
          onCommit={commit}
          onCancel={cancel}
          liveCommit
        />
      )}
      {menu && (
        <ContextMenu
          aria-label="Value actions"
          isOpen
          onOpenChange={(open) => !open && setMenu(null)}
          x={menu.x}
          y={menu.y}
          width={228}
          onAction={(key) => {
            setMenu(null);
            if (key === 'copy') void copy();
            else if (key === 'paste') void paste();
            else if (key === 'history') setHistory(true);
            else if (key === 'clear') write([]);
          }}
        >
          <MenuItem id="copy" icon="copy">
            Copy
          </MenuItem>
          <MenuItem id="paste" icon="paste" isDisabled={!editable}>
            Paste
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="history" icon="history">
            View edit history
          </MenuItem>
          <MenuSeparator />
          <MenuItem id="clear" icon="close" variant="danger" isDisabled={!editable || values.length === 0}>
            Clear value
          </MenuItem>
        </ContextMenu>
      )}
      {aiRun.dialog}
      {history && valueRef.current && (
        <ValueHistoryPopover
          recordRef={recordRef}
          attribute={attribute}
          anchor={valueRef.current}
          onClose={() => setHistory(false)}
        />
      )}
    </>
  );
}

/** Unchanged commits (Enter without typing) write nothing. */
function sameValues(next: CommitInput, current: readonly { value: unknown }[]): boolean {
  if (next.length !== current.length) return false;
  return next.every((n, i) => {
    if ('op' in n) return false;
    return JSON.stringify(n.value) === JSON.stringify(current[i]?.value);
  });
}

/** Attribute rows of a section: memoised list helper. */
export function useAttributeById(attributes: readonly AttributeDefinition[]) {
  return useMemo(() => new Map(attributes.map((a) => [a.id, a])), [attributes]);
}
