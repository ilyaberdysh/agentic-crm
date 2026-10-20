// The variable picker (README §3.1): level 1 "Accessible blocks" (nearest first; outcomes without outputs greyed with
// "no data"), level 2 a block's outputs, level 3+ attributes of a record / sub-fields of composite values with a
// breadcrumb and back chevron. Items incompatible with the input are disabled, or flagged ⚠ when they can be drilled
// into (isAssignable). Hovering a row outlines its block on the canvas.
import type { VariableExpr, WfType } from '@agentic-crm/contracts';
import { Icon, type IconName, Spinner } from '@agentic-crm/ui';
import { useEffect, useState } from 'react';
import { TYPE_UI } from '../../../views/operators';
import { useVariables } from '../../data';
import {
  blockRows,
  levelItems,
  makeVariable,
  type PickerCursor,
  type PickerData,
  type PickerItem,
} from '../../model/variables';
import { BlockTile } from '../../ui/parts';
import { useEditorUi } from '../EditorContext';
import * as s from './picker.css';

const KIND_ICON: Partial<Record<WfType['kind'], IconName>> = {
  string: 'attrText',
  number: 'attrNumber',
  boolean: 'attrCheckbox',
  timestamp: 'attrTimestamp',
  date: 'attrDate',
  currency: 'attrCurrency',
  select: 'attrSelect',
  status: 'attrStatus',
  'personal-name': 'attrPersonalName',
  location: 'attrLocation',
  record: 'attrRecord',
  actor: 'attrActor',
  team: 'people',
  task: 'tasks',
  note: 'notes',
  meeting: 'meeting',
  array: 'list',
  json: 'wfParseJson',
  object: 'wfParseJson',
};

function itemIcon(item: PickerItem): IconName {
  if (item.attributeType && item.attributeType in TYPE_UI) {
    return TYPE_UI[item.attributeType as keyof typeof TYPE_UI].icon;
  }
  const t = item.type?.kind === 'array' ? item.type.of : item.type;
  return (t && KIND_ICON[t.kind]) ?? 'attrText';
}

export interface VariablePickerProps {
  blockId: string;
  expected?: WfType;
  onPick: (variable: VariableExpr) => void;
  /** Initial cursor (e.g. to re-open below a chip). */
  autoFocus?: boolean;
}

export function VariablePicker({ blockId, expected, onPick }: VariablePickerProps) {
  const ui = useEditorUi();
  const query = useVariables(ui.page.workflowId, blockId, ui.viewingVersionId);
  const [cursor, setCursor] = useState<PickerCursor>({ level: 'blocks' });
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => () => ui.setHighlight(null), []);
  const data = query.data as PickerData | undefined;

  if (!data) {
    return (
      <div className={s.picker} data-testid="variable-picker">
        <div className={s.empty}>
          <Spinner size={14} />
        </div>
      </div>
    );
  }

  const back = () => {
    if (cursor.level === 'outputs') {
      setCursor({ level: 'blocks' });
      setTrail([]);
    } else if (cursor.level === 'value') {
      if (cursor.operations.length <= 1)
        setCursor({ level: 'outputs', blockId: cursor.blockId, outcome: cursor.outcome });
      else setCursor({ ...cursor, operations: cursor.operations.slice(0, -1) });
      setTrail((t) => t.slice(0, -1));
    }
  };

  const pick = (item: PickerItem) => onPick(makeVariable(item.blockId, item.outcome, item.operations));

  const open = (item: PickerItem) => {
    setCursor({ level: 'value', blockId: item.blockId, outcome: item.outcome, operations: item.operations });
    setTrail((t) => [...t, item.label]);
  };

  if (cursor.level === 'blocks') {
    const rows = blockRows(data);
    return (
      <div className={s.picker} data-testid="variable-picker" data-level="blocks">
        <div className={s.pickerHead}>Accessible blocks</div>
        <div className={s.list}>
          {rows.length === 0 && <div className={s.empty}>No accessible blocks</div>}
          {rows.map((r) => {
            const block = data.blocks.find((b) => b.blockId === r.blockId);
            return (
              <button
                key={r.key}
                type="button"
                className={s.item}
                data-disabled={r.noData || undefined}
                data-nodata={r.noData || undefined}
                data-testid="picker-block"
                onMouseEnter={() => ui.setHighlight(r.blockId)}
                onMouseLeave={() => ui.setHighlight(null)}
                onClick={() => {
                  if (r.noData) return;
                  setCursor({ level: 'outputs', blockId: r.blockId, outcome: r.outcome });
                  setTrail([r.label]);
                }}
              >
                {block && <BlockTile slug={block.slug} size={16} />}
                <span className={s.itemLabel}>
                  {r.title}
                  {r.outcomeLabel && <span className={s.itemOutcome}>({r.outcomeLabel})</span>}
                </span>
                {r.noData ? (
                  <span className={s.noData}>no data</span>
                ) : (
                  <>
                    <span className={s.itemCount}>{r.outputCount}</span>
                    <Icon icon="chevronRight" size={14} className={s.itemIcon} />
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const { self, items } = levelItems(data, cursor, expected);
  return (
    <div className={s.picker} data-testid="variable-picker" data-level={cursor.level}>
      <div className={s.pickerHead}>
        <button
          type="button"
          className={s.item}
          style={{ width: 22, minHeight: 22, padding: 0, justifyContent: 'center' }}
          aria-label="Back"
          onClick={back}
        >
          <Icon icon="chevronLeft" size={14} />
        </button>
        <span className={s.crumb}>{trail.join(' › ')}</span>
      </div>
      <div
        className={s.list}
        onMouseEnter={() => ui.setHighlight(cursor.blockId)}
        onMouseLeave={() => ui.setHighlight(null)}
      >
        {self && (
          <button
            type="button"
            className={s.item}
            data-disabled={self.state === 'disabled' || undefined}
            data-testid="picker-item"
            data-label={self.label}
            onClick={() => self.state !== 'disabled' && pick(self)}
          >
            <Icon icon={itemIcon(self)} size={14} className={s.itemIcon} />
            <span className={s.itemLabel}>{self.label}</span>
            {self.state === 'warning' && (
              <span className={s.warn} title="This value is not compatible with this input">
                <Icon icon="warning" size={14} />
              </span>
            )}
          </button>
        )}
        {items.length === 0 && !self && <div className={s.empty}>No items</div>}
        {items.map((item) => {
          const drill = item.childCount > 0;
          const disabled = item.state === 'disabled';
          return (
            <button
              key={item.key}
              type="button"
              className={`${s.item} ${self ? s.indented : ''}`}
              data-disabled={disabled || undefined}
              data-state={item.state}
              data-testid="picker-item"
              data-label={item.label}
              onClick={() => {
                if (drill) open(item);
                else if (!disabled) pick(item);
              }}
            >
              <Icon icon={itemIcon(item)} size={14} className={s.itemIcon} />
              <span className={s.itemLabel}>{item.label}</span>
              {drill && (
                <>
                  <span className={s.itemCount}>{item.childCount}</span>
                  <Icon icon="chevronRight" size={14} className={s.itemIcon} />
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
