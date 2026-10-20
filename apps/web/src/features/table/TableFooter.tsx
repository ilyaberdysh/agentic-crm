// Footer calculations (BACKLOG 2.08 UI; filters-sorts-calcs §8; C1 README §2.4–2.6): "{total} count" under the
// record column; per column "+ Add calculation" or "{value} {suffix}" right-aligned. The picker ("Aggregations")
// offers per-type kinds, checks the current one and adds "None"; choosing saves on the view column immediately and
// the value comes from `snapshots.aggregate` over the shown snapshot (the server derives counts and percentages and
// answers dates as text). Numbers use the same formatter and locale as the cells (X-11).
import type { AttributeDefinition } from '@agentic-crm/contracts';
import { Icon, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, Skeleton } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { memo } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import type { WorkspaceRef } from '../../data/trpc';
import { aggregationOptions, type ColumnAggregation, formatCount } from './aggregations';
import type { TableColumn } from './columns';
import { formatAggregateResult } from './contracts';
import { aggregateQuery } from './data';
import type { PlacedColumn } from './TableCells';
import * as s from './table.css';

export interface FooterProps {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  snapshotId: string | undefined;
  total: number | undefined;
  placed: PlacedColumn[];
  recordWidth: number;
  totalWidth: number;
  fillerLeft: number;
  fillerWidth: number;
  onSetAggregation(column: TableColumn, kind: ColumnAggregation | null): void;
}

export function TableFooter(props: FooterProps) {
  return (
    <div role="row" className={s.footerRow} style={{ width: props.totalWidth }} data-testid="table-footer">
      <div className={s.footerRecordCell} style={{ width: props.recordWidth }} data-testid="footer-count">
        {props.total === undefined ? (
          <Skeleton width={56} height={12} />
        ) : (
          <>
            <span className={s.footerValue}>{formatCount(props.total)}</span>
            <span className={s.footerSuffix}>count</span>
          </>
        )}
      </div>
      {props.placed.map((p) => (
        <FooterCell
          key={p.column.key}
          placed={p}
          workspace={props.workspace}
          entityDefinitionId={props.entityDefinitionId}
          snapshotId={props.snapshotId}
          onSet={props.onSetAggregation}
        />
      ))}
      <div className={s.footerFiller} style={{ left: props.fillerLeft, width: props.fillerWidth }} />
    </div>
  );
}

interface FooterCellProps {
  placed: PlacedColumn;
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  snapshotId: string | undefined;
  onSet(column: TableColumn, kind: ColumnAggregation | null): void;
}

const FooterCell = memo(function FooterCell({
  placed,
  workspace,
  entityDefinitionId,
  snapshotId,
  onSet,
}: FooterCellProps) {
  const { column, left, width } = placed;
  const kind = column.column.tableColumnAggregationType as ColumnAggregation | null;
  const attribute = column.attribute;
  if (!attribute || !column.canAggregate) {
    return <div className={s.footerFiller} style={{ left, width, borderRight: undefined }} />;
  }
  const options = aggregationOptions(attribute.type);
  return (
    <MenuTrigger>
      <AriaButton
        className={s.footerCell}
        style={{ left, width }}
        aria-label={kind ? `Calculation for ${column.title}` : `Add calculation for ${column.title}`}
        data-testid={`footer-${column.key}`}
      >
        {kind ? (
          <AggregateValue
            workspace={workspace}
            entityDefinitionId={entityDefinitionId}
            snapshotId={snapshotId}
            column={column}
            attribute={attribute}
            kind={kind}
          />
        ) : (
          <span className={s.footerPlaceholder}>
            <Icon icon="add" size={14} />
            Add calculation
          </span>
        )}
      </AriaButton>
      <Menu
        aria-label="Aggregations"
        placement="top start"
        width="trigger"
        selectionMode="single"
        selectedKeys={kind ? [kind] : []}
        onAction={(key) => onSet(column, key === 'none' ? null : (key as ColumnAggregation))}
      >
        <MenuSection title="Aggregations" items={options.map((o) => ({ ...o, id: o.value }))}>
          {(o) => <MenuItem id={o.value}>{o.label}</MenuItem>}
        </MenuSection>
        {kind && <MenuSeparator />}
        {kind && <MenuItem id="none">None</MenuItem>}
      </Menu>
    </MenuTrigger>
  );
});

function AggregateValue({
  workspace,
  entityDefinitionId,
  snapshotId,
  column,
  attribute,
  kind,
}: {
  workspace: WorkspaceRef;
  entityDefinitionId: string;
  snapshotId: string | undefined;
  column: TableColumn;
  attribute: AttributeDefinition;
  kind: ColumnAggregation;
}) {
  const q = useQuery({
    ...aggregateQuery(workspace, entityDefinitionId, snapshotId ?? '', column.column.path, column.column.field, kind),
    enabled: Boolean(snapshotId),
  });
  if (!q.data) {
    if (q.error) return <span className={s.footerSuffix}>—</span>;
    return <Skeleton width={56} height={12} />;
  }
  // One formatter and locale for cells and footers (X-11), with the column's formatting overrides.
  const shown = formatAggregateResult(q.data, attribute, column.format);
  return (
    <>
      <span className={s.footerValue} data-testid="footer-value">
        {shown.value}
      </span>
      <span className={s.footerSuffix}>{shown.suffix}</span>
    </>
  );
}
