// `/__dev/report-charts` (dev builds only): every chart on fixture data in a light and a dark column, at canvas and
// cell sizes, plus the empty / error states and the calculated-values footer. Query parameters for the screenshot runs:
//   ?only=<fixture id>[,<id>]  just these charts   &theme=light|dark  one theme only
//   &w=830&h=790               the box of a single chart (default: canvas 830×790, cell 385×418)  &size=cell|canvas
//   &footer=1                  the calculated-values bar under the chart
import { ThemeProvider } from '@agentic-crm/ui';
import { type ReactNode, useState } from 'react';
import { CalculatedValuesBar } from '../CalculatedValuesBar';
import { ChartMessage } from '../ChartMessage';
import { downloadChartImage } from '../downloadImage';
import {
  CRASH_RELOAD_LABEL,
  INPUT_NEEDED,
  MESSAGE_CRASH,
  MESSAGE_INACCESSIBLE,
  MESSAGE_INPUT_NEEDED_TITLE,
  MESSAGE_INVALID_FILTER,
  MESSAGE_NO_COMPARISON,
  MESSAGE_NO_DATA,
  MESSAGE_PIE_NEGATIVE,
  MESSAGE_PLAN_TIME_COMPARISON,
  tooManyMessage,
} from '../messages';
import { ReportChart } from '../ReportChart';
import type { DrillTarget } from '../types';
import { FIXTURES, type Fixture, STATE_FIXTURES } from './fixtures';
import * as g from './gallery.css';

function ChartBox({
  fixture,
  size,
  footer,
  onDrill,
}: {
  fixture: Fixture;
  size: 'cell' | 'canvas';
  footer?: boolean;
  onDrill?: (t: DrillTarget) => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  return (
    <div style={{ display: 'contents' }}>
      <div className={size === 'canvas' ? g.canvasBox : g.cellBox} data-testid={`gallery-${size}-box`}>
        <ReportChart
          ctx={fixture.ctx}
          data={fixture.data}
          size={size}
          highlightKey={highlight}
          onHighlight={setHighlight}
          onDrill={onDrill}
        />
      </div>
      {footer && size === 'canvas' && (
        <div style={{ flexBasis: '100%' }} className={g.footer}>
          <CalculatedValuesBar
            ctx={fixture.ctx}
            data={fixture.data}
            highlightKey={highlight}
            onHighlight={setHighlight}
            onViewContributingData={() => undefined}
            csvFileName={fixture.id}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  fixture,
  footer,
  onDrill,
}: {
  fixture: Fixture;
  footer?: boolean;
  onDrill: (t: DrillTarget) => void;
}) {
  return (
    <section className={g.section} data-gallery-item={fixture.id}>
      <h3 className={g.sectionTitle}>
        {fixture.title} <span className={g.sectionId}>{fixture.id}</span>
      </h3>
      <div className={g.row}>
        <ChartBox fixture={fixture} size="canvas" footer={footer} onDrill={onDrill} />
        <ChartBox fixture={fixture} size="cell" onDrill={onDrill} />
      </div>
    </section>
  );
}

/** One chart in a fixed box (screenshots): the chart and the calculated-values bar share the highlight. */
function Solo({
  fixture,
  size,
  w,
  h,
  footer,
  onDrill,
}: {
  fixture: Fixture;
  size: 'cell' | 'canvas';
  w: number;
  h: number;
  footer: boolean;
  onDrill: (t: DrillTarget) => void;
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  return (
    <div data-gallery-item={fixture.id} style={{ width: w }}>
      <div style={{ width: w, height: h, position: 'relative' }}>
        <ReportChart
          ctx={fixture.ctx}
          data={fixture.data}
          size={size}
          highlightKey={highlight}
          onHighlight={setHighlight}
          onDrill={size === 'canvas' ? onDrill : undefined}
        />
      </div>
      {footer && (
        <CalculatedValuesBar
          ctx={fixture.ctx}
          data={fixture.data}
          highlightKey={highlight}
          onHighlight={setHighlight}
          onViewContributingData={() => undefined}
          csvFileName={fixture.id}
        />
      )}
    </div>
  );
}

function States() {
  const messages: { id: string; title: string; subtitle: string }[] = [
    { id: 'input-needed', title: MESSAGE_INPUT_NEEDED_TITLE, subtitle: INPUT_NEEDED.dataSource },
    { id: 'no-data', ...MESSAGE_NO_DATA },
    { id: 'no-comparison', ...MESSAGE_NO_COMPARISON },
    { id: 'too-many', ...tooManyMessage('bars') },
    { id: 'negative', ...MESSAGE_PIE_NEGATIVE },
    { id: 'inaccessible', ...MESSAGE_INACCESSIBLE },
    { id: 'invalid-filter', ...MESSAGE_INVALID_FILTER },
    { id: 'plan-gated', ...MESSAGE_PLAN_TIME_COMPARISON },
  ];
  return (
    <>
      <section className={g.section} data-gallery-item="states">
        <h3 className={g.sectionTitle}>
          States <span className={g.sectionId}>ChartMessage</span>
        </h3>
        <div className={g.row}>
          {messages.slice(0, 4).map((m) => (
            <div key={m.id} className={g.cellBox} data-testid={`state-${m.id}`}>
              <ChartMessage title={m.title} subtitle={m.subtitle} />
            </div>
          ))}
        </div>
        <div className={g.row} style={{ marginTop: 16 }}>
          {messages.slice(4).map((m) => (
            <div key={m.id} className={g.cellBox} data-testid={`state-${m.id}`}>
              <ChartMessage title={m.title} subtitle={m.subtitle} />
            </div>
          ))}
        </div>
      </section>
      <section className={g.section} data-gallery-item="state-fixtures">
        <h3 className={g.sectionTitle}>
          States derived from data <span className={g.sectionId}>ReportChart</span>
        </h3>
        <div className={g.row}>
          {STATE_FIXTURES.map((f) => (
            <div key={f.id} className={g.cellBox} data-testid={`state-${f.id}`}>
              <ReportChart ctx={f.ctx} data={f.data} size="cell" />
            </div>
          ))}
          <div className={g.cellBox} data-testid="state-crash">
            <ReportChart
              ctx={FIXTURES[0]?.ctx as Fixture['ctx']}
              data={{ ...(FIXTURES[0]?.data as Fixture['data']), rows: null } as unknown as Fixture['data']}
              size="cell"
            />
          </div>
        </div>
        <p className={g.note}>
          The last box feeds a broken dataset: the error boundary shows "{MESSAGE_CRASH.title}" with the “
          {CRASH_RELOAD_LABEL}” button.
        </p>
      </section>
    </>
  );
}

function Column({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) {
  return (
    <ThemeProvider identity={theme}>
      <div className={g.column} data-gallery-theme={theme}>
        <h2 className={g.columnTitle}>{theme === 'light' ? 'Light' : 'Dark'}</h2>
        {children}
      </div>
    </ThemeProvider>
  );
}

export function ChartsGallery() {
  const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  const only = params.get('only')?.split(',').filter(Boolean);
  const theme = params.get('theme');
  const footer = params.get('footer') === '1';
  const [drilled, setDrilled] = useState<DrillTarget | null>(null);
  const themes: ('light' | 'dark')[] = theme === 'light' || theme === 'dark' ? [theme] : ['light', 'dark'];

  if (only?.length) {
    const fixtures = [...FIXTURES, ...STATE_FIXTURES].filter((f) => only.includes(f.id));
    const size = params.get('size') === 'cell' ? 'cell' : 'canvas';
    const w = Number(params.get('w')) || (size === 'cell' ? 385 : 830);
    const h = Number(params.get('h')) || (size === 'cell' ? 418 : 790);
    return (
      <div data-testid="charts-gallery" className={g.soloPage}>
        {themes.map((t) => (
          <ThemeProvider key={t} identity={t}>
            <div className={g.single} data-gallery-theme={t} style={{ display: 'inline-block', verticalAlign: 'top' }}>
              {fixtures.map((f) => (
                <Solo key={f.id} fixture={f} size={size} w={w} h={h} footer={footer} onDrill={setDrilled} />
              ))}
            </div>
          </ThemeProvider>
        ))}
      </div>
    );
  }

  return (
    <div data-testid="charts-gallery" className={g.page}>
      <p className={g.intro}>
        Report charts on fixture data (light | dark; canvas and dashboard-cell sizes). Hover a bar, slice or legend
        item; the calculated-values bar highlights with the chart.
        {drilled && (
          <>
            {' '}
            Last drill: <code data-testid="gallery-drill">{JSON.stringify(drilled)}</code>
          </>
        )}{' '}
        <button
          type="button"
          onClick={() => {
            const el = document.querySelector<HTMLElement>('[data-gallery-item] [data-testid="report-chart"]');
            if (el) void downloadChartImage(el, 'report-chart');
          }}
        >
          Download first chart as image
        </button>
      </p>
      <div className={g.columns}>
        {themes.map((t) => (
          <Column key={t} theme={t}>
            {FIXTURES.map((f) => (
              <Section
                key={f.id}
                fixture={f}
                footer={f.id === 'bar-grouped-status' || f.id === 'pie' || f.id === 'bar-segmented'}
                onDrill={setDrilled}
              />
            ))}
            <States />
          </Column>
        ))}
      </div>
    </div>
  );
}
