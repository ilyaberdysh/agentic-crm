// The collapsible footer of the chart canvas: "› Calculated values" with "View contributing data" and the CSV download;
// expanded it lists the numbers behind the chart (≈ 260 px) and cross-highlights with it (builder §3.7).

import type { DatasetOutput } from '@agentic-crm/contracts';
import { Button, cx, Icon, IconButton, toast } from '@agentic-crm/ui';
import { useMemo, useState } from 'react';
import * as s from './calculated.css';
import { highlightMatchesKey } from './model/keys';
import { type CalculatedTable, calculatedTable, csvOf, type TableRow } from './model/table';
import type { ChartContext } from './types';
import { colorVar } from './view/colors';
import { TitleText } from './view/TitleText';

export interface CalculatedValuesBarProps {
  ctx: ChartContext;
  data: DatasetOutput;
  /** The highlighted element (see `ReportChartProps`), shared with the chart. */
  highlightKey?: string | null;
  onHighlight?: (key: string | null) => void;
  /** Present for Insight reports: shows "View contributing data". */
  onViewContributingData?: () => void;
  /** File name of the CSV download (".csv" is added when missing). */
  csvFileName: string;
}

/** Saves the table as a CSV file (UTF-8 with a byte order mark so spreadsheets read non-ASCII text). */
export function downloadCsv(table: CalculatedTable, fileName: string): void {
  const blob = new Blob([`﻿${csvOf(table)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = /\.csv$/i.test(fileName) ? fileName : `${fileName}.csv`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Row({
  row,
  highlighted,
  onHighlight,
}: {
  row: TableRow;
  highlighted: boolean;
  onHighlight?: (key: string | null) => void;
}) {
  return (
    <tr
      className={cx(s.row, highlighted && s.rowHighlighted)}
      data-testid="calculated-row"
      data-key={row.key}
      data-highlighted={highlighted || undefined}
      onMouseEnter={() => onHighlight?.(row.key)}
      onMouseLeave={() => onHighlight?.(null)}
    >
      {row.cells.map((cell, i) => (
        <td key={i} className={cx(s.cell, i === 0 ? s.cellFirst : s.cellValue)} data-numeric={i > 0 || undefined}>
          {i === 0 ? (
            <span className={s.labelWrap}>
              {row.swatch && <span className={s.dot} style={{ backgroundColor: colorVar(row.swatch) }} />}
              <span className={s.labelText}>{cell.text}</span>
              {row.flag && <span className={s.flag}>{row.flag}</span>}
            </span>
          ) : (
            cell.text
          )}
        </td>
      ))}
    </tr>
  );
}

export function CalculatedValuesBar({
  ctx,
  data,
  highlightKey,
  onHighlight,
  onViewContributingData,
  csvFileName,
}: CalculatedValuesBarProps) {
  const [open, setOpen] = useState(false);
  const table = useMemo(() => {
    try {
      return calculatedTable(ctx, data);
    } catch {
      return null;
    }
  }, [ctx, data]);

  function download() {
    if (!table) return;
    const id = toast('Downloading file...', { durationMs: Number.POSITIVE_INFINITY, dismissable: false });
    try {
      downloadCsv(table, csvFileName);
      toast.dismiss(id);
      toast.success('CSV file downloaded');
    } catch (error) {
      console.error('[reports] csv export failed', error);
      toast.dismiss(id);
      toast.error('Failed to download the file');
    }
  }

  return (
    <div className={s.bar} data-testid="calculated-values" data-open={open || undefined}>
      <div className={s.head}>
        <button
          type="button"
          className={s.toggle}
          aria-expanded={open}
          data-testid="calculated-values-toggle"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon icon={open ? 'chevronDown' : 'chevronRight'} size={12} />
          Calculated values
        </button>
        <div className={s.actions}>
          {onViewContributingData && (
            <Button
              variant="ghost"
              size={20}
              icon="table"
              onPress={onViewContributingData}
              data-testid="view-contributing-data"
            >
              View contributing data
            </Button>
          )}
          <IconButton
            icon="download"
            size={20}
            aria-label="Download data table as CSV"
            tooltip="Download data table as CSV"
            tooltipPlacement="top"
            isDisabled={!table}
            onPress={download}
            data-testid="download-csv"
          />
        </div>
      </div>
      {open && table && (
        <div className={s.body} data-testid="calculated-values-table">
          <table className={s.table}>
            <thead>
              <tr className={s.headRow}>
                {table.columns.map((col, i) => (
                  <th key={col.key} className={cx(s.headCell, i > 0 && s.cellValue)}>
                    <span className={s.headTitle}>
                      <TitleText text={col.title} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <Row
                  key={row.key}
                  row={row}
                  highlighted={highlightMatchesKey(highlightKey, row.key)}
                  onHighlight={onHighlight}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
