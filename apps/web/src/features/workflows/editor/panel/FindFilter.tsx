// Find records / Find list entries filters ("Find* filters"; contracts: the view predicate AST). The views
// filter bar (features/views) edits it through a draft bound to this block instead of a saved view: same attribute
// picker, operators and value editors as table filters. Each complete change is written to the block's config.
import type { ConfigExpr, Predicate, Sort, View } from '@agentic-crm/contracts';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { buildFilter, FilterBar, parseFilter, useSchemaIndex, type ViewDraft, viewDrafts } from '../../../views';
import { filterPaths } from '../../../views/filterModel';
import { definitionsOfPaths } from '../../../views/schemaIndex';
import { definitionRef } from '../../model/config';
import type { InputProps } from './Field';
import * as s from './panel.css';

const noop = async () => {};

export function FindFilter({ block, spec, value, readOnly, onChange }: InputProps) {
  const defId = spec.of ? definitionRef(block.config.entries[spec.of]) : null;
  const predicate: Predicate | null = value?.type === 'filter' ? value.predicate : null;
  const viewId = `workflow-filter:${block.id}`;
  const state = useSyncExternalStore(
    (cb) => viewDrafts.subscribe(viewId, cb),
    () => viewDrafts.get(viewId),
    () => viewDrafts.get(viewId),
  );
  const filter = state.filter ? state.filter.ast : predicate;
  const extra = useMemo(() => definitionsOfPaths(filterPaths(filter)), [JSON.stringify(filter)]);
  const schema = useSchemaIndex(defId, extra);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const last = useRef(JSON.stringify(predicate));

  // The block's object changed or another tab saved: drop the local draft.
  useEffect(() => {
    const text = JSON.stringify(predicate);
    if (text !== last.current) {
      last.current = text;
      viewDrafts.discard(viewId);
    }
  }, [JSON.stringify(predicate), defId]);

  const filterModel = useMemo(() => {
    if (state.filter?.kind === 'model') return state.filter.model;
    if (!schema) return null;
    return parseFilter(filter, schema.resolve);
  }, [state.filter, schema, filter]);

  const draft = useMemo<ViewDraft | null>(() => {
    if (!defId) return null;
    const commit = (ast: Predicate | null) => {
      const text = JSON.stringify(ast);
      if (text === last.current) return;
      last.current = text;
      const next: ConfigExpr | undefined = ast ? { type: 'filter', predicate: ast } : undefined;
      onChangeRef.current(next);
    };
    const view = {
      id: viewId,
      entityDefinitionId: defId,
      filter: predicate,
      sorts: [],
      columns: [],
      title: 'Filter',
    } as unknown as View;
    return {
      view,
      filter,
      sorts: [] as Sort[],
      columns: [],
      schema,
      filterModel,
      isDirty: false,
      isFilterDirty: false,
      isSortsDirty: false,
      query: { entityDefinitionId: defId, filter, sorts: [] },
      queryKey: viewId,
      setFilter(ast) {
        viewDrafts.setFilterAst(viewId, ast);
        commit(ast);
      },
      setFilterModel(model) {
        if (!schema) return;
        const ast = buildFilter(model, schema.resolve);
        viewDrafts.setFilterModel(viewId, model, ast);
        commit(ast);
      },
      setSorts: () => {},
      saveForEveryone: noop,
      saveAsNew: async () => view,
      discard: () => viewDrafts.discard(viewId),
      addColumn: noop,
      updateColumn: noop,
      removeColumn: noop,
      moveColumn: noop,
      rename: noop,
      setRecordColumnWidth: noop,
    };
  }, [defId, filter, schema, filterModel, viewId, JSON.stringify(predicate)]);

  if (!defId || !draft) {
    return (
      <div className={s.control} data-disabled>
        <span className={`${s.controlValue} ${s.placeholder}`}>
          Select {spec.of === 'list' ? 'a list' : 'an object'} first
        </span>
      </div>
    );
  }
  return (
    <div data-testid="find-filter" style={readOnly ? { pointerEvents: 'none', opacity: 0.7 } : undefined}>
      <FilterBar draft={draft} />
    </div>
  );
}
