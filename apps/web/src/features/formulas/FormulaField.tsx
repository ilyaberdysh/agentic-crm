// The "Formula" block of the create / edit attribute dialog: "Formula" label with the "Output
// <type>" chip once a formula exists; below it "+ Create formula" or the read-only formula (same chips and colours as
// the editor) which re-opens the editor on click.
import type { FormulaAnnotation } from '@agentic-crm/formula';
import { Icon } from '@agentic-crm/ui';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../data/trpc';
import { useAttributeLookup } from './data';
import { CodeEditor } from './editor/CodeEditor';
import * as s from './field.css';
import type { FormulaDraft } from './model/draft';
import { outputIcon, outputLabel } from './model/output';
import { definitionsOf } from './model/schema';
import { loadSource } from './model/source';
import { chipInfoOf } from './useReferences';

export function FormulaField({
  workspace,
  draft,
  label = 'Formula',
  labelClassName,
  fieldClassName,
  onOpen,
}: {
  workspace: WorkspaceRef;
  draft: FormulaDraft | null;
  label?: string;
  labelClassName?: string;
  fieldClassName?: string;
  onOpen: () => void;
}) {
  return (
    <div className={fieldClassName}>
      <div className={s.labelRow}>
        <span className={labelClassName}>{label}</span>
        {draft && (
          <span className={s.output} data-testid="formula-output">
            Output
            <span className={s.outputChip}>
              <Icon icon={outputIcon(draft.outputType)} size={12} />
              {outputLabel(draft.outputType)}
            </span>
          </span>
        )}
      </div>
      {draft ? (
        <FormulaPreview workspace={workspace} draft={draft} onOpen={onOpen} />
      ) : (
        <AriaButton className={s.createButton} onPress={onOpen} aria-label="Create formula">
          <Icon icon="add" size={16} /> Create formula
        </AriaButton>
      )}
    </div>
  );
}

function FormulaPreview({
  workspace,
  draft,
  onOpen,
}: {
  workspace: WorkspaceRef;
  draft: FormulaDraft;
  onOpen: () => void;
}) {
  const key = `${draft.source.plaintext}|${JSON.stringify(draft.source.annotations)}`;
  const doc = useMemo(() => loadSource(draft.source), [key]);
  const { lookup } = useAttributeLookup(workspace, definitionsOf(doc.tokens.values()));
  const resolveChip = useCallback((a: FormulaAnnotation) => chipInfoOf(a, lookup), [lookup]);
  const box = useRef<HTMLButtonElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  return (
    <AriaButton
      ref={box}
      className={s.previewButton}
      onPress={onOpen}
      aria-label="Edit formula"
      data-testid="formula-preview"
    >
      <CodeEditor
        key={key}
        mode="formula"
        className={s.previewEditor}
        initial={doc}
        resolveChip={resolveChip}
        readOnly
        ariaLabel="Formula preview"
      />
      {overflows && <span className={s.fade} />}
    </AriaButton>
  );
}
