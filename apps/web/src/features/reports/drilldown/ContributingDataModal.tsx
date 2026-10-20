// "Contributing data table" (builder §3.7; evidence contributing-data-table.png): the records behind a report or one
// of its groups, as a regular record table (features/table) of the data source — columns: the record name, the metric
// attribute and the grouping attributes; Sort and Filter in the toolbar; "+ Add column" and footer calculations as in
// any table. It is not a view: nothing is saved. Rows link to records.
import type { Path, Predicate, ViewColumn } from '@agentic-crm/contracts';
import { Badge, DialogHeader, ErrorState, Modal, Spinner } from '@agentic-crm/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { newId } from '../../../lib/ids';
import { objectQuery } from '../../attributes';
import { RecordTable } from '../../table/RecordTable';
import { FilterBar } from '../../views';
import { SortPopover } from '../../views/components/SortPopover';
import * as vs from '../../views/views.css';
import { useWs } from '../data';
import { useEphemeralDraft } from '../editor/ephemeralDraft';
import * as d from './drilldown.css';

export interface ContributingTarget {
  entityDefinitionId: string;
  /** The report's filter AND the clicked group (contributingDataFilter). */
  filter: Predicate | null;
  /** Columns after the record name: the metric attribute and the grouping attributes. */
  columns: { path: Path; field?: string | null }[];
  /** Modal title suffix (the clicked group), if any. */
  caption?: string;
}

const rank = (i: number) => `m${String(i).padStart(3, '0')}`;

export function ContributingDataModal({ target, onClose }: { target: ContributingTarget; onClose: () => void }) {
  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && onClose()}
      size={1005}
      alignment="center"
      overlay
      aria-label="Contributing data table"
    >
      <DialogHeader
        title={
          <span className={d.title}>
            Contributing data table
            <Badge variant="primary" size={20}>
              Beta
            </Badge>
          </span>
        }
        onClose={onClose}
      />
      <div className={d.body} data-testid="contributing-data">
        <ContributingTable target={target} />
      </div>
    </Modal>
  );
}

function ContributingTable({ target }: { target: ContributingTarget }) {
  const ws = useWs();
  const object = useQuery(objectQuery(ws, target.entityDefinitionId));
  const initialColumns = useMemo<ViewColumn[]>(
    () =>
      target.columns.map((c, i) => ({
        id: newId(),
        sortOrder: rank(i),
        path: c.path,
        field: c.field ?? null,
        title: null,
        tableColumnWidth: null,
        tableColumnAggregationType: null,
        displayConfiguration: {},
      })),
    // The columns are chosen once per opening; later edits are the user's.
    [],
  );
  const id = useMemo(() => `contributing:${newId()}`, []);
  const draft = useEphemeralDraft({
    id,
    title: 'Contributing data',
    entityDefinitionId: target.entityDefinitionId,
    baseFilter: target.filter,
    initialColumns,
  });
  if (object.isError) return <ErrorState message="Could not load the data" />;
  if (!object.data) {
    return (
      <div className={d.center}>
        <Spinner size={16} />
      </div>
    );
  }
  return (
    <>
      <div className={d.toolbar}>
        <SortPopover draft={draft} />
        <span className={vs.barDivider} aria-hidden />
        <FilterBar draft={draft} />
      </div>
      <div className={d.table}>
        <RecordTable object={object.data} draft={draft} />
      </div>
    </>
  );
}
