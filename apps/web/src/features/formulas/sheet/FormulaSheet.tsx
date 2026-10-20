// The formula editor screen (formulas.md §4.1–4.7): replaces the attribute dialog's content in the same frame.
// Header (back, "Formula", help, close) · CodeMirror editor with chips, highlighting, diagnostics (600 ms after the
// last change) and error hovers · AI composer (generate / refine; Fix from the header) · helper header (Output menu ·
// diagnostics summary + Fix, or the record preview · helper toggle, persisted) · helper body (list + detail) ·
// footer ("Add variable", Save — enabled only for a checked, error-free, non-empty formula; ⌘↵ saves).
// Saving does not call the API: the draft goes back to the dialog, which persists it with the attribute.
import type { EntityDefinition, FormulaGenerationRequest } from '@agentic-crm/contracts';
import {
  ATTRIBUTE_PLACEHOLDER,
  type CompiledFormula,
  type FormulaAnnotation,
  type OutputKind,
  type OutputOverride,
} from '@agentic-crm/formula';
import { AlertDialog, Button, Icon, IconButton } from '@agentic-crm/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorEnvelopeOf, type WorkspaceRef } from '../../../data/trpc';
import { newId } from '../../../lib/ids';
import { usePersistentState } from '../../../lib/storage';
import { requestGeneration, useAiConfigured, useGenerationRequest } from '../data';
import { CodeEditor, type CodeEditorHandle, type EditorUpdate, type HelperKeys } from '../editor/CodeEditor';
import { editorQuery } from '../model/complete';
import { errorRanges } from '../model/diagnostics';
import type { FormulaDraft } from '../model/draft';
import { type DrillLevel, flatItems, type HelperItem, helperGroups, referenceableAttributes } from '../model/helper';
import { compileDraft } from '../model/schema';
import {
  type EditorDoc,
  fieldFor,
  loadSource,
  plainOffset,
  sameSource,
  storedSource,
  tokenText,
  variableAnnotation,
  wireSource,
} from '../model/source';
import { useReferences } from '../useReferences';
import { Composer, type ComposerFailure } from './Composer';
import { DiagnosticsSummary } from './DiagnosticsSummary';
import { HelperPanel } from './HelperPanel';
import { OutputMenu } from './OutputMenu';
import { PreviewControl } from './PreviewControl';
import * as s from './sheet.css';

export type { FormulaDraft };

export interface FormulaSheetProps {
  workspace: WorkspaceRef;
  object: EntityDefinition;
  /** The formula attribute being edited (excluded from its own references). */
  attributeId: string | null;
  initial: FormulaDraft | null;
  /** Edit mode: the attribute's current type (a different output type asks for confirmation). */
  currentType?: string | null;
  onSave: (draft: FormulaDraft) => void;
  onBack: () => void;
  onClose: () => void;
}

const HELPER_KEY = 'FORMULA_EDITOR_HELPER_PANEL_EXPANDED';

type Guard = { reason: 'generating' | 'dirty'; then: () => void } | null;

export function FormulaSheet(props: FormulaSheetProps) {
  const { workspace, object, attributeId } = props;
  const initialDoc = useMemo(() => loadSource(props.initial?.source ?? null), [props.initial]);
  const initialSource = props.initial?.source ?? null;
  const editor = useRef<CodeEditorHandle>(null);
  const helperKeys = useRef<HelperKeys | null>(null);

  const [doc, setDoc] = useState<EditorDoc>(initialDoc);
  const [cursor, setCursor] = useState(initialDoc.text.length);
  const [selection, setSelection] = useState({ from: initialDoc.text.length, to: initialDoc.text.length });
  const [focused, setFocused] = useState(true);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });
  const [override, setOverride] = useState<OutputOverride | null>(props.initial?.outputTypeOverride ?? null);
  const [helperOpen, setHelperOpen] = usePersistentState<boolean>(HELPER_KEY, true);
  const [search, setSearch] = useState('');
  const [drill, setDrill] = useState<DrillLevel[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [request, setRequest] = useState<{ id: string } | null>(null);
  const [failure, setFailure] = useState<ComposerFailure | null>(null);
  const [guard, setGuard] = useState<Guard>(null);
  const [confirmType, setConfirmType] = useState<FormulaDraft | null>(null);
  const configured = useAiConfigured(workspace);

  // ---- schema: the object, the objects reached by record references and by the formula's paths -----------------
  const refs = useReferences(workspace, object.id, {
    excludeAttributeId: attributeId,
    tokens: doc.tokens.values(),
    extraDefs: drill.map((d) => d.entityDefinitionId),
  });
  const all = { lookup: refs.lookup, isLoading: refs.isLoading };

  // ---- type check (600 ms after the last change; at once on load) ---------------------------------------------------
  const [checked, setChecked] = useState<{
    text: string;
    override: OutputOverride | null;
    compiled: CompiledFormula;
  } | null>(null);
  const checkedOnce = useRef(false);
  /** An AI result replaced the text: check it at once (Save and the preview are ready with the result). */
  const checkNow = useRef(false);
  useEffect(() => {
    if (all.isLoading) return;
    const run = () =>
      setChecked({
        text: doc.text,
        override,
        compiled: compileDraft(doc.text, doc.tokens, object.id, all.lookup, override),
      });
    if (!checkedOnce.current || checkNow.current) {
      checkedOnce.current = true;
      checkNow.current = false;
      run();
      return;
    }
    const t = setTimeout(run, 600);
    return () => clearTimeout(t);
  }, [doc, override, all.lookup, all.isLoading, object.id]);
  const current = checked !== null && checked.text === doc.text && checked.override === override;
  const compiled = current ? (checked?.compiled ?? null) : null;
  const diagnostics = compiled?.diagnostics ?? [];
  const errors = useMemo(() => (compiled ? errorRanges(compiled.diagnostics, doc.text.length) : null), [compiled, doc]);
  const lastInferred = useRef<OutputKind | null>(null);
  if (compiled && !compiled.empty) lastInferred.current = compiled.inferredOutputType;

  // ---- AI composer --------------------------------------------------------------------------------------------------
  const req = useGenerationRequest(workspace, request?.id ?? null);
  const generating =
    request !== null && (!req.data || req.data.status === 'queued' || req.data.status === 'generating');
  useEffect(() => {
    const r = req.data as FormulaGenerationRequest | undefined;
    if (!r || !request || r.id !== request.id) return;
    if (r.status === 'completed' && r.outputPlaintext !== null) {
      const next = loadSource({
        plaintext: r.outputPlaintext,
        annotations: (r.outputAnnotations ?? []) as FormulaAnnotation[],
      });
      checkNow.current = true;
      editor.current?.replaceDoc(next, { highlight: true });
      editor.current?.focus();
      setRequest(null);
    } else if (r.status === 'failed' || r.status === 'completed') {
      setFailure({ message: r.refusalMessage ?? '', category: r.refusalCategory });
      setRequest(null);
    }
  }, [req.data, request]);

  const startRequest = (kind: 'generate' | 'fix', prompt: string | null) => {
    const id = newId();
    const hasSelection = selection.to > selection.from;
    const draft = doc.text.trim() ? storedSource(doc.text, doc.tokens) : null;
    setFailure(null);
    setRequest({ id });
    requestGeneration(workspace, kind, {
      id,
      entityDefinitionId: object.id,
      prompt,
      selectionStartFrom: kind !== 'fix' && hasSelection && draft ? plainOffset(doc.text, selection.from) : null,
      selectionStartTo: kind !== 'fix' && hasSelection && draft ? plainOffset(doc.text, selection.to) : null,
      inputFormulaDraft: draft ? wireSource(draft) : null,
    }).catch((error: unknown) => {
      setRequest((r) => (r?.id === id ? null : r));
      setFailure({ message: errorEnvelopeOf(error).message ?? 'The request failed', category: null });
    });
  };

  // ---- editor → sheet -----------------------------------------------------------------------------------------------
  const onEditorChange = useCallback((u: EditorUpdate) => {
    setDoc((prev) => (prev.text === u.doc.text && prev.tokens.size === u.doc.tokens.size ? prev : u.doc));
    setCursor(u.cursor);
    setSelection(u.selection);
    setFocused(u.focused);
    setDepth({ undo: u.undoDepth, redo: u.redoDepth });
  }, []);

  // ---- helper panel -------------------------------------------------------------------------------------------------
  const query = focused && !generating ? editorQuery(doc.text, cursor) : null;
  const levelDef = drill.length > 0 ? (drill[drill.length - 1] as DrillLevel).entityDefinitionId : object.id;
  const levelAttributes = useMemo(
    () => referenceableAttributes(all.lookup(levelDef) ?? [], attributeId),
    [all.lookup, levelDef, attributeId],
  );
  const effectiveQuery = query ? query.query : search;
  const groups = useMemo(
    () =>
      helperGroups({
        attributes: levelAttributes,
        drill,
        query: effectiveQuery,
        queryKind: query ? query.kind : 'search',
        expanded,
      }),
    [levelAttributes, drill, effectiveQuery, query?.kind, expanded],
  );
  const items = useMemo(() => flatItems(groups), [groups]);
  const filtering = effectiveQuery.trim() !== '';
  // A query selects its first match; clearing it clears the selection.
  useEffect(() => {
    if (!filtering) return;
    const first = items.find((i) => i.kind === 'attribute' || i.kind === 'function');
    setActiveKey(first?.key ?? null);
  }, [effectiveQuery, filtering]);

  const replaceRange = query ? { from: query.from, to: query.to } : null;
  const activate = (item: HelperItem) => {
    const ed = editor.current;
    if (item.kind === 'back') {
      setDrill((d) => d.slice(0, -1));
      return;
    }
    if (item.kind === 'toggle') {
      setExpanded((e) => !e);
      return;
    }
    if (!ed) return;
    if (item.kind === 'function') {
      if (replaceRange && query?.kind === 'word') ed.insertFunction(item.decl.name, replaceRange.from, replaceRange.to);
      else ed.insertFunction(item.decl.name);
    } else {
      const field = fieldFor(item.attribute.type);
      if (replaceRange) ed.insertVariable(item.path, replaceRange.from, replaceRange.to, field);
      else ed.insertVariable(item.path, undefined, undefined, field);
      setDrill([]);
    }
    setSearch('');
  };
  const onExample = (code: string, item: HelperItem) => {
    const ed = editor.current;
    if (!ed) return;
    let next: EditorDoc = { text: code, tokens: new Map() };
    if (code.includes(ATTRIBUTE_PLACEHOLDER) && item.kind === 'attribute') {
      const id = newId();
      next = {
        text: code.split(ATTRIBUTE_PLACEHOLDER).join(tokenText(id)),
        tokens: new Map([[id, variableAnnotation(item.path, fieldFor(item.attribute.type))]]),
      };
    }
    ed.insertDoc(next, replaceRange ?? undefined);
  };
  helperKeys.current = {
    move(delta) {
      if (!helperOpen || !query || items.length === 0) return false;
      const selectable = items.filter((i) => i.kind !== 'back');
      const index = selectable.findIndex((i) => i.key === activeKey);
      const next = selectable[Math.max(0, Math.min(selectable.length - 1, index + delta))];
      setActiveKey(next?.key ?? null);
      return true;
    },
    enter() {
      if (!helperOpen || !query) return false;
      const item = items.find((i) => i.key === activeKey);
      if (!item) return false;
      activate(item);
      return true;
    },
  };

  // ---- chips and popups ----------------------------------------------------------------------------------------------
  const { resolveChip, attributeOptions } = refs;

  // ---- save and leave -------------------------------------------------------------------------------------------------
  const canSave = Boolean(compiled?.ok) && !generating;
  const draftOf = (): FormulaDraft | null =>
    compiled?.ok
      ? { source: storedSource(doc.text, doc.tokens), outputTypeOverride: override, outputType: compiled.outputType }
      : null;
  const save = () => {
    const draft = canSave ? draftOf() : null;
    if (!draft) return;
    if (props.currentType && props.currentType !== draft.outputType) {
      setConfirmType(draft);
      return;
    }
    props.onSave(draft);
  };
  const dirty =
    !sameSource(doc.text.trim() ? storedSource(doc.text, doc.tokens) : null, initialSource) ||
    override !== (props.initial?.outputTypeOverride ?? null);
  const leave = (then: () => void) => {
    if (generating) setGuard({ reason: 'generating', then });
    else if (dirty) setGuard({ reason: 'dirty', then });
    else then();
  };

  const checkedSource = useMemo(() => (compiled?.ok ? storedSource(doc.text, doc.tokens) : null), [compiled, doc]);

  return (
    <div
      className={s.sheet}
      data-testid="formula-sheet"
      onKeyDown={(e) => {
        // Escape leaves through the guard unless a popup (completion, menu) consumed it.
        if (e.key !== 'Escape' || e.defaultPrevented || guard || confirmType) return;
        e.preventDefault();
        leave(props.onClose);
      }}
    >
      <div className={s.header}>
        <IconButton icon="chevronLeft" aria-label="Back" onPress={() => leave(props.onBack)} />
        <span className={s.headerTitle}>
          <Icon icon="formulaFx" size={16} className={s.headerIcon} />
          Formula
        </span>
        <IconButton
          icon="help"
          aria-label="Learn more about formulas"
          tooltip="Learn more about formulas"
          onPress={() => {
            setHelperOpen(true);
            setActiveKey(null);
          }}
        />
        <IconButton icon="close" aria-label="Close" onPress={() => leave(props.onClose)} />
      </div>
      <div className={s.editorArea}>
        <CodeEditor
          ref={editor}
          mode="formula"
          className={s.editor}
          initial={initialDoc}
          resolveChip={resolveChip}
          attributeOptions={attributeOptions}
          errors={errors}
          readOnly={generating}
          popups={!helperOpen}
          placeholder="Enter formula..."
          helperKeys={helperKeys}
          onChange={onEditorChange}
          onSubmit={save}
          autoFocus
          ariaLabel="Formula"
        />
        <Composer
          editorEmpty={doc.text.trim() === ''}
          generating={generating}
          failure={failure}
          configured={configured}
          canUndo={depth.undo > 0}
          canRedo={depth.redo > 0}
          onSubmit={(prompt) => startRequest('generate', prompt)}
          onCancel={() => setRequest(null)}
          onDismissFailure={() => setFailure(null)}
          onUndo={() => editor.current?.undo()}
          onRedo={() => editor.current?.redo()}
        />
      </div>
      <div className={s.helperHeader}>
        <OutputMenu
          override={override}
          inferred={compiled ? compiled.inferredOutputType : lastInferred.current}
          onChange={setOverride}
        />
        <div className={s.divider} />
        {diagnostics.length > 0 ? (
          <>
            <DiagnosticsSummary diagnostics={diagnostics} />
            {!generating && (
              <Button
                variant="ghost"
                size={28}
                icon="aiFix"
                isDisabled={configured === false}
                onPress={() => startRequest('fix', null)}
              >
                Fix
              </Button>
            )}
            <span className={s.spacer} />
          </>
        ) : (
          <PreviewControl
            workspace={workspace}
            object={object}
            source={checkedSource ?? { plaintext: '', annotations: [] }}
            outputTypeOverride={override}
            enabled={Boolean(checkedSource)}
          />
        )}
        <IconButton
          icon={helperOpen ? 'helperHide' : 'helperShow'}
          aria-label={helperOpen ? 'Hide helper' : 'Show helper'}
          tooltip={helperOpen ? 'Hide helper' : 'Show helper'}
          onPress={() => setHelperOpen(!helperOpen)}
        />
      </div>
      {helperOpen && (
        <HelperPanel
          groups={groups}
          activeKey={activeKey}
          onActiveKey={setActiveKey}
          search={search}
          searchDisabled={query !== null}
          onSearch={setSearch}
          onActivate={activate}
          onDrill={(item) => {
            if (!item.drillTarget) return;
            setDrill((d) => [
              ...d,
              {
                hop: item.path[item.path.length - 1] as DrillLevel['hop'],
                title: item.attribute.title,
                entityDefinitionId: item.drillTarget as string,
              },
            ]);
            setSearch('');
            setActiveKey(null);
          }}
          onExample={onExample}
          childCount={(def) => {
            const list = all.lookup(def);
            return list ? referenceableAttributes(list).length : null;
          }}
        />
      )}
      <div className={s.footer}>
        <IconButton
          icon="variable"
          aria-label="Add variable"
          tooltip="Add variable"
          tooltipShortcut={['{']}
          onPress={() => editor.current?.startVariable()}
          isDisabled={generating}
        />
        <Button variant="primary" size={28} isDisabled={!canSave} onPress={save}>
          Save
        </Button>
      </div>
      <AlertDialog
        isOpen={guard !== null}
        onOpenChange={(open) => !open && setGuard(null)}
        title={guard?.reason === 'generating' ? 'Discard formula?' : 'Discard changes?'}
        description={
          guard?.reason === 'generating'
            ? 'AI is still generating your formula. Are you sure you want to leave?'
            : 'You have unsaved changes to your formula. Are you sure you want to leave?'
        }
        confirmLabel="Discard"
        onConfirm={() => {
          const then = guard?.then;
          setGuard(null);
          setRequest(null);
          then?.();
        }}
      />
      <AlertDialog
        isOpen={confirmType !== null}
        onOpenChange={(open) => !open && setConfirmType(null)}
        title="Different formula output type"
        description="The new formula has a different output type. Saving it will permanently erase this attribute's history for all records. Are you sure you want to continue?"
        confirmLabel="Continue"
        onConfirm={() => {
          const draft = confirmType;
          setConfirmType(null);
          if (draft) props.onSave(draft);
        }}
      />
    </div>
  );
}
