// @vitest-environment jsdom
// The rendered charts: SVG structure and the stable test hooks (class names, data-testids and group / segment data
// attributes), states, the error boundary, interactions (click → drill, hover → tooltip, legend → highlight) and the
// calculated-values bar.
import { toastStore } from '@agentic-crm/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFormatSettings } from '../../attributes/format/locale';
import { CalculatedValuesBar } from './CalculatedValuesBar';
import { ChartMessage } from './ChartMessage';
import * as fx from './dev/fixtures';
import { ReportChart } from './ReportChart';
import type { DrillTarget } from './types';

beforeAll(() => {
  setFormatSettings({ locale: 'en-US', timeZone: 'Europe/Moscow', weekStartsOn: 1 });
  // jsdom has no layout: the chart box is 830 × 600.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 830 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => toastStore.clear());
afterEach(cleanup);

const chart = (f: fx.Fixture, extra: Partial<Parameters<typeof ReportChart>[0]> = {}) =>
  render(
    <div style={{ width: 830, height: 600 }}>
      <ReportChart ctx={f.ctx} data={f.data} {...extra} />
    </div>,
  );

describe('ReportChart: bar', () => {
  it('draws one bar per group with the SVG class names of the evidence', () => {
    const { container } = chart(fx.barGrouped);
    expect(screen.getAllByTestId('chart-bar')).toHaveLength(4);
    expect(container.querySelector('.visx-axis-left')).not.toBeNull();
    expect(container.querySelector('.visx-axis-bottom')).not.toBeNull();
    expect(container.querySelector('.visx-rows')).not.toBeNull();
    expect(container.querySelector('.visx-group')).not.toBeNull();
    const segments = screen.getAllByTestId('chart-bar-segment');
    expect(segments.map((s) => s.getAttribute('data-group'))).toEqual([
      fx.STAGES.discovery,
      fx.STAGES.build,
      fx.STAGES.review,
      fx.STAGES.done,
    ]);
    expect(segments.map((s) => s.getAttribute('data-value'))).toEqual(['200000', '470000', '43000', '21000']);
    expect(screen.getByTestId('chart-y-title').textContent).toBe('BudgetSum');
    expect(screen.getByTestId('chart-x-title').textContent).toBe('Phase');
    expect(screen.queryByTestId('chart-legend')).toBeNull();
    expect(screen.queryByTestId('chart-target-line')).toBeNull();
  });

  it('labels the axes with compact ticks', () => {
    const { container } = chart(fx.barGrouped);
    const left = container.querySelector('.visx-axis-left') as HTMLElement;
    expect(within(left).getByText('€0k')).toBeTruthy();
    expect(within(left).getByText('€500k')).toBeTruthy();
    const bottom = container.querySelector('.visx-axis-bottom') as HTMLElement;
    expect(within(bottom).getByText('Discovery')).toBeTruthy();
  });

  it('draws a stacked segmented bar with a legend ordered by total, and the target line', () => {
    chart({
      ...fx.barSegmented,
      ctx: {
        ...fx.barSegmented.ctx,
        report: {
          ...fx.barSegmented.ctx.report,
          settings: { ...fx.barSegmented.ctx.report.settings, targetValue: 300_000 } as never,
        },
      },
    });
    const segments = screen.getAllByTestId('chart-bar-segment');
    expect(segments).toHaveLength(11);
    expect(segments[0]?.getAttribute('data-segment')).toBe(fx.PRIORITIES.low);
    expect(screen.getAllByTestId('chart-legend-item').map((e) => e.getAttribute('data-label'))).toEqual([
      'Critical',
      'High',
      'Medium',
      'Low',
    ]);
    expect(screen.getByTestId('chart-target-line')).toBeTruthy();
  });

  it('draws the previous-period bars beside the current ones', () => {
    chart(fx.barCompare);
    // Previous values: Jun 12k, Jul 9k, Sep 250k, Oct 70k (Apr, May and Aug have none).
    expect(screen.getAllByTestId('chart-comparison-bar').length).toBe(4);
    const legend = screen.getAllByTestId('chart-legend-item').map((e) => e.getAttribute('data-label'));
    expect(legend).toEqual(['Oct 2025 - Apr 2026', 'Apr - Oct']);
    expect(screen.getByTestId('chart-x-title').textContent).toBe('Time');
  });

  it('is clickable only when onDrill is given and reports the keys of the row', () => {
    const onDrill = vi.fn<(t: DrillTarget) => void>();
    const { unmount } = chart(fx.barSegmented, { onDrill });
    fireEvent.click(screen.getAllByTestId('chart-bar-segment')[2] as Element);
    expect(onDrill).toHaveBeenCalledWith({ group: fx.STAGES.discovery, segment: fx.PRIORITIES.high });
    unmount();
    const none = vi.fn();
    chart(fx.barSegmented);
    fireEvent.click(screen.getAllByTestId('chart-bar-segment')[2] as Element);
    expect(none).not.toHaveBeenCalled();
  });

  it('shows the tooltip on hover with the group header, rows and the bar total', () => {
    chart(fx.barSegmented);
    fireEvent.mouseEnter(screen.getAllByTestId('chart-bar-segment')[1] as Element, { clientX: 200, clientY: 200 });
    const tip = screen.getByTestId('chart-tooltip');
    expect(tip.textContent).toContain('Discovery');
    expect(tip.textContent).toContain('Budget (Sum)');
    expect(tip.textContent).toContain('€45,000.00');
    expect(tip.textContent).toContain('Priority');
    expect(tip.textContent).toContain('Medium');
    expect(tip.textContent).toContain('Bar total');
    expect(tip.textContent).toContain('€200,000.00');
    fireEvent.mouseLeave(screen.getAllByTestId('chart-bar-segment')[1] as Element);
    expect(screen.queryByTestId('chart-tooltip')).toBeNull();
  });

  it('dims the other segments when a legend item is hovered, and reports the highlight key', () => {
    const onHighlight = vi.fn();
    chart(fx.barSegmented, { onHighlight });
    fireEvent.mouseEnter(screen.getAllByTestId('chart-legend-item')[1] as Element);
    expect(onHighlight).toHaveBeenLastCalledWith(`s:${fx.PRIORITIES.high}`);
    const dimmed = screen
      .getAllByTestId('chart-bar-segment')
      .filter((s) => /dimmed/.test(s.getAttribute('class') ?? ''));
    expect(dimmed).toHaveLength(9); // 11 segments, 2 of them High
  });

  it('follows a highlight key set from outside (the calculated-values table)', () => {
    chart(fx.barGrouped, { highlightKey: `g:${fx.STAGES.build}` });
    const dimmed = screen
      .getAllByTestId('chart-bar-segment')
      .filter((s) => /dimmed/.test(s.getAttribute('class') ?? ''));
    expect(dimmed.map((s) => s.getAttribute('data-group'))).toEqual([
      fx.STAGES.discovery,
      fx.STAGES.review,
      fx.STAGES.done,
    ]);
  });
});

describe('ReportChart: other charts', () => {
  it('draws a point per group in a line chart', () => {
    chart(fx.lineSingle);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(4);
    expect(screen.getAllByTestId('chart-line')).toHaveLength(1);
  });

  it('draws a slice per group and the legend', () => {
    chart(fx.pie);
    expect(screen.getAllByTestId('chart-slice').map((s) => s.getAttribute('data-label'))).toEqual([
      'Build',
      'Discovery',
      'Review',
      'Done',
    ]);
    expect(screen.getAllByTestId('chart-legend-item')).toHaveLength(4);
  });

  it('draws the single metric', () => {
    chart(fx.singleCurrency);
    expect(screen.getByTestId('chart-single-caption').textContent).toBe('Single Metric - Sum');
    expect(screen.getByTestId('chart-single-value').textContent).toBe('€734,000.00');
    expect(screen.getByTestId('chart-single-sub').textContent).toBe('Budget');
  });

  it('draws the funnel with a card per stage, and the steps with numbered labels', () => {
    const { unmount } = chart(fx.funnelAll);
    expect(screen.getAllByTestId('chart-funnel-card').map((c) => c.textContent)).toEqual([
      '100 %Total',
      '100 %Discovery',
      '75 %Build',
      '44 %Review',
      '50 %Done',
    ]);
    unmount();
    chart(fx.funnelSteps);
    expect(screen.getAllByTestId('chart-funnel-step-label').map((c) => c.textContent)).toEqual([
      '1. Discovery',
      '2. Build',
      '3. Review',
      '4. Done',
    ]);
    expect(screen.getAllByTestId('chart-funnel-card').map((c) => c.textContent)).toEqual([
      '100 %12',
      '75 %9',
      '44 %4',
      '50 %2',
    ]);
  });

  it('draws the funnel metric', () => {
    chart(fx.funnelMetric);
    expect(screen.getByTestId('chart-single-caption').textContent).toBe('Funnel Metric - Phase');
    expect(screen.getByTestId('chart-single-value').textContent).toBe('17 %');
    expect(screen.getByTestId('chart-funnel-path').textContent).toBe('DiscoveryBuildReviewDone');
  });
});

describe('states', () => {
  it('shows the empty, no-comparison and negative-pie messages', () => {
    const { unmount } = chart({
      ...fx.barGrouped,
      data: fx.pivot('insight', [], { groups: { primary: [], secondary: null } }),
    });
    expect(screen.getByTestId('chart-message-title').textContent).toBe('No data to display');
    expect(screen.getByTestId('chart-message-subtitle').textContent).toBe(
      "The selected data source and filter don't contain any data",
    );
    unmount();
    chart(fx.barCompareEmpty);
    expect(screen.getByTestId('chart-message-title').textContent).toBe('No comparison data to display');
    cleanup();
    chart(fx.pieNegative);
    expect(screen.getByTestId('chart-message-title').textContent).toBe('Your data contains negative values');
  });

  it('catches a crash and offers Reload', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    chart({ ...fx.barGrouped, data: { ...fx.barGrouped.data, rows: null } as never });
    expect(screen.getByTestId('chart-message-subtitle').textContent).toBe(
      'There was an error displaying this chart. Please reload and try again or contact support if the issue persists.',
    );
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    error.mockRestore();
  });

  it('renders the ChartMessage with an action', () => {
    render(
      <ChartMessage
        title="Input needed to display chart"
        subtitle="Select a data source"
        action={<button type="button">Go</button>}
      />,
    );
    expect(screen.getByTestId('chart-message-title').textContent).toBe('Input needed to display chart');
    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy();
  });
});

describe('CalculatedValuesBar', () => {
  it('is collapsed by default and expands into the table', () => {
    render(<CalculatedValuesBar ctx={fx.barGrouped.ctx} data={fx.barGrouped.data} csvFileName="x" />);
    expect(screen.queryByTestId('calculated-values-table')).toBeNull();
    expect(screen.queryByTestId('view-contributing-data')).toBeNull();
    fireEvent.click(screen.getByTestId('calculated-values-toggle'));
    const rows = screen.getAllByTestId('calculated-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Discovery€200,000.00',
      'Build€470,000.00',
      'Review€43,000.00',
      'Done€21,000.00',
    ]);
  });

  it('shows "View contributing data" only with a callback and calls it', () => {
    const onView = vi.fn();
    render(
      <CalculatedValuesBar
        ctx={fx.barGrouped.ctx}
        data={fx.barGrouped.data}
        csvFileName="x"
        onViewContributingData={onView}
      />,
    );
    fireEvent.click(screen.getByTestId('view-contributing-data'));
    expect(onView).toHaveBeenCalledTimes(1);
  });

  it('highlights with the chart: hover reports the row key, the highlighted key marks the row', () => {
    const onHighlight = vi.fn();
    const { rerender } = render(
      <CalculatedValuesBar
        ctx={fx.barGrouped.ctx}
        data={fx.barGrouped.data}
        csvFileName="x"
        onHighlight={onHighlight}
      />,
    );
    fireEvent.click(screen.getByTestId('calculated-values-toggle'));
    fireEvent.mouseEnter(screen.getAllByTestId('calculated-row')[1] as Element);
    expect(onHighlight).toHaveBeenLastCalledWith(`g:${fx.STAGES.build}`);
    rerender(
      <CalculatedValuesBar
        ctx={fx.barGrouped.ctx}
        data={fx.barGrouped.data}
        csvFileName="x"
        onHighlight={onHighlight}
        highlightKey={`g:${fx.STAGES.build}`}
      />,
    );
    expect(screen.getAllByTestId('calculated-row').map((r) => r.getAttribute('data-highlighted'))).toEqual([
      null,
      'true',
      null,
      null,
    ]);
  });

  it('downloads the CSV with toasts', async () => {
    const urls: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => {
      urls.push(b);
      return 'blob:test';
    };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<CalculatedValuesBar ctx={fx.barGrouped.ctx} data={fx.barGrouped.data} csvFileName="budget" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('download-csv'));
    });
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(urls).toHaveLength(1);
    expect(await urls[0]?.text()).toContain('Phase,Budget › Sum');
    expect(toastStore.getSnapshot().map((t) => t.title)).toContain('CSV file downloaded');
    clicked.mockRestore();
  });
});
