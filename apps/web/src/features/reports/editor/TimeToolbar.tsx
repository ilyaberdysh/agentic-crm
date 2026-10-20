// The time toolbar above the chart (builder §3.6; evidence editor-historical-segmented-dark.png,
// editor-insight-bar-time-compare.png, editor-insight-bar-date-group-ptd-menu.png): Period to date ▾, 7D … All,
// Compare, and the resolution select on the right. Shown for date/timestamp groupings, Historical and Stage changed.
import type { ReportTimeConfig, ReportWindowEnv } from '@agentic-crm/contracts';
import { Icon, Menu, MenuItem, MenuTrigger, Tooltip } from '@agentic-crm/ui';
import { Button as AriaButton, Focusable } from 'react-aria-components';
import { CompareIcon } from '../icons';
import { PopoverSelect } from './controls';
import * as e from './editor.css';
import {
  compareDisabledReason,
  comparisonLabel,
  comparisonOptions,
  PERIODS_TO_DATE,
  RANGES,
  RESOLUTIONS,
  rangeOf,
  withDuration,
} from './timeConfig';

export interface TimeToolbarProps {
  config: ReportTimeConfig;
  env: ReportWindowEnv;
  visualisation: string | null;
  onChange: (config: ReportTimeConfig) => void;
  isDisabled?: boolean;
}

export function TimeToolbar({ config, env, visualisation, onChange, isDisabled }: TimeToolbarProps) {
  const range = rangeOf(config.duration);
  const toDate = config.duration?.type === 'x_to_date' ? config.duration.value : null;
  const compareReason = compareDisabledReason(config, visualisation);
  const options = comparisonOptions(config, env);
  const active = comparisonLabel(config);
  const resolution = RESOLUTIONS.find((r) => r.id === config.resolution);

  const compareButton = (
    <AriaButton
      className={e.compareButton}
      isDisabled={isDisabled || Boolean(compareReason)}
      data-active={active ? '' : undefined}
      data-testid="compare-button"
    >
      <CompareIcon size={16} />
      {active ? (
        <>
          <span>
            Comparing <span className={e.compareStrong}>{active}</span>
          </span>
        </>
      ) : (
        'Compare'
      )}
    </AriaButton>
  );

  return (
    <div className={e.canvasToolbarRow} data-testid="time-toolbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className={e.timeGroup} role="group" aria-label="Time range">
          <MenuTrigger>
            <AriaButton
              className={e.timeButton}
              data-selected={toDate ? '' : undefined}
              isDisabled={isDisabled}
              data-testid="period-to-date"
            >
              {PERIODS_TO_DATE.find((p) => p.id === toDate)?.label ?? 'Period to date'}
              <Icon icon="chevronDown" size={16} />
            </AriaButton>
            <Menu
              aria-label="Period to date"
              placement="bottom start"
              width={170}
              onAction={(key) =>
                onChange(
                  withDuration(config, { type: 'x_to_date', value: key as 'week' | 'month' | 'quarter' | 'year' }, env),
                )
              }
            >
              {PERIODS_TO_DATE.map((p) => (
                <MenuItem key={p.id} id={p.id}>
                  {p.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
          <span className={e.timeDivider} />
          {RANGES.map((r) => (
            <AriaButton
              key={r.id}
              className={e.timeButton}
              data-selected={range === r.id ? '' : undefined}
              aria-pressed={range === r.id}
              isDisabled={isDisabled}
              onPress={() => onChange(withDuration(config, r.duration, env))}
              data-testid={`range-${r.id}`}
            >
              {r.label}
            </AriaButton>
          ))}
        </div>
        {compareReason ? (
          <Tooltip content={compareReason} placement="bottom">
            <Focusable>
              <span tabIndex={0}>{compareButton}</span>
            </Focusable>
          </Tooltip>
        ) : (
          <MenuTrigger>
            {compareButton}
            <Menu
              aria-label="Compare"
              placement="bottom start"
              width={290}
              onAction={(key) => {
                const hit = options.find((o) => o.id === key);
                if (hit?.enabled) onChange({ ...config, comparison: hit.comparison });
                if (key === 'clear') onChange({ ...config, comparison: null });
              }}
            >
              {options.map((o) => (
                <MenuItem
                  key={o.id}
                  id={o.id}
                  isDisabled={!o.enabled}
                  description={o.enabled ? undefined : (o.reason ?? undefined)}
                >
                  {o.label}
                </MenuItem>
              ))}
              {active && (
                <MenuItem id="clear" icon="close">
                  Clear comparison
                </MenuItem>
              )}
            </Menu>
          </MenuTrigger>
        )}
        {active && !compareReason && (
          <Tooltip content="Clear comparison" placement="bottom">
            <AriaButton
              className={e.timeButton}
              aria-label="Clear comparison"
              onPress={() => onChange({ ...config, comparison: null })}
              data-testid="clear-comparison"
            >
              <Icon icon="close" size={16} />
            </AriaButton>
          </Tooltip>
        )}
      </div>
      <div style={{ width: 130 }}>
        <PopoverSelect
          label={resolution?.label ?? 'Monthly'}
          aria-label="Resolution"
          data-testid="resolution-select"
          isDisabled={isDisabled}
        >
          {(close) => (
            <div style={{ padding: 4, display: 'flex', flexDirection: 'column' }}>
              {RESOLUTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={e.stageRow}
                  style={{ border: 0, background: 'transparent', textAlign: 'left', color: 'inherit' }}
                  onClick={() => {
                    onChange({ ...config, resolution: r.id });
                    close();
                  }}
                  data-testid={`resolution-${r.id}`}
                >
                  <span className={e.stageName}>{r.label}</span>
                  {r.id === config.resolution && <Icon icon="check" size={16} />}
                </button>
              ))}
            </div>
          )}
        </PopoverSelect>
      </div>
    </div>
  );
}
