// "+ Add calculation" under each column: one board-wide
// calculation (`view.kanban.calculation`), shown per column as "US$100,000.00 sum". The menu lists Count empty /
// Count filled / Percent empty / Percent filled (with the number of eligible attributes) and Sum / Average / Max / Min
// (numeric attributes); each drills into a searchable attribute list ("Parent Record ›" reaches the parent object's
// attributes on lists). Counts and percents follow the table rule (X-23): the snapshot aggregation's kinds.
import type { AttributeDefinition, Path } from '@agentic-crm/contracts';
import { Icon, PopoverPanel, Skeleton } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Dialog } from 'react-aria-components';
import { formatAggregateResult } from '../attributes';
import { aggregateQuery } from '../table/data';
import { attributeIcon, useAttributes } from '../views';
import * as v from '../views/views.css';
import type { AggregateResult, ColumnPage } from './data';
import * as s from './kanban.css';
import { CALCULATION_KINDS, type CalculationKind, eligibleForCalculation, type KanbanCalculation } from './model';
import type { Board } from './useBoard';

export function CalculationFooter({ board, page }: { board: Board; page: ColumnPage | undefined }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const calc = board.config.calculation;
  return (
    <div className={s.footer}>
      <AriaButton
        ref={ref}
        className={s.footerButton}
        aria-expanded={open}
        aria-label={calc ? 'Change calculation' : 'Add calculation'}
        data-testid="kanban-calculation"
        onPress={() => setOpen(true)}
      >
        {calc ? (
          <CalculationValue board={board} page={page} calc={calc} />
        ) : (
          <>
            <span aria-hidden>+</span>
            <span>Add calculation</span>
          </>
        )}
      </AriaButton>
      {open && <CalculationMenu board={board} triggerRef={ref} onClose={() => setOpen(false)} />}
    </div>
  );
}

function CalculationValue({
  board,
  page,
  calc,
}: {
  board: Board;
  page: ColumnPage | undefined;
  calc: KanbanCalculation;
}) {
  const attribute = board.schema?.leaf(calc.path);
  const snapshotId = page?.snapshotId ?? '';
  const q = useQuery({
    ...aggregateQuery(board.workspace, board.view.entityDefinitionId, snapshotId, calc.path, calc.field, calc.kind),
    enabled: Boolean(snapshotId) && !page?.aggregate,
  });
  const result: AggregateResult | undefined = page?.aggregate ?? q.data;
  if (!attribute) return <span className={s.footerSuffix}>—</span>;
  if (!result) return q.error ? <span className={s.footerSuffix}>—</span> : <Skeleton width={72} height={12} />;
  const shown = formatAggregateResult(result, attribute);
  return (
    <>
      <span className={s.footerValue} data-testid="kanban-calculation-value">
        {shown.value}
      </span>
      <span className={s.footerSuffix}>{shown.suffix}</span>
    </>
  );
}

type Level = { kind: 'kinds' } | { kind: 'attributes'; calc: CalculationKind; viaParent: boolean };

function CalculationMenu({
  board,
  triggerRef,
  onClose,
}: {
  board: Board;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose(): void;
}) {
  const [level, setLevel] = useState<Level>({ kind: 'kinds' });
  const [query, setQuery] = useState('');
  const rootId = board.view.entityDefinitionId;
  const rootAttrs = useAttributes(rootId);
  const parentAttr = board.parentAttribute;
  const parentTarget = parentAttr ? board.schema?.targetOf(parentAttr) : null;
  const parentAttrs = useAttributes(parentTarget ?? null);
  const current = board.config.calculation;

  const eligible = (kind: CalculationKind, viaParent: boolean): { attribute: AttributeDefinition; path: Path }[] => {
    const list = viaParent ? (parentAttrs ?? []) : (rootAttrs ?? []);
    return list
      .filter((a) => eligibleForCalculation(a, kind) && a.id !== parentAttr?.id)
      .map((a) => ({
        attribute: a,
        path: [
          ...(viaParent && parentAttr
            ? [{ entityDefinitionId: parentAttr.entityDefinitionId, attributeDefinitionId: parentAttr.id }]
            : []),
          { entityDefinitionId: a.entityDefinitionId, attributeDefinitionId: a.id },
        ],
      }));
  };

  const choose = (kind: CalculationKind, path: Path) => {
    onClose();
    void board.saveConfig({ calculation: { path, field: null, kind } });
  };

  const items = useMemo(() => {
    if (level.kind !== 'attributes') return [];
    const q = query.trim().toLowerCase();
    return eligible(level.calc, level.viaParent).filter((x) => !q || x.attribute.title.toLowerCase().includes(q));
  }, [level, query, rootAttrs, parentAttrs]);

  return (
    <PopoverPanel
      triggerRef={triggerRef}
      isOpen
      onOpenChange={(o) => !o && onClose()}
      placement="top end"
      width={248}
      className={s.settingsPanel}
    >
      <Dialog aria-label="Calculations" className={v.panelColumn}>
        {level.kind === 'kinds' ? (
          <div className={v.list} role="menu" aria-label="Calculations">
            {CALCULATION_KINDS.map(({ kind, label, numeric }) => {
              const n = eligible(kind, false).length + (parentAttr ? eligible(kind, true).length : 0);
              if (numeric && n === 0) return null;
              return (
                <AriaButton
                  key={kind}
                  className={`${v.row} ${s.rowButton}`}
                  data-testid={`calc-kind-${kind}`}
                  onPress={() => {
                    setQuery('');
                    setLevel({ kind: 'attributes', calc: kind, viaParent: false });
                  }}
                >
                  <span className={v.rowLabel}>{label}</span>
                  <span className={v.rowTrailing}>{n}</span>
                  <Icon icon="chevronRight" size={16} className={v.chevron} />
                </AriaButton>
              );
            })}
            {current && (
              <>
                <hr className={v.separator} />
                <AriaButton
                  className={`${v.row} ${s.rowButton}`}
                  onPress={() => {
                    onClose();
                    void board.saveConfig({ calculation: null });
                  }}
                >
                  <Icon icon="close" size={16} className={v.rowIconMuted} />
                  <span className={v.rowLabel}>Remove calculation</span>
                </AriaButton>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={`${v.searchRow} ${v.searchRowWithBack}`}>
              <AriaButton
                className={v.backButton}
                aria-label="Back"
                onPress={() => setLevel(level.viaParent ? { ...level, viaParent: false } : { kind: 'kinds' })}
              >
                <Icon icon="chevronLeft" size={16} />
              </AriaButton>
              <input
                className={v.searchInput}
                placeholder="Search list..."
                aria-label="Search attributes"
                value={query}
                autoFocus
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className={v.list} role="menu" aria-label="Attributes">
              {!level.viaParent && parentAttr && parentTarget && eligible(level.calc, true).length > 0 && (
                <AriaButton
                  className={`${v.row} ${s.rowButton}`}
                  onPress={() => setLevel({ ...level, viaParent: true })}
                >
                  <Icon icon="attrRecord" size={16} className={v.rowIcon} />
                  <span className={v.rowLabel}>{parentAttr.title}</span>
                  <span className={v.rowTrailing}>{eligible(level.calc, true).length}</span>
                  <Icon icon="chevronRight" size={16} className={v.chevron} />
                </AriaButton>
              )}
              {items.map(({ attribute, path }) => {
                const selected =
                  current?.kind === level.calc &&
                  current.path.map((h) => h.attributeDefinitionId).join('>') ===
                    path.map((h) => h.attributeDefinitionId).join('>');
                return (
                  <AriaButton
                    key={attribute.id}
                    className={`${v.row} ${s.rowButton}`}
                    aria-label={attribute.title}
                    onPress={() => choose(level.calc, path)}
                  >
                    <Icon icon={attributeIcon(attribute)} size={16} className={v.rowIcon} />
                    <span className={v.rowLabel}>{attribute.title}</span>
                    {selected && <Icon icon="check" size={16} className={v.rowSelected} />}
                  </AriaButton>
                );
              })}
              {items.length === 0 && <div className={v.empty}>No attributes</div>}
            </div>
          </>
        )}
      </Dialog>
    </PopoverPanel>
  );
}
