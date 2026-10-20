// Form state of the Add-to-list form (C2 §2.5 A.3): one field per writable list attribute, defaults and prefilled
// values (the stage of the kanban column you clicked) applied, typed text parsed like a paste on submit — the same
// controls and rules as the Create record dialog (features/attributes FieldControl), collected into a ValuesMap for
// `entries.add`. Entry creation sends every list attribute; unset ones are simply omitted here (the server stores
// no values for them).
import type { ValuesMap } from '@agentic-crm/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { newId } from '../../lib/ids';
import { useAttributeEnv } from '../attributes/data/env';
import { todayIso } from '../attributes/format/formatValue';
import { getFormatSettings } from '../attributes/format/locale';
import { defaultInputs, errorFor, TEXT_TYPES, textOfInput } from '../attributes/NewRecordDialog';
import type { AttributeDefinition, AttributeValue, CommitInput, CommitMeta, ValueInput } from '../attributes/types';
import { pasteValueOf } from '../attributes/values/clipboard';
import { currentValues, toWriteForm } from '../attributes/values/shapes';
import { planCommit } from '../attributes/write/plan';

export interface EntryFormState {
  entryId: string;
  rows: Record<string, AttributeValue[]>;
  texts: Record<string, string>;
}

export interface EntryForm {
  state: EntryFormState;
  errors: Record<string, string>;
  /** True once the user changed anything (discard guard). */
  dirty: boolean;
  commitTo: (attribute: AttributeDefinition) => (next: CommitInput, meta?: CommitMeta) => void;
  setText: (attribute: AttributeDefinition, text: string) => void;
  /** Values to send, or null when a field is invalid (errors are shown). */
  collect: () => ValuesMap | null;
}

export function useEntryForm(
  listId: string,
  fields: AttributeDefinition[],
  initialValues?: Record<string, ValueInput[]>,
): EntryForm {
  const env = useAttributeEnv();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const build = (): EntryFormState => {
    const entryId = newId();
    const rows: Record<string, AttributeValue[]> = {};
    const texts: Record<string, string> = {};
    for (const a of fields) {
      const inputs = initialValues?.[a.id] ?? initialValues?.[a.apiSlug] ?? defaultInputs(a, env.memberId);
      if (inputs.length === 0) continue;
      const plan = planCommit(a, [], inputs, {
        recordRef: { workspace: env.workspace, entityDefinitionId: listId, entityInstanceId: entryId },
        newId,
      });
      rows[a.id] = plan.optimistic;
      if (TEXT_TYPES.has(a.type)) texts[a.id] = inputs.map((i) => textOfInput(a, i.value)).join(', ');
    }
    return { entryId, rows, texts };
  };

  const [state, setState] = useState<EntryFormState>(build);
  const initialised = useRef(fields.length > 0);
  useEffect(() => {
    // Attributes may arrive after the first render: prefill once they are known.
    if (!initialised.current && fields.length > 0) {
      initialised.current = true;
      setState(build());
    }
  }, [fields.length]);

  const commitTo = useCallback(
    (attribute: AttributeDefinition) => (next: CommitInput) => {
      setState((f) => {
        const plan = planCommit(attribute, f.rows[attribute.id] ?? [], next, {
          recordRef: { workspace: env.workspace, entityDefinitionId: listId, entityInstanceId: f.entryId },
          newId,
        });
        return { ...f, rows: { ...f.rows, [attribute.id]: plan.optimistic } };
      });
      setErrors((e) => ({ ...e, [attribute.id]: '' }));
      setDirty(true);
    },
    [env.workspace, listId],
  );

  const setText = useCallback((attribute: AttributeDefinition, text: string) => {
    setState((f) => ({ ...f, texts: { ...f.texts, [attribute.id]: text } }));
    setErrors((e) => ({ ...e, [attribute.id]: '' }));
    setDirty(true);
  }, []);

  const collect = (): ValuesMap | null => {
    const settings = getFormatSettings();
    const ctx = { settings, today: todayIso(new Date(), settings) };
    const values: ValuesMap = {};
    const next: Record<string, string> = {};
    for (const a of fields) {
      let inputs: ValueInput[];
      if (TEXT_TYPES.has(a.type)) {
        const parsed = pasteValueOf(a, state.texts[a.id] ?? '', ctx);
        if (parsed === null) {
          next[a.id] = errorFor(a);
          continue;
        }
        inputs = parsed.map((p) => ({ ...p, id: newId() }));
      } else {
        inputs = currentValues(state.rows[a.id] ?? []).map((r) => ({
          id: r.id,
          value: toWriteForm(a.type, r.value),
          ...(r.sortOrder ? { sortOrder: r.sortOrder } : {}),
        }));
      }
      if (inputs.length === 0) {
        if (a.isRequired) next[a.id] = `${a.title} is required`;
        continue;
      }
      values[a.id] = inputs;
    }
    setErrors(next);
    return Object.values(next).some(Boolean) ? null : values;
  };

  return { state, errors, dirty, commitTo, setText, collect };
}
