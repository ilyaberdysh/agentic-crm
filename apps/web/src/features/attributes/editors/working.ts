// The working set of a multi-value editor. With `liveCommit` every toggle is written at once (`onCommit(ops,
// {keepOpen: true})`, the behaviour); otherwise toggles change a local set that is shown, broadcast as the draft
// (`onDraftChange`) and committed once when the editor closes — Escape included, since toggles read as done.
import { useRef, useState } from 'react';
import { newId } from '../../../lib/ids';
import type { AttributeValue, CommitInput, CommitVia, EditorProps, ValueInput } from '../types';
import { currentValues, toWriteForm } from '../values/shapes';
import { planCommit } from '../write/plan';

export function toInputs(rows: AttributeValue[], type: AttributeValue['attributeType']): ValueInput[] {
  return rows.map((r) => ({
    id: r.id,
    value: toWriteForm(type, r.value),
    ...(r.sortOrder ? { sortOrder: r.sortOrder } : {}),
  }));
}

export interface WorkingValues {
  /** Values to display (the working set, or the host's values). */
  shown: AttributeValue[];
  apply: (next: CommitInput, via?: CommitVia) => void;
  /** Close: commits the working set when it changed, otherwise cancels. `extra` is applied first. */
  finish: (via: CommitVia, extra?: CommitInput) => void;
}

export function useWorkingValues(props: EditorProps): WorkingValues {
  const { attribute, values, onCommit, onCancel, onDraftChange, liveCommit } = props;
  const [working, setWorking] = useState<AttributeValue[] | null>(null);
  const workingRef = useRef<AttributeValue[] | null>(null);
  const done = useRef(false);
  const shown = working ?? currentValues(values);

  const plan = (base: AttributeValue[], next: CommitInput) =>
    planCommit(attribute, base, next, {
      recordRef: {
        workspace: { id: attribute.workspaceId },
        entityDefinitionId: attribute.entityDefinitionId,
        entityInstanceId: values[0]?.entityInstanceId ?? '',
      },
      newId,
    }).optimistic;

  const apply = (next: CommitInput, via: CommitVia = 'pick') => {
    if (done.current) return;
    if (liveCommit) {
      onCommit(next, { via, keepOpen: true });
      return;
    }
    const rows = plan(workingRef.current ?? currentValues(values), next);
    workingRef.current = rows;
    setWorking(rows);
    onDraftChange?.(toInputs(rows, attribute.type));
  };

  const finish = (via: CommitVia, extra?: CommitInput) => {
    if (done.current) return;
    done.current = true;
    let rows = workingRef.current;
    if (extra) {
      if (liveCommit) {
        onCommit(extra, { via });
        return;
      }
      rows = plan(rows ?? currentValues(values), extra);
    }
    if (!liveCommit && rows) {
      const before = currentValues(values).map((v) => `${v.id}:${v.sortOrder ?? ''}`);
      const after = rows.map((v) => `${v.id}:${v.sortOrder ?? ''}`);
      if (before.join('|') !== after.join('|')) {
        onCommit(toInputs(rows, attribute.type), { via });
        return;
      }
    }
    onCancel({ via });
  };

  return { shown, apply, finish };
}
