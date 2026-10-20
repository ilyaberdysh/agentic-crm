// ReportChart: one component for every report type × visualisation. It measures its parent box, builds the model
// (or the state that replaces the chart), draws it, and catches render crashes.
import { Button } from '@agentic-crm/ui';
import { Component, type ReactNode, useMemo } from 'react';
import { ChartMessage, stateCopy } from './ChartMessage';
import { CRASH_RELOAD_LABEL, MESSAGE_CRASH } from './messages';
import { buildChart, type ChartPlan } from './model/plan';
import type { ReportChartProps } from './types';
import { CartesianChart } from './view/CartesianChart';
import * as s from './view/chart.css';
import { FunnelAreaChart, FunnelStepsChart } from './view/FunnelChart';
import { type HighlightState, useElementSize, useHighlight } from './view/hooks';
import { PieChart } from './view/PieChart';
import { FunnelMetric, SingleMetric } from './view/SingleMetric';

interface BoundaryProps {
  children: ReactNode;
  /** The boundary resets when this changes (new data after an error). */
  resetKey: unknown;
}

/** "There was an error displaying this chart…" with a Reload button. */
export function CrashMessage() {
  return (
    <ChartMessage
      title={MESSAGE_CRASH.title}
      subtitle={MESSAGE_CRASH.subtitle}
      action={
        <Button variant="secondary" size={28} onPress={() => window.location.reload()}>
          {CRASH_RELOAD_LABEL}
        </Button>
      }
    />
  );
}

class ChartBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[reports] chart crashed', error);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    return this.state.error ? <CrashMessage /> : this.props.children;
  }
}

function Body({
  plan,
  props,
  width,
  height,
  highlight,
}: {
  plan: ChartPlan;
  props: ReportChartProps;
  width: number;
  height: number;
  highlight: HighlightState;
}) {
  const { ctx, onDrill } = props;
  const size = props.size ?? 'canvas';
  switch (plan.type) {
    case 'state': {
      const copy = stateCopy(plan.state);
      return <ChartMessage title={copy.title} subtitle={copy.subtitle} />;
    }
    case 'single':
      return <SingleMetric model={plan} size={size} />;
    case 'funnel-metric':
      return <FunnelMetric model={plan} size={size} />;
    case 'pie':
      return (
        <PieChart
          ctx={ctx}
          model={plan}
          size={size}
          width={width}
          height={height}
          highlight={highlight}
          onDrill={onDrill}
        />
      );
    case 'funnel':
      return <FunnelAreaChart model={plan} size={size} width={width} height={height} highlight={highlight} />;
    case 'steps':
      return <FunnelStepsChart model={plan} size={size} width={width} height={height} highlight={highlight} />;
    case 'cartesian':
      return (
        <CartesianChart
          ctx={ctx}
          model={plan}
          size={size}
          width={width}
          height={height}
          highlight={highlight}
          onDrill={onDrill}
        />
      );
  }
}

/** Renders any report type × visualisation from its context and dataset; fills its parent box. */
export function ReportChart(props: ReportChartProps) {
  const { ctx, data, highlightKey, onHighlight } = props;
  const size = props.size ?? 'canvas';
  const [ref, box] = useElementSize<HTMLDivElement>();
  const plan = useMemo<ChartPlan | null>(() => {
    try {
      return buildChart(ctx, data);
    } catch (error) {
      console.error('[reports] chart model failed', error);
      return null;
    }
  }, [ctx, data]);
  const highlight = useHighlight(highlightKey, onHighlight);
  const ready = box.width > 0 && box.height > 0;
  return (
    <div
      ref={ref}
      className={s.root}
      data-testid="report-chart"
      data-chart={
        !plan
          ? 'crash'
          : plan.type === 'state'
            ? `state-${plan.state.kind}`
            : plan.type === 'cartesian'
              ? plan.kind
              : plan.type
      }
      data-size={size}
    >
      <ChartBoundary resetKey={data}>
        {ready && !plan && <CrashMessage />}
        {ready && plan && (
          <Body plan={plan} props={props} width={box.width} height={box.height} highlight={highlight} />
        )}
      </ChartBoundary>
    </div>
  );
}
