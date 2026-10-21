// Copy of the empty / error / gated chart states (chart-types). Plain constants so the pages can reuse them.

export interface ChartMessageCopy {
  title: string;
  subtitle: string;
}

/** The dataset has no rows. */
export const MESSAGE_NO_DATA: ChartMessageCopy = {
  title: 'No data to display',
  subtitle: "The selected data source and filter don't contain any data",
};

/** The comparison window has no rows. */
export const MESSAGE_NO_COMPARISON: ChartMessageCopy = {
  title: 'No comparison data to display',
  subtitle: 'The selected time comparison does not contain any data',
};

/** Pie charts cannot draw negative values. */
export const MESSAGE_PIE_NEGATIVE: ChartMessageCopy = {
  title: 'Your data contains negative values',
  subtitle: 'Pie charts do not support negative values. Please try a different visualization.',
};

/** Too much data: `nouns` = bars / bar segments / points / segments / funnel stages / funnel steps / locations. */
export function tooManyMessage(nouns: string): ChartMessageCopy {
  return {
    title: `Too many ${nouns}`,
    subtitle: `This chart contains too much data to display. Please update your filter to reduce the number of ${nouns}.`,
  };
}

/** The error boundary's copy; the action is a "Reload" button. */
export const MESSAGE_CRASH: ChartMessageCopy = {
  title: 'Something went wrong',
  subtitle:
    'There was an error displaying this chart. Please reload and try again or contact support if the issue persists.',
};
export const CRASH_RELOAD_LABEL = 'Reload';

export const MESSAGE_INPUT_NEEDED_TITLE = 'Input needed to display chart';
/** Subtitles of the incomplete-configuration states ("Input needed"). */
export const INPUT_NEEDED = {
  dataSource: 'Select a data source',
  metric: 'Configure a metric',
  aggregation: 'Select an aggregation',
  grouping: 'Configure a grouping',
  statusAttribute: 'Select a status attribute',
  statuses: 'Select at least 2 statuses',
  historicSource: 'Select at least one historic data source',
} as const;

/** The metric / grouping / aggregation a schema change invalidated. */
export const MESSAGE_INVALID_METRIC: ChartMessageCopy = {
  title: 'Input needed to display chart',
  subtitle: 'Select a different metric attribute',
};
export const MESSAGE_INVALID_GROUPING: ChartMessageCopy = {
  title: 'Input needed to display chart',
  subtitle: 'Select a different grouping attribute',
};
export const MESSAGE_INVALID_AGGREGATION: ChartMessageCopy = {
  title: 'Input needed to display chart',
  subtitle: 'Select a different metric aggregation',
};

/** The visualisation does not fit the configuration. */
export const MESSAGE_WRONG_VISUALISATION: ChartMessageCopy = {
  title: 'Input needed',
  subtitle: 'Please choose a different visualization',
};
export const MESSAGE_COMPARISON_NEEDS_BAR_OR_LINE: ChartMessageCopy = {
  title: 'Input needed',
  subtitle: 'Only line and bar charts support time comparisons',
};
export const MESSAGE_SEGMENT_NEEDS_BAR_OR_LINE: ChartMessageCopy = {
  title: 'Input needed',
  subtitle: 'Only line and bar charts support "Segment by"',
};

/** A data source the viewer cannot read, or that was deleted. */
export const MESSAGE_INACCESSIBLE: ChartMessageCopy = {
  title: 'Not available',
  subtitle:
    'A data source used by this report is not available. You may not have access to it or it may have been deleted.',
};

export const MESSAGE_INVALID_FILTER: ChartMessageCopy = {
  title: 'Invalid filter',
  subtitle: 'The filter on this report is invalid, please update the filter',
};

/** Reports saved by the legacy engine. */
export const MESSAGE_LEGACY: ChartMessageCopy = {
  title: 'Not migrated',
  subtitle: 'This chart type has not been implemented in the new version of reporting',
};

/** Plan-gated states: the title names the feature; the actions are "Upgrade now" + "to regain access". */
export const MESSAGE_PLAN_TIME_COMPARISON: ChartMessageCopy = {
  title: 'Time comparisons are not available on your current plan',
  subtitle: '',
};
export const MESSAGE_PLAN_SECONDARY_GROUP: ChartMessageCopy = {
  title: 'Secondary group by attribute is not available on your current plan',
  subtitle: '',
};
export const MESSAGE_PLAN_HISTORIC: ChartMessageCopy = {
  title: 'Historic reports are not available on your current plan',
  subtitle: '',
};
export const MESSAGE_PLAN_USAGE_LIMIT: ChartMessageCopy = {
  title: 'Your workspace has exceeded its report usage limit',
  subtitle: '',
};
/** "{Funnel} reports are not available on your current plan". */
export const planTypeMessage = (typeName: string): ChartMessageCopy => ({
  title: `${typeName} reports are not available on your current plan`,
  subtitle: '',
});
export const PLAN_UPGRADE_LABEL = 'Upgrade now';
export const PLAN_UPGRADE_HINT = 'to regain access';

/** Labels inside charts. */
export const LABELS = {
  none: 'None',
  total: 'Total',
  other: 'Other',
  deletedOption: 'Deleted option',
  deletedStage: 'Deleted stage',
  deletedRecord: 'Deleted record',
  unknownActor: 'Unknown actor',
  yes: 'Yes',
  no: 'No',
  currentPeriod: 'Current period',
  previousPeriod: 'Previous period',
  noChange: 'No change',
  periodIncomplete: 'Period incomplete',
  barTotal: 'Bar total',
  converted: 'Converted',
  dropOff: 'Drop-off',
  ofOverall: 'of overall',
  time: 'Time',
  records: 'Records',
} as const;
