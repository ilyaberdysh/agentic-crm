// One report card on the dashboard grid (H README §3.4; evidence dashboard-grid-4-4-4.png): header (title, ⓘ with the
// description, data-source chip, "New data", ⋮ menu) and the chart, which loads only once the card has been scrolled
// into view (IntersectionObserver, 200 px margin). The header opens the full-screen viewer and is the drag handle.
import { Icon, Tooltip } from '@agentic-crm/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type HTMLAttributes, type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../../shell/workspaceContext';
import { CellMenu } from '../CellMenu';
import { downloadChartImage } from '../charts';
import { type DashboardEntry, incompleteReason, refreshDataset, useSavedDataset } from '../data';
import { SourceChip, useDataSources } from '../dataSources';
import { NewDataPill } from '../NewDataPill';
import { ReportChartView } from '../ReportChartView';
import { useStaleSeq } from '../staleStore';
import { useReportSchema } from '../useReportSchema';
import * as d from './dashboard.css';

/** True once the element has come within `margin` px of the viewport (and stays true). */
export function useInViewOnce(ref: React.RefObject<Element | null>, margin = 200): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: `${margin}px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen, margin]);
  return seen;
}

export interface ReportCellProps {
  entry: DashboardEntry;
  dashboardId: string;
  canEdit: boolean;
  /** Drag handle props spread on the header (dnd-kit listeners). */
  dragProps?: HTMLAttributes<HTMLElement>;
  dragRef?: Ref<HTMLDivElement>;
  dragging?: boolean;
  /** True right after a drag ended: the click that follows must not open the viewer. */
  suppressOpen?: () => boolean;
}

export function ReportCell({
  entry,
  dashboardId,
  canEdit,
  dragProps,
  dragRef,
  dragging,
  suppressOpen,
}: ReportCellProps) {
  const { href } = useWorkspace();
  const client = useQueryClient();
  const report = entry.report;
  const { byId } = useDataSources();
  const source = byId(report.entityDefinitionId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inView = useInViewOnce(bodyRef);
  const dataset = useSavedDataset(report, inView);
  const schema = useReportSchema(report.entityDefinitionId, report.settings);
  const staleSeq = useStaleSeq(dataset.ws.id, dataset.data?.freshness);
  const incomplete = useMemo(() => incompleteReason(report), [report]);
  const viewerPath = href(`reports/dashboard/${dashboardId}/cell/${entry.id}`);

  return (
    <div
      className={d.card}
      data-testid="report-cell"
      data-cell-id={entry.id}
      data-report-id={report.id}
      data-dragging={dragging || undefined}
    >
      <div className={d.cardHeader} ref={dragRef} {...dragProps} data-testid="cell-header">
        <Link
          to={viewerPath}
          className={d.cardTitleLink}
          onClick={(e) => {
            if (suppressOpen?.()) e.preventDefault();
          }}
          data-testid="cell-title-link"
        >
          <span className={d.cardTitle} data-testid="cell-title">
            {report.title || 'Untitled Report'}
          </span>
          {report.description && (
            <Tooltip content={report.description} placement="bottom">
              <span className={d.cardInfo} data-testid="cell-description-icon">
                <Icon icon="info" size={14} />
              </span>
            </Tooltip>
          )}
          <SourceChip source={source} />
        </Link>
        <div className={d.cardActions} onPointerDown={(e) => e.stopPropagation()}>
          {staleSeq && (
            <NewDataPill
              accurateAt={dataset.data?.freshness.accurateAt}
              refreshing={dataset.isFetching}
              onRefresh={() => void refreshDataset(client, dataset.queryKey, staleSeq)}
            />
          )}
          <CellMenu
            dashboardId={dashboardId}
            cellId={entry.id}
            reportId={report.id}
            createdBy={report.createdBy}
            createdAt={report.createdAt}
            canEdit={canEdit}
            withEdit
            onDownload={() =>
              bodyRef.current && void downloadChartImage(bodyRef.current, `${report.title || 'report'}.png`)
            }
          />
        </div>
      </div>
      <div className={d.cardBody} ref={bodyRef} data-testid="cell-body">
        <ReportChartView
          report={report}
          schema={schema}
          source={source}
          size="cell"
          state={{
            data: dataset.data,
            isPending: dataset.isPending || !inView,
            error: dataset.error,
            incomplete,
          }}
        />
      </div>
    </div>
  );
}
